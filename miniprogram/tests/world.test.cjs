const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const { KEY, createLocalWorkspace } = require("../lib/local-workspace");
const { worldView, itemsFor, statePatch } = require("../lib/world");
const desktop = require("../lib/generated/desktop");

function fixture({
  store = new Map(),
  failWrite = () => false,
  modal = { confirm: true, content: "手动事项" },
  audio = null,
  failAudio = false,
  clock = { setTimeout, clearTimeout },
} = {}) {
  let definition;
  const context = {
    Page: (value) => {
      definition = value;
    },
    getApp: () => ({ globalData: { updateReady: false } }),
    require: createRequire(resolve(__dirname, "../pages/index/index.js")),
    setInterval,
    clearInterval,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    wx: {
      ...(audio || failAudio
        ? {
            createInnerAudioContext: () => {
              if (failAudio) throw Error("audio unavailable");
              return audio;
            },
          }
        : {}),
      getStorageSync: (key) => store.get(key),
      setStorageSync: (key, value) => {
        if (failWrite(key, value)) throw Error("disk full");
        store.set(key, structuredClone(value));
      },
      onNetworkStatusChange() {},
      offNetworkStatusChange() {},
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
      showModal: (o) => o.success(modal),
      showToast() {},
      setClipboardData() {},
    },
  };
  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../pages/index/index.js"), "utf8"),
    context,
  );
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data),
    setData(value) {
      Object.assign(this.data, value);
    },
  });
  page.onLoad();
  return { page, store };
}
const event = (id) => ({ currentTarget: { dataset: { id } } });
const tabEvent = (tab) => ({ currentTarget: { dataset: { tab } } });

test("an unavailable native audio subsystem cannot prevent loading skins, saving drafts or captures", () => {
  const { page } = fixture({ failAudio: true });
  assert.ok(page._client);
  assert.equal(page.data.activeSkin.image, "/assets/mascot.png");
  page.interactSkin();
  page.onDraft({ detail: { value: "音频失败也要保存" } });
  page.submit();
  assert.equal(page.data.count, 1);
  assert.equal(page._client.records()[0].data.text, "音频失败也要保存");
  page.onUnload();
});

test("settings toggles back to its originating workspace and preserves drafts and filters", () => {
  const { page } = fixture();
  page.onDraft({ detail: { value: "不要丢失的合成草稿" } });
  for (const origin of ["capture", "world"]) {
    page.switchTab(tabEvent(origin));
    page.setData({ query: "筛选内容" });
    page.switchTab(tabEvent("settings"));
    assert.equal(page.data.tab, "settings");
    page.switchTab(tabEvent("settings"));
    assert.equal(page.data.tab, origin);
    assert.equal(page.data.query, "筛选内容");
    assert.equal(page.data.draft, "不要丢失的合成草稿");
    page.switchTab(tabEvent("settings"));
    page.closeSettings();
    assert.equal(page.data.tab, origin);
  }
});

test("AI entry explains server configuration and refreshes capability without model calls", async () => {
  const { page, store } = fixture();
  page.openAiSettings();
  assert.equal(page.data.tab, "settings");
  assert.equal(page.data.showAiGuide, true);
  assert.equal(page.data.connected, false);
  page.setData({ connected: true });
  let available = false;
  const calls = [];
  page._transport = async (method, route) => {
    calls.push([method, route]);
    return {
      application: "shixu-sync",
      protocolVersion: 2,
      capabilities: { aiOrganize: available, itemChat: available },
    };
  };
  await page.refreshAiStatus();
  assert.equal(page.data.capabilities.aiOrganize, false);
  available = true;
  await page.refreshAiStatus();
  assert.equal(page.data.capabilities.aiOrganize, true);
  assert.equal(page.data.capabilities.itemChat, true);
  assert.equal(page.data.aiChecking, false);
  assert.deepEqual(calls, [
    ["GET", "/api/v2/status"],
    ["GET", "/api/v2/status"],
  ]);
  assert.ok([...store.keys()].every((key) => !/api.?key/i.test(key)));
  page._transport = async () => {
    throw Error("offline");
  };
  await page.refreshAiStatus();
  assert.match(page.data.error, /offline/);
  assert.equal(page.data.aiChecking, false);
});

test("whale taps restart sound every time, do not time-limit it, and stop on hide/unload", () => {
  const calls = [];
  let ended;
  const audio = {
    onEnded(fn) {
      ended = fn;
    },
    onError() {},
    play() {
      calls.push("play");
    },
    stop() {
      calls.push("stop");
    },
    destroy() {
      calls.push("destroy");
    },
  };
  const { page } = fixture({ audio });
  assert.equal(audio.src, "/assets/laugh.mp3");
  for (let i = 0; i < 4; i++) page.interactSkin();
  assert.equal(calls.filter((c) => c === "play").length, 4);
  assert.equal(
    page._skinTimer,
    undefined,
    "audio completion controls whale interaction",
  );
  assert.equal(page.data.skinAnimating, true);
  ended();
  assert.equal(page.data.skinAnimating, false);
  page.interactSkin();
  page.onHide();
  assert.equal(calls.at(-1), "stop");
  assert.equal(page.data.skinAnimating, false);
  page.onUnload();
  assert.equal(calls.at(-1), "destroy");
});
function packet(id = "p") {
  return {
    id,
    text: "原始通知：带上报告",
    capturedAt: "2026-10-24T01:00:00Z",
    captureDate: "2026-10-24",
    updatedAt: "2026-10-24T01:00:00Z",
    attachments: [],
    sources: [{ id: "input", name: "通知", text: "原始通知：带上报告" }],
    status: "ready",
    doneIds: [],
    itemIds: ["task-a", "task-b"],
    itemState: {
      "task-a": {
        chat: [{ id: "c", text: "旧对话", role: "user" }],
        additions: [{ id: "n", text: "补充事项", at: "today" }],
      },
    },
    future: { preserved: true },
    result: {
      summary: "报告",
      warnings: [],
      items: [
        {
          kind: "task",
          title: "交报告",
          summary: "保留所有材料",
          facts: ["带上报告"],
          sourceIds: ["input"],
          evidence: [{ sourceId: "input", quote: "带上报告" }],
          nextSteps: ["检查一遍"],
          uncertainties: [],
          due: {
            date: "2026-10-24",
            time: "15:00",
            sourceId: "input",
            anchor: "2026年10月24日",
          },
        },
        {
          kind: "idea",
          title: "实验想法",
          summary: "小想法",
          facts: [],
          sourceIds: [],
          evidence: [],
          nextSteps: [],
          uncertainties: [],
          due: null,
        },
      ],
    },
  };
}
function seeded() {
  const f = fixture();
  f.page._client.put("p", packet());
  f.page._refresh();
  return f;
}
test("local capture survives restart and draft-clear failure without duplicate delivery", () => {
  let full = false;
  const f = fixture({
    failWrite: (key, value) => full && key.includes(":draft:") && value === "",
  });
  f.page.onDraft({ detail: { value: "合成测试草稿" } });
  full = true;
  f.page.submit();
  assert.equal(f.page._client.records().length, 1);
  assert.equal(f.page.data.draft, "合成测试草稿");
  const reopened = fixture({ store: f.store });
  reopened.page.submit();
  assert.equal(reopened.page._client.records().length, 1);
  assert.equal(reopened.page.data.draft, "");
  assert.equal(reopened.page.data.count, 1);
});
test("manual item creation is explicit and never invents AI output", () => {
  const f = fixture();
  f.page.onDraft({ detail: { value: "合成通知" } });
  f.page.submit();
  const id = f.page.data.currentCaptureId;
  assert.equal(f.page._client.records()[0].data.result, null);
  f.page.createManual(event(id));
  const p = f.page._client.records()[0].data;
  assert.equal(p.result.items[0].title, "手动事项");
  assert.equal(p.itemState[p.itemIds[0]].origin, "manual");
  assert.equal(f.page.data.itemCount, 1);
});
test("item status, editing, notes, star and deletion preserve siblings, sources and future fields", async () => {
  const f = seeded(),
    p = f.page;
  p.openItem(event("task-a"));
  p.toggleStar(event("task-a"));
  p.togglePin(event("task-a"));
  await p.toggleDone(event("task-a"));
  let r = p._client.records()[0].data;
  assert.equal(r.itemState["task-a"].status, "done");
  assert.equal(r.itemState["task-a"].chat[0].text, "旧对话");
  assert.deepEqual(r.doneIds, [0]);
  assert.equal(p.data.doneCount, 1);
  await p.toggleDone(event("task-a"));
  p.beginEdit();
  p.setData({
    editTitle: "修改标题",
    editSummary: "新的总结",
    editGroup: "课程",
    editDate: "2026-10-25",
  });
  p.saveEdit();
  r = p._client.records()[0].data;
  assert.equal(r.result.items[0].title, "修改标题");
  assert.equal(r.result.items[1].title, "实验想法");
  assert.equal(r.sources[0].text, "原始通知：带上报告");
  assert.equal(r.result.items[0].evidence[0].quote, "带上报告");
  assert.ok(r.future.preserved);
  assert.equal(r.itemState["task-a"].group, "课程");
  assert.ok(r.itemState["task-a"].history.length);
  p.setData({ addition: "补充新进展" });
  p.addNote();
  assert.equal(p.data.selected.additions.length, 2);
  p.removeItem(event("task-a"));
  assert.equal(p.data.itemCount, 1);
  assert.equal(p._client.records()[0].deletedAt, null);
  p.restoreItem(event("task-a"));
  assert.equal(p.data.itemCount, 2);
});
test("world uses desktop ranking, filters, source search, grouping and completion scopes", () => {
  const f = seeded(),
    p = f.page;
  p._changeItem("task-b", { starred: true, group: "灵感", importance: 2 });
  const records = p._client.records();
  assert.equal(worldView(records, { query: "带上报告" }).matched, 2);
  assert.equal(worldView(records, { starOnly: true }).items[0].id, "task-b");
  assert.equal(
    worldView(records, { dateFilter: "today", day: "2026-10-24" }).matched,
    1,
  );
  assert.equal(worldView(records, { kind: "idea", group: "灵感" }).matched, 1);
  assert.equal(
    worldView(records, { dateFilter: "overdue", day: "2026-10-25" }).matched,
    1,
  );
  const view = worldView(records, { sort: "importance" });
  assert.equal(view.items[0].id, "task-b");
  assert.ok(view.sections.some((s) => s.title === "灵感"));
  const ranked = view.items
    .slice()
    .sort((a, b) => desktop.compareItems(a, b, "priority", "2026-10-24"));
  assert.equal(ranked[0].id, "task-a");
});
test("group reorder cannot cross groups and persists on reopen", () => {
  const f = seeded(),
    p = f.page,
    packetB = packet("q");
  packetB.itemIds = ["task-c", "task-d"];
  p._client.put("q", packetB);
  for (const id of ["task-a", "task-c"]) p._changeItem(id, { group: "课程" });
  for (const id of ["task-b", "task-d"]) p._changeItem(id, { group: "灵感" });
  p.setData({ sort: "custom", grouped: true });
  p._refresh();
  const initial = p.data.items
    .filter((r) => r.group === "课程")
    .map((r) => r.id);
  p.moveItem({ currentTarget: { dataset: { id: initial[0], direction: 1 } } });
  const after = p.data.items.filter((r) => r.group === "课程").map((r) => r.id);
  assert.deepEqual([...after], [...initial].reverse());
  const reopened = fixture({ store: f.store });
  assert.deepEqual(
    [
      ...reopened.page.data.items
        .filter((r) => r.group === "课程")
        .map((r) => r.id),
    ],
    [...after],
  );
});
test("full storage never acknowledges local mutation or changes persisted skin", async () => {
  let full = false;
  const f = fixture({ failWrite: () => full });
  f.page._client.put("p", packet());
  f.page._refresh();
  full = true;
  await f.page.toggleDone(event("task-a"));
  assert.equal(
    f.page._client.records()[0].data.itemState["task-a"].status,
    undefined,
  );
  assert.match(f.page.data.error, /disk full/);
  f.page.previewSkin({ currentTarget: { dataset: { id: "cat" } } });
  f.page.applySkin();
  assert.equal(f.page.data.activeSkin.id, "whale");
});
test("skin preview requires apply; selection and custom edits survive restart", () => {
  const f = fixture(),
    p = f.page;
  p.openSkins();
  p.previewSkin(event("cat"));
  p.feedSkin();
  assert.equal(p.data.skinMessage, desktop.BUILTIN_SKINS[1].feeding);
  assert.equal(p.data.activeSkin.id, "whale");
  p.applySkin();
  assert.equal(fixture({ store: f.store }).page.data.activeSkin.id, "cat");
  p.editSkin(event(""));
  p.setData({
    skinForm: { ...p.data.skinForm, image: "data:image/png;base64,YQ==" },
  });
  p.saveCustomSkin();
  const id = p.data.activeSkin.id;
  assert.match(id, /^custom-/);
  assert.equal(fixture({ store: f.store }).page.data.activeSkin.id, id);
  p.deleteCustomSkin(event(id));
  assert.equal(p.data.activeSkin.id, "whale");
});
test("legacy desktop item identifiers upgrade to sync-safe IDs without losing metadata", () => {
  const p = packet();
  delete p.itemIds;
  p.itemState = { "p:0": { starred: true, chat: [{ text: "keep" }] } };
  const row = itemsFor([{ id: "p", data: p, deletedAt: null }])[0];
  const patch = statePatch(p, row, { status: "done" });
  assert.match(patch.itemIds[0], /^[a-zA-Z0-9_-]+$/);
  assert.equal(patch.itemState[patch.itemIds[0]].chat[0].text, "keep");
  assert.equal(patch.itemState[patch.itemIds[0]].starred, true);
});
test("purging a packet removes content permanently and forbids restore", () => {
  let saved;
  const c = createLocalWorkspace(
    () => saved,
    (v) => (saved = structuredClone(v)),
  );
  c.put("p", packet());
  assert.throws(() => c.purge("p"), /最近删除/);
  c.remove("p");
  c.purge("p");
  assert.equal(c.records()[0].data, null);
  assert.throws(() => c.restore("p"), /永久删除/);
});
test("every WXML event resolves to an actual page handler", () => {
  const p = fixture().page,
    xml = readFileSync(resolve(__dirname, "../pages/index/index.wxml"), "utf8");
  for (const match of xml.matchAll(
    /(?:bind|catch)(?:tap|input|change)="([^"]+)"/g,
  ))
    assert.equal(typeof p[match[1]], "function", match[1]);
  assert.equal(xml.includes("<span"), false);
  for (const expression of xml.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    // HTML formatters can insert a newline inside WXML string literals.
    assert.doesNotThrow(
      () => new vm.Script(`(${expression[1]})`),
      expression[1],
    );
  }
});
test("lost AI acknowledgement persists a stable request and retries it after page restart", async () => {
  const f = seeded(),
    p = f.page;
  let ids = [],
    drop = true;
  const record = {
    id: "p",
    version: 4,
    data: packet(),
    deletedAt: null,
    purged: false,
  };
  record.data.result = null;
  record.data.itemIds = [];
  record.data.itemState = {};
  function remote(page) {
    page._connection = { base: "http://127.0.0.1:8788" };
    page._jobs = f.store.get("shixu:mini:jobs:v1:http://127.0.0.1:8788") || [];
    page._client = {
      records: () => [record],
      pendingCount: () => 0,
      conflicts: () => [],
      sync: async () => ({ conflicts: 0, capabilities: { aiOrganize: true } }),
    };
    page._transport = async (method, path, request) => {
      if (path === "/api/v2/status") return { epoch: "test-epoch" };
      if (method === "POST") {
        ids.push(request.id);
        if (drop) {
          drop = false;
          throw Error("response lost");
        }
        return { id: request.id, state: "done" };
      }
      throw Error("unexpected request");
    };
    page.setData({ localMode: false, connected: true });
  }
  remote(p);
  await p.organizeRecord(event("p"));
  assert.match(p.data.error, /response lost/);
  const saved = f.store.get("shixu:mini:jobs:v1:http://127.0.0.1:8788");
  assert.equal(saved[0].state, "submitting");
  const reopened = fixture({ store: f.store }).page;
  remote(reopened);
  await reopened.sync();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(reopened.data.jobs[0].state, "done");
});
test("AI job storage failure prevents transmission and preserves draft and packet", async () => {
  let rejectJobs = false,
    calls = 0;
  const f = fixture({
      failWrite: (key) => rejectJobs && key.includes(":jobs:"),
    }),
    p = f.page;
  p._client.put("p", packet());
  p._connection = { base: "http://127.0.0.1:8788" };
  p._jobs = [];
  p.setData({ localMode: false, capabilities: { aiOrganize: true } });
  p.sync = async () => {};
  p._transport = async (method) => {
    if (method === "POST") calls++;
    return { epoch: "test" };
  };
  rejectJobs = true;
  await p.organizeRecord(event("p"));
  assert.equal(calls, 0);
  assert.match(p.data.error, /disk full/);
  assert.equal(p._client.records().length, 1);
});
test("filtering a manual reorder preserves every hidden slot", () => {
  const f = seeded(),
    p = f.page,
    q = packet("q");
  q.itemIds = ["task-c", "task-d"];
  p._client.put("q", q);
  const full = itemsFor(p._client.records());
  full.forEach((row, i) => p._changeItem(row.id, { order: i }));
  p.setData({ sort: "custom", kind: "task" });
  p._refresh();
  p.moveItem({ currentTarget: { dataset: { id: "task-a", direction: 1 } } });
  const view = worldView(p._client.records(), { sort: "custom" });
  assert.deepEqual(
    view.items.map((r) => r.id),
    ["task-c", "task-b", "task-a", "task-d"],
  );
});

test("large source histories stay out of card payloads and records paginate without truncating storage", () => {
  const records = Array.from({ length: 45 }, (_, i) => {
    const data = packet("p" + i);
    data.text = "合成原文".repeat(12000);
    data.sources[0].text = data.text;
    data.itemIds = ["item-a" + i, "item-b" + i];
    data.itemState = {};
    return {
      id: data.id,
      data,
      version: 0,
      deletedAt: null,
      purged: false,
      pending: false,
    };
  });
  const f = fixture({ store: new Map([[KEY, { version: 1, records }]]) });
  assert.equal(f.page.data.rows.length, 30);
  assert.equal(f.page.data.recordTotal, 45);
  assert.equal(f.page.data.items[0].meta, undefined);
  assert.equal(f.page.data.items[0].search, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(f.page.data)) < 1024 * 1024);
  f.page.recordPage({ currentTarget: { dataset: { step: 1 } } });
  assert.equal(f.page.data.rows.length, 15);
  assert.equal(f.page._client.records()[0].data.text.length, 48000);
});

test("DDL creates grounded dates, infers omitted clocks, shares completion, and reopens without drift", async () => {
  const { page, store } = fixture();
  page.setData({
    ddlTitle: "明天交报告",
    ddlDate: "明天下午三点",
    ddlRequirements: "提交 PDF",
  });
  page.addDdl();
  assert.equal(page.data.ddlCount, 1);
  const row = itemsFor(page._client.records())[0];
  assert.equal(row.time, "15:00");
  assert.doesNotMatch(row.title, /明天/);
  assert.match(row.item.evidence[0].quote, /明天/);
  page.verifyDdl(event(row.id));
  assert.equal(page.data.editing, true);
  page.setData({ editDate: "2026-12-31", editTime: "" });
  page.saveEdit();
  assert.equal(itemsFor(page._client.records())[0].time, "23:59");
  await page.toggleDone(event(row.id));
  assert.equal(page.data.ddlDone.length, 1);
  assert.equal(page.data.ddlCount, 0);
  await page.toggleDone(event(row.id));
  const reopened = fixture({ store }).page;
  const saved = itemsFor(reopened._client.records())[0];
  assert.equal(saved.date, "2026-12-31");
  assert.equal(saved.time, "23:59");
  assert.equal(saved.item.due.timeInferred, true);
  assert.equal(saved.done, false);
  assert.equal(saved.item.evidence[0].quote, row.item.evidence[0].quote);
  reopened.switchTab(tabEvent("ddl"));
  reopened.switchTab(tabEvent("settings"));
  reopened.closeSettings();
  assert.equal(reopened.data.tab, "ddl");
  reopened.setData({ ddlDate: "尽快", ddlTitle: "模糊时间" });
  reopened.addDdl();
  assert.equal(reopened.data.ddlCount, 2);
  assert.equal(reopened.data.ddlUnsure.length, 1);
});

test("old blank clocks recover from matching source and chat, with stable inferred defaults", () => {
  const sources = [
    { id: "report", name: "通知", text: "明天下午三点十分交报告" },
    { id: "draft", name: "通知", text: "明天交草稿" },
  ];
  const items = sources.map((s) => ({
    kind: "task",
    title: s.id,
    summary: s.text,
    facts: [],
    nextSteps: [],
    uncertainties: [],
    sourceIds: [s.id],
    evidence: [{ sourceId: s.id, quote: s.text }],
    due: { date: "2026-10-29", time: "", anchor: "明天", sourceId: s.id },
  }));
  const rows = itemsFor([
    {
      id: "clock-packet",
      data: {
        id: "clock-packet",
        captureDate: "2026-10-28",
        sources,
        result: { items },
        itemIds: ["clock-report", "clock-draft"],
        itemState: {},
        doneIds: [],
      },
    },
  ]);
  assert.equal(rows[0].time, "15:10");
  assert.equal(rows[0].item.due.timeInferred, undefined);
  assert.equal(rows[1].time, "23:59");
  assert.equal(rows[1].item.due.timeInferred, true);
  assert.equal(items[0].due.time, "");
});

test("an undated mini card retains its explicitly stated clock instead of showing the default", () => {
  const text = "开学前下午三点十分提交说明";
  const rows = itemsFor([
    {
      id: "pending-clock",
      data: {
        id: "pending-clock",
        captureDate: "2026-10-28",
        sources: [{ id: "input", name: "通知", text }],
        result: {
          items: [
            {
              kind: "task",
              title: "说明",
              summary: text,
              facts: [],
              nextSteps: [],
              uncertainties: ["日期还不明确"],
              sourceIds: ["input"],
              evidence: [{ sourceId: "input", quote: text }],
              due: null,
            },
          ],
        },
        itemIds: ["pending-item"],
        itemState: {},
        doneIds: [],
      },
    },
  ]);
  assert.equal(rows[0].date, "");
  assert.equal(rows[0].time, "15:10");
  assert.equal(rows[0].item.due, null);
});

test("DDL ranges retain both endpoints through editing, restart and shared completion", async () => {
  const { page, store } = fixture();
  page.setData({ ddlTitle: "合成区间", ddlDate: "明天14:00到后天16:00" });
  page.addDdl();
  let row = itemsFor(page._client.records())[0];
  assert.ok(row.startDate);
  assert.equal(row.startTime, "14:00");
  assert.equal(row.time, "16:00");
  assert.match(row.timeLabel, /14:00 → .*16:00/);
  page.verifyDdl(event(row.id));
  assert.match(page.data.editDate, / 至 /);
  page.saveEdit();
  row = itemsFor(fixture({ store }).page._client.records())[0];
  assert.ok(row.startDate);
  page.previewDdlWindow({ detail: { value: 4 } });
  assert.equal(page.data.ddlIndex, 4);
  page.chooseDdlWindow({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.ddlIndex, 0);
  await page.toggleDone(event(row.id));
  assert.equal(page.data.ddlDone.length, 1);
  await page.toggleDone(event(row.id));
  page.verifyDdl(event(row.id));
  page.setData({ editDate: "", editTime: "" });
  page.saveEdit();
  row = itemsFor(fixture({ store }).page._client.records())[0];
  assert.equal(row.date, "");
  assert.equal(row.item.dueCleared, true);
});

test("habit check-in retains the card, repairs legacy completion and keeps detail in sync", async () => {
  const { page, store } = fixture();
  const data = packet();
  data.result.items[0].kind = "habit";
  data.doneIds = [0];
  data.itemState["task-a"].status = "done";
  data.itemState["task-a"].checkins = ["2020-01-01"];
  page._client.put("p", data);
  page._refresh();
  assert.equal(page.data.activeCount, 2);
  assert.equal(page.data.doneCount, 0);
  page.openItem(event("task-a"));
  const first = page.toggleDone(event("task-a"));
  await page.toggleDone(event("task-a"));
  assert.equal(page.data.checkingId, "task-a");
  await first;
  assert.equal(page.data.items.find((r) => r.id === "task-a").checkinCount, 2);
  assert.equal(page.data.selected.checked, true);
  assert.equal(page.data.selected.checkinCount, 2);
  assert.deepEqual(page._client.records()[0].data.doneIds, []);
  const reopened = fixture({ store }).page;
  assert.equal(
    reopened.data.items.find((r) => r.id === "task-a").checked,
    true,
  );
  await reopened.checkin(event("task-a"));
  assert.equal(
    reopened.data.items.find((r) => r.id === "task-a").checked,
    false,
  );
  assert.equal(
    reopened.data.items.find((r) => r.id === "task-a").checkinCount,
    1,
  );
  assert.equal(reopened.data.activeCount, 2);
});

test("greeting and feeding restore idle copy and use shared durations", () => {
  const scheduled = [];
  const { page } = fixture({
    clock: {
      setTimeout(fn, ms) {
        scheduled.push({ fn, ms });
        return scheduled.length;
      },
      clearTimeout() {},
    },
  });
  page.previewSkin(event("cat"));
  page.setData({ activeSkin: page.data.previewSkin });
  page.interactSkin();
  assert.equal(page.data.skinMessage, page.data.activeSkin.greeting);
  assert.equal(scheduled.at(-1).ms, desktop.SKIN_INTERACTION.greetingMs);
  scheduled.at(-1).fn();
  assert.equal(page.data.skinMessage, page.data.activeSkin.hello);
  assert.equal(page.data.skinAnimating, false);
  page.openSkins();
  page.feedSkin();
  assert.equal(scheduled.at(-1).ms, desktop.SKIN_INTERACTION.feedingMs);
  assert.equal(page.data.skinAnimating, true);
  scheduled.at(-1).fn();
  assert.equal(page.data.skinMessage, page.data.previewSkin.hello);
  page.onUnload();
});

test("world categories count the current scope and changing scope resets a hidden category", () => {
  const { page } = fixture();
  page._client.put("p", packet());
  page._refresh();
  assert.equal(page.data.categories.find((c) => c.key === "task").count, 1);
  page.selectCategory({ currentTarget: { dataset: { kind: "idea" } } });
  assert.equal(page.data.items.length, 1);
  assert.equal(page.data.items[0].kind, "idea");
  page.setScope({ currentTarget: { dataset: { scope: "done" } } });
  assert.equal(page.data.kind, "all");
  assert.equal(page.data.categories[0].count, 0);
  page.onUnload();
});
