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
  createAnimation,
  date = Date,
  selectorQuery,
  failAudio = false,
  clock = { setTimeout, clearTimeout },
} = {}) {
  let definition;
  const context = {
    Date: date,
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
      ...(selectorQuery ? { createSelectorQuery: selectorQuery } : {}),
      ...(createAnimation ? { createAnimation } : {}),
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
    setData(value, callback) {
      Object.assign(this.data, value);
      if (callback) callback();
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
  f.page.previewSkin({ currentTarget: { dataset: { id: "ice" } } });
  f.page.applySkin();
  assert.equal(f.page.data.activeSkin.id, "whale");
});
test("skin cards apply immediately; selection and custom edits survive restart", () => {
  const f = fixture(),
    p = f.page;
  p.openSkins();
  p.previewSkin(event("ice"));
  p.feedSkin();
  assert.equal(p.data.skinMessage, desktop.BUILTIN_SKINS[1].feeding);
  assert.equal(p.data.activeSkin.id, "ice");
  assert.equal(fixture({ store: f.store }).page.data.activeSkin.id, "ice");
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
    assert.doesNotThrow(() => {
      try {
        new vm.Script(`(${expression[1]})`);
      } catch {
        new vm.Script(`({${expression[1]}})`);
      }
    }, expression[1]);
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
  page.previewSkin(event("whale"));
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

test("native scope and kind pickers filter cards without exposing separate scope buttons", () => {
  const { page } = fixture();
  page._client.put("p", packet());
  page._refresh();
  assert.equal(page.data.categories.find((c) => c.key === "task").count, 1);
  page.setKind({ detail: { value: page.data.kindKeys.indexOf("idea") } });
  assert.equal(page.data.items.length, 1);
  assert.equal(page.data.items[0].kind, "idea");
  page.chooseScope({ detail: { value: 1 } });
  assert.equal(page.data.scopeIndex, 1);
  assert.equal(page.data.scope, "done");
  assert.equal(page.data.kind, "all");
  assert.equal(page.data.categories[0].count, 0);
  page.onUnload();
});

test("native motion sends alternating targets beyond one cycle and stops on hide", () => {
  const timers = new Map();
  let next = 0;
  const { page } = fixture({
    audio: { onEnded() {}, onError() {}, play() {}, stop() {}, destroy() {} },
    clock: {
      setTimeout(fn, ms) {
        const id = ++next;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    createAnimation(options) {
      const commands = [];
      const a = {
        step(value) {
          commands.push(["step", value]);
          return a;
        },
        export() {
          return { options, commands };
        },
      };
      for (const method of ["translateY", "scale", "rotate"])
        a[method] = (...args) => {
          commands.push([method, ...args]);
          return a;
        };
      return a;
    },
  });
  page.interactSkin();
  const targets = [];
  for (let i = 0; i < 6; i++) {
    const value = page.data.skinAnimation;
    targets.push(JSON.stringify(value));
    assert.equal(value.commands.filter((c) => c[0] === "step").length, 1);
    const id = page._skinMotionTimer,
      timer = timers.get(id);
    assert.equal(timer.ms, 291);
    timers.delete(id);
    timer.fn();
  }
  for (let i = 1; i < targets.length; i++)
    assert.notEqual(
      targets[i],
      targets[i - 1],
      "each native update must contain a different target",
    );
  page.onHide();
  assert.equal(page.data.skinAnimating, false);
  assert.equal(timers.size, 0);
});

// Synthetic native rectangles exercise the real page gesture handlers; no IDE control.
function dragFixture(options = {}) {
  let page;
  const f = fixture({
    ...options,
    selectorQuery: () => ({
      in() {
        return this;
      },
      select() {
        return this;
      },
      selectAll() {
        return this;
      },
      boundingClientRect() {
        return this;
      },
      fields() {
        return this;
      },
      exec(callback) {
        const rows =
          page.data.tab === "ddl"
            ? [
                ...(page.data.ddlShowOverdue ? page.data.ddlOverdue : []),
                ...page.data.ddlSections.flatMap((s) => s.rows),
              ]
            : page.data.items;
        callback([
          { left: 0, right: 375, top: 0, bottom: 600, width: 375, height: 600 },
          rows.map((r, i) => ({
            dataset: { id: r.id },
            left: (i % 2) * 175,
            right: (i % 2) * 175 + 165,
            top: Math.floor(i / 2) * 230,
            bottom: Math.floor(i / 2) * 230 + 220,
            width: 165,
            height: 220,
          })),
        ]);
      },
    }),
  });
  page = f.page;
  const p = packet(),
    q = packet("q");
  q.itemIds = ["task-c", "task-d"];
  q.itemState = {};
  page._client.put("p", p);
  page._client.put("q", q);
  page.setData({ tab: "world", sort: "custom", sortIndex: 4 });
  page._refresh();
  page.syncQuietly = () => {};
  page._scrollHeight = 1800;
  const touch = (id, x, y) => ({
    currentTarget: { dataset: { id } },
    touches: [{ identifier: 0, clientX: x, clientY: y }],
  });
  return {
    ...f,
    touch,
    start(id) {
      const e = touch(id, 80, 90);
      page.dragTouchStart(e);
      page.startDrag(e);
    },
    move(x, y) {
      page.dragTouchMove(touch(page.data.dragId, x, y));
    },
  };
}
test("two-column touch sorting replaces filtered slots, persists across restart, and suppresses release tap", () => {
  const f = dragFixture(),
    p = f.page;
  p.setData({ kind: "task" });
  p._refresh();
  const before = worldView(p._client.records(), { sort: "custom" }).items.map(
    (r) => r.id,
  );
  f.start("task-a");
  assert.equal(p.data.dragId, "task-a");
  f.move(250, 90);
  p.finishDrag();
  const expected = before.map((id) =>
    id === "task-a" ? "task-c" : id === "task-c" ? "task-a" : id,
  );
  const reopened = fixture({ store: f.store }).page;
  assert.deepEqual(
    worldView(reopened._client.records(), { sort: "custom" }).items.map(
      (r) => r.id,
    ),
    expected,
  );
  p.openItem(event("task-a"));
  assert.equal(p.data.selected, null);
  assert.equal(p.data.sort, "custom");
});
test("swiping before long press stays scrolling; cancel and hide restore order without writes", () => {
  const f = dragFixture(),
    p = f.page;
  const before = JSON.stringify(p._client.records());
  p.dragTouchStart(f.touch("task-a", 80, 90));
  f.move(80, 110);
  p.startDrag(event("task-a"));
  assert.equal(p.data.dragId, "");
  f.start("task-a");
  f.move(250, 90);
  p.cancelDrag();
  assert.equal(JSON.stringify(p._client.records()), before);
  f.start("task-a");
  f.move(250, 90);
  p.onHide();
  assert.equal(p.data.dragId, "");
  assert.equal(JSON.stringify(p._client.records()), before);
});
test("drag edge scrolling advances native scroll-top and touch cancellation restores the list", () => {
  const f = dragFixture(),
    p = f.page;
  f.start("task-a");
  f.move(80, 530);
  p._dragTick();
  assert.ok(p.data.dragScrollTop > 0);
  p.cancelDrag();
  assert.equal(p.data.dragGhost, null);
});
test("grouped touch sorting cannot cross groups or move hidden group slots", () => {
  const f = dragFixture(),
    p = f.page;
  p._changeItem("task-a", { group: "课程" });
  p._changeItem("task-b", { group: "课程" });
  p._changeItem("task-c", { group: "其他" });
  p._changeItem("task-d", { group: "其他" });
  p.setData({ grouped: true });
  p._refresh();
  const before = JSON.stringify(p._client.records());
  f.start("task-a");
  f.move(250, 320);
  p.finishDrag();
  assert.equal(JSON.stringify(p._client.records()), before);
});
test("updates arriving during drag abort persistence and refresh current records", () => {
  const f = dragFixture(),
    p = f.page;
  f.start("task-a");
  f.move(250, 90);
  p._client.put("p", { itemState: { "task-a": { starred: true } } });
  p.finishDrag();
  assert.match(p.data.error, /已更新/);
  assert.equal(p._detail("task-a").starred, true);
});
test("DDL date partitions allow rank changes without changing dates, clocks, ranges or evidence", () => {
  const f = dragFixture(),
    p = f.page;
  p.setData({ tab: "ddl", ddlShowOverdue: true });
  p._refresh();
  const before = p._client.records().map((r) => JSON.stringify(r.data.result));
  f.start("task-a");
  assert.equal(p.data.dragId, "task-a");
  f.move(250, 90);
  p.finishDrag();
  assert.deepEqual(
    p._client.records().map((r) => JSON.stringify(r.data.result)),
    before,
  );
  assert.deepEqual(
    p.data.ddlOverdue.map((r) => r.id),
    ["task-c", "task-a"],
  );
  const reopened = fixture({ store: f.store }).page;
  assert.deepEqual(
    reopened.data.ddlOverdue.map((r) => r.id),
    ["task-c", "task-a"],
  );
  p._dragTapUntil = 0;
  p._client.put("q", {
    result: {
      ...packet("q").result,
      items: [
        {
          ...packet("q").result.items[0],
          due: { date: "2026-10-23", time: "16:00" },
        },
        packet("q").result.items[1],
      ],
    },
  });
  p._refresh();
  const snapshot = JSON.stringify(p._client.records());
  f.start("task-a");
  f.move(250, 90);
  p.finishDrag();
  assert.equal(JSON.stringify(p._client.records()), snapshot);
});
test("multi-packet order persistence is atomic on storage failure", () => {
  let full = false;
  const f = dragFixture({ failWrite: (key) => full && key === KEY }),
    p = f.page;
  const before = JSON.stringify(p._client.records());
  f.start("task-a");
  f.move(250, 90);
  full = true;
  p.finishDrag();
  assert.match(p.data.error, /disk full/);
  assert.equal(JSON.stringify(p._client.records()), before);
});
const { createSyncClient } = require("../lib/sync-client");
test("batched sync order stages every packet and leaves no partial queue on a rejected batch or failed disk", () => {
  let saved,
    fail = false,
    writes = 0;
  const client = createSyncClient({
    read: () => saved,
    write: (value) => {
      if (fail) throw Error("disk full");
      saved = value;
      writes++;
    },
    request: async () => {
      throw Error("not called");
    },
  });
  client.put("p", { itemState: { "task-a": { order: 0 } } });
  client.put("q", { itemState: { "task-c": { order: 1 } } });
  const before = JSON.stringify(client.records()),
    baseline = writes;
  assert.throws(
    () =>
      client.putMany([
        { id: "p", patch: { itemState: { "task-a": { order: 1 } } } },
        { id: "bad:id", patch: {} },
      ]),
    /ID/,
  );
  assert.equal(JSON.stringify(client.records()), before);
  assert.equal(writes, baseline);
  fail = true;
  assert.throws(
    () =>
      client.putMany([
        { id: "p", patch: { itemState: { "task-a": { order: 1 } } } },
        { id: "q", patch: { itemState: { "task-c": { order: 0 } } } },
      ]),
    /disk full/,
  );
  assert.equal(JSON.stringify(client.records()), before);
  assert.equal(writes, baseline);
  fail = false;
  client.putMany([
    { id: "p", patch: { itemState: { "task-a": { order: 1 } } } },
    { id: "q", patch: { itemState: { "task-c": { order: 0 } } } },
  ]);
  assert.equal(writes, baseline + 1);
  const reopened = createSyncClient({
    read: () => saved,
    write: () => {},
    request: async () => {
      throw Error("not called");
    },
  });
  assert.equal(
    reopened.records().find((r) => r.id === "p").data.itemState["task-a"].order,
    1,
  );
  assert.equal(
    reopened.records().find((r) => r.id === "q").data.itemState["task-c"].order,
    0,
  );
});

test("dropping in the cancellation area and a second finger both restore original ranks", () => {
  const f = dragFixture(),
    p = f.page;
  const before = JSON.stringify(p._client.records());
  f.start("task-a");
  f.move(250, 90);
  f.move(340, 580);
  p.finishDrag();
  assert.equal(JSON.stringify(p._client.records()), before);
  f.start("task-a");
  f.move(250, 90);
  p.dragTouchStart({ touches: [{ identifier: 0 }, { identifier: 1 }] });
  p.finishDrag();
  assert.equal(JSON.stringify(p._client.records()), before);
  assert.equal(p.data.dragId, "");
});
test("card delete requires explicit confirmation and remains recoverable without deleting its source packet", () => {
  const rejected = fixture({ modal: { confirm: false } }).page;
  rejected._client.put("p", packet());
  rejected._refresh();
  rejected.confirmRemoveItem(event("task-a"));
  assert.equal(rejected._detail("task-a").deleted, false);
  const accepted = seeded().page;
  accepted.confirmRemoveItem(event("task-a"));
  assert.equal(accepted._detail("task-a").deleted, true);
  assert.equal(accepted._record("p").deletedAt, null);
  accepted.restoreItem(event("task-a"));
  assert.equal(accepted._detail("task-a").deleted, false);
});
test("interleaved group reordering replaces only that group's slots", () => {
  const { moveInGroup } = require("../lib/touch-order");
  const groups = new Map([
    ["a", "one"],
    ["b", "two"],
    ["c", "one"],
    ["d", "two"],
  ]);
  assert.deepEqual(moveInGroup(["a", "b", "c", "d"], "a", "c", groups), [
    "c",
    "b",
    "a",
    "d",
  ]);
});

test("releasing outside a slot after a valid preview returns all ranks to their original positions", () => {
  const f = dragFixture(),
    p = f.page;
  const before = JSON.stringify(p._client.records());
  f.start("task-a");
  f.move(250, 90);
  assert.equal(p._drag.validDrop, true);
  f.move(420, 90);
  assert.equal(p._drag.validDrop, false);
  p.finishDrag();
  assert.equal(JSON.stringify(p._client.records()), before);
  assert.equal(p.data.dragSettling, true);
  assert.equal(p.data.dragGhost.left, 0);
  p.cancelDrag();
});
test("completion persists before animation, fresh control touches bypass only stale release suppression, and state survives restart", async () => {
  const f = seeded(),
    p = f.page;
  p._dragTapUntil = Date.now() + 1000;
  p.onCardActionStart();
  const animation = p.toggleDone(event("task-a"));
  assert.equal(p._detail("task-a").done, true);
  assert.equal(p.data.checkingId, "task-a");
  await animation;
  assert.equal(fixture({ store: f.store }).page._detail("task-a").done, true);
});
test("pinning after drag selects Windows priority ranking and brings the item to the top on reopen", () => {
  const f = dragFixture(),
    p = f.page;
  p.onCardActionStart();
  p.togglePin(event("task-d"));
  assert.equal(p.data.sort, "priority");
  assert.equal(p.data.items[0].id, "task-d");
  assert.equal(fixture({ store: f.store }).page.data.items[0].id, "task-d");
});
test("FLIP preview animates sibling slots and clears the inverse transform before settling", async () => {
  const f = dragFixture(),
    p = f.page;
  f.start("task-a");
  f.move(250, 90);
  assert.ok(p.data.items.some((row) => /translate/.test(row.dragStyle)));
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.ok(p.data.items.every((row) => !row.dragStyle));
  p.cancelDrag();
});
test("view-layer drag gate allows ordinary scroll, blocks finger scroll while lifted, and forwards touch coordinates", () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../lib/drag-gesture.wxs"), "utf8"),
    context,
  );
  const calls = [],
    owner = { callMethod: (...args) => calls.push(args) };
  const e = {
    touches: [{ identifier: 0, clientX: 20, clientY: 400 }],
    currentTarget: { dataset: { dragging: false } },
  };
  assert.equal(context.module.exports.move(e, owner), undefined);
  e.currentTarget.dataset.dragging = true;
  assert.equal(context.module.exports.move(e, owner), false);
  assert.equal(calls[1][0], "dragTouchMove");
  assert.equal(calls[1][1].touches[0].clientY, 400);
});

test("generous drop inference covers gutters, an empty final column and list end margins", () => {
  const { nearestSlot } = require("../lib/touch-order");
  const rects = [
    { left: 16, right: 176, top: 100, width: 160, height: 200, slot: 0 },
    { left: 190, right: 350, top: 100, width: 160, height: 200, slot: 1 },
    { left: 16, right: 176, top: 324, width: 160, height: 200, slot: 2 },
  ];
  assert.equal(nearestSlot(rects, 185, 200, 0), 1); // column gutter
  assert.equal(nearestSlot(rects, 250, 315, 0), 2); // row gap, nearest lower row
  assert.equal(nearestSlot(rects, 320, 400, 0), 2); // empty second column of final row
  assert.equal(nearestSlot(rects, 100, 65, 0), 0); // before first row
  assert.equal(nearestSlot(rects, 280, 570, 0), 2); // after last row
  assert.equal(nearestSlot(rects, 320, 200, 200), 2); // scrolling shifts every drop band
  assert.equal(nearestSlot(rects, 440, 400, 0), undefined);
  assert.equal(nearestSlot(rects, 100, 700, 0), undefined);
});
test("drop inference resists midpoint jitter and cannot snap through a foreign group", () => {
  const { nearestSlot } = require("../lib/touch-order");
  const rects = [
    { left: 0, right: 160, top: 0, width: 160, height: 200, slot: 0 },
    { left: 180, right: 340, top: 0, width: 160, height: 200, slot: 1 },
  ];
  assert.equal(nearestSlot(rects, 173, 100, 0, 0), 0);
  assert.equal(nearestSlot(rects, 195, 100, 0, 0), 1);
  const f = dragFixture(),
    p = f.page;
  p._changeItem("task-c", { group: "other" });
  p.setData({ grouped: true });
  p._refresh();
  f.start("task-a");
  f.move(250, 90);
  assert.equal(p._drag.validDrop, false);
  p.cancelDrag();
});

test("DDL verify is an independent action that opens grounded clock editing even immediately after a drag", () => {
  const f = seeded(),
    p = f.page;
  p._dragTapUntil = Date.now() + 1000;
  p.verifyDdl(event("task-a"));
  assert.equal(p.data.selected.id, "task-a");
  assert.equal(p.data.editing, true);
  assert.equal(p.data.editTime, "15:00");
  assert.equal(p.data.editDate, "2026-10-24");
});
test("grip starts on movement without waiting for a long-press event", () => {
  const f = dragFixture(),
    p = f.page;
  const e = f.touch("task-a", 80, 90);
  e.currentTarget.dataset.immediate = true;
  p.dragTouchStart(e);
  assert.equal(p.data.dragId, "");
  f.move(90, 100);
  assert.equal(p.data.dragId, "task-a");
  p.cancelDrag();
});
test("view-thread following paints every move while throttling bridge work, and bakes the exact final pointer on release", () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../lib/drag-gesture.wxs"), "utf8"),
    context,
  );
  const styles = [],
    calls = [],
    ghost = { setStyle: (value) => styles.push(value) };
  const owner = {
    selectComponent: (id) => {
      assert.equal(id, "#drag-ghost");
      return ghost;
    },
    callMethod: (...args) => calls.push(args),
  };
  for (let i = 1; i <= 8; i++)
    context.module.exports.move(
      {
        timeStamp: i * 8,
        touches: [{ clientX: 100 + i, clientY: 200 + i }],
        currentTarget: {
          dataset: {
            dragging: true,
            follow: { x: 100, y: 200, left: 20, top: 40, token: 1 },
          },
        },
      },
      owner,
    );
  assert.equal(styles.length, 8);
  assert.ok(calls.length < 4);
  assert.match(styles[7].transform, /8px,8px/);
  context.module.exports.end(
    {
      touches: [],
      changedTouches: [{ clientX: 150, clientY: 260 }],
      currentTarget: {
        dataset: {
          dragging: true,
          follow: { x: 100, y: 200, left: 20, top: 40, token: 1 },
        },
      },
    },
    owner,
  );
  assert.equal(styles[8].left, "70px");
  assert.equal(styles[8].top, "100px");
  assert.equal(calls[calls.length - 1][0], "finishDrag");
  assert.equal(calls[calls.length - 1][1].changedTouches[0].clientY, 260);
});
test("view-follow hit testing does not resend ghost positions over setData for every move", () => {
  const f = dragFixture(),
    p = f.page;
  f.start("task-a");
  const writes = [],
    original = p.setData;
  p.setData = function (value, callback) {
    writes.push(value);
    original.call(this, value, callback);
  };
  p.dragTouchMove({ ...f.touch("task-a", 85, 95), viewFollow: true });
  assert.equal(writes.filter((value) => value.dragGhost).length, 0);
  p.cancelDrag();
});

test("mini countdown covers every DDL section, retains interval clocks and refreshes across midnight", async () => {
  let now = "2026-10-26T15:00:00";
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
  }
  const { page, store } = fixture({ date: Clock });
  try {
    const data = packet("countdown");
    data.itemIds = [
      "past",
      "today",
      "soon",
      "later",
      "unsure",
      "done",
      "range",
    ];
    data.itemState = { done: { status: "done" } };
    data.doneIds = [5];
    const dates = [
      "2026-10-25",
      "2026-10-26",
      "2026-10-30",
      "2026-11-08",
      "",
      "2026-10-24",
      "2026-10-28",
    ];
    data.result.items = dates.map((date, i) => ({
      kind: "task",
      title: `合成事项${i}`,
      summary: "保留原文",
      facts: [],
      nextSteps: [],
      uncertainties: [],
      sourceIds: [],
      evidence: [],
      due: date
        ? {
            date,
            time: "16:00",
            ...(i === 6 ? { startDate: "2026-10-26", startTime: "14:00" } : {}),
          }
        : null,
    }));
    data.result.items[4].dueCleared = true;
    page._client.put(data.id, data);
    page._refresh();
    const rows = () => [
      ...page.data.ddlOverdue,
      ...page.data.ddlSections.flatMap((s) => s.rows),
      ...page.data.ddlUnsure,
      ...page.data.ddlDone,
    ];
    const row = (id) => rows().find((r) => r.id === id);
    assert.equal(row("past").countdown, "已逾期 1 天");
    assert.equal(row("today").countdown, "今天截止");
    assert.equal(row("soon").countdown, "还剩 4 天");
    assert.equal(row("later").countdown, "还剩 13 天");
    assert.equal(row("unsure").countdownStatus, "unsure");
    assert.equal(row("done").countdownStatus, "done");
    assert.equal(row("range").countdown, "还剩 2 天");
    assert.equal(row("range").startTime, "14:00");
    assert.equal(row("range").time, "16:00");
    now = "2026-10-26T16:01:00";
    page._refresh();
    assert.equal(row("today").countdown, "今天已逾期");
    now = "2026-10-27T00:01:00";
    page._refresh();
    assert.equal(row("today").countdown, "已逾期 1 天");
    assert.equal(row("soon").countdown, "还剩 3 天");
    await page.toggleDone(event("soon"));
    assert.equal(row("soon").countdown, "已完成");
    const reopened = fixture({ store, date: Clock }).page;
    try {
      assert.equal(
        reopened.data.ddlDone.find((r) => r.id === "soon").countdown,
        "已完成",
      );
    } finally {
      reopened.onUnload();
    }
    await page.toggleDone(event("soon"));
    assert.equal(row("soon").countdown, "还剩 3 天");
  } finally {
    page.onUnload();
  }
});

test("compact expansion is temporary, stars are independent and details refresh persisted state", () => {
  const { page, store } = fixture();
  page._client.put("p", packet());
  page._refresh();
  page.toggleCard(event("task-a"));
  assert.equal(page.data.expandedCardId, "task-a");
  page._dragTapUntil = Date.now() + 500;
  let writes = 0;
  const set = page.setData.bind(page);
  page.setData = (...args) => {
    writes++;
    set(...args);
  };
  page.onCardActionStart();
  assert.equal(
    writes,
    0,
    "a fresh button touch must not rerender the button before native tap",
  );
  page.toggleStar(event("task-a"));
  assert.equal(page._detail("task-a").starred, true);
  assert.equal(page.data.selected, null);
  assert.equal(page.data.expandedCardId, "task-a");
  page.openItem(event("task-a"));
  page.toggleStar(event("task-a"));
  assert.equal(page.data.selected.starred, false);
  page.closeItem();
  page.switchTab(tabEvent("ddl"));
  assert.equal(page.data.expandedCardId, "");
  const reopened = fixture({ store }).page;
  assert.equal(reopened.data.expandedCardId, "");
  assert.equal(reopened._detail("task-a").starred, false);
  page.onUnload();
  reopened.onUnload();
});

test("single-column drag recomputes variable-height slots and can cancel back to original geometry", () => {
  const f = dragFixture();
  const p = f.page;
  f.start("task-a");
  const s = p._drag;
  let top = 0;
  s.initialRects = s.original.map((id, slot) => {
    const height = slot === 0 ? 300 : 100;
    const rect = {
      dataset: { id },
      slot,
      left: 0,
      right: 350,
      width: 350,
      top,
      bottom: top + height,
      height,
    };
    top += height + 12;
    return rect;
  });
  s.rects = s.initialRects.map((r) => ({ ...r }));
  s.origin = s.rects[0];
  f.move(100, 350);
  assert.notEqual(s.order[0], "task-a");
  for (let i = 0; i < s.rects.length; i++) {
    assert.equal(s.rects[i].dataset.id, s.order[i]);
    assert.equal(s.rects[i].height, s.order[i] === "task-a" ? 300 : 100);
    if (i) assert.equal(s.rects[i].top - s.rects[i - 1].bottom, 12);
  }
  p.cancelDrag({ type: "touchcancel" });
  assert.equal(p.data.dragGhost.top, s.origin.top);
  assert.equal(p.data.items[0].id, s.original[0]);
  p.onUnload();
});

test("rendered card action routing bypasses stale drag suppression and isolates deleted records", async () => {
  const f = dragFixture();
  const p = f.page;
  const act = (action, id = "task-a") =>
    p.onCardAction({ currentTarget: { dataset: { action, id } } });
  p._dragTapUntil = Date.now() + 500;
  act("toggleStar");
  assert.equal(p._detail("task-a").starred, true);
  assert.equal(p.data.selected, null);
  act("openItem");
  assert.equal(p.data.selected.id, "task-a");
  act("toggleStar");
  assert.equal(p.data.selected.starred, false);
  act("confirmRemoveItem");
  assert.equal(p._detail("task-a").deleted, true);
  assert.equal(p.data.selected, null);
  act("toggleStar");
  assert.equal(p._detail("task-a").starred, false);
  act("restoreItem");
  assert.equal(p._detail("task-a").deleted, false);
  await act("toggleDone");
  assert.equal(p._detail("task-a").done, true);
  p._drag = {};
  act("toggleStar");
  assert.equal(p._detail("task-a").starred, false);
  p._drag = null;
  p.onUnload();
});

test("compact category strip changes kind and resets temporary expansion without changing stored dates", () => {
  const { page: p } = fixture();
  p._client.put("p", packet());
  p._refresh();
  const before = p._client.records()[0].data;
  p.setData({ expandedCardId: "task-a" });
  p.selectCardCategory({ currentTarget: { dataset: { kind: "task" } } });
  assert.equal(p.data.kind, "task");
  assert.equal(p.data.expandedCardId, "");
  assert.deepEqual(p._client.records()[0].data, before);
  p.onUnload();
});

test("card filenames preserve active originals and metadata while hiding soft-deleted attachments", () => {
  const p = packet();
  p.attachments = [
    { id: "one", name: "实验要求.pdf", size: 3, type: "application/pdf" },
    { id: "two", name: "会议记录", size: 2, type: "text/plain" },
    {
      id: "deleted",
      name: "已删除.png",
      deletedAt: "2026-10-26",
      size: 1,
      type: "image/png",
    },
  ];
  const rows = itemsFor([{ id: p.id, data: p }]);
  assert.equal(rows[0].attachmentCount, 2);
  assert.deepEqual(
    rows[0].cardFiles.map((f) => [f.name, f.extension]),
    [
      ["实验要求.pdf", "PDF"],
      ["会议记录", "FILE"],
    ],
  );
  assert.ok(rows[0].item);
});

test("a whole-card short touch routes actions, but the release from a lifted card cannot activate a control", () => {
  const f = dragFixture(),
    p = f.page;
  p.setData({ tab: "world" });
  const e = f.touch("task-a", 80, 90);
  p.dragTouchStart(e);
  p.onCardAction({
    currentTarget: { dataset: { action: "toggleStar", id: "task-a" } },
  });
  assert.equal(p._detail("task-a").starred, true);
  assert.equal(p._dragTouch, null);
  p.dragTouchStart(e);
  p.startDrag(e);
  assert.ok(p._drag);
  p.finishDrag({ touches: [] });
  p.onCardAction({
    currentTarget: { dataset: { action: "toggleStar", id: "task-a" } },
  });
  assert.equal(p._detail("task-a").starred, true);
  p._dragJustEndedAt = Date.now() - 500;
  p.onCardAction({
    currentTarget: { dataset: { action: "toggleStar", id: "task-a" } },
  });
  assert.equal(p._detail("task-a").starred, false);
  p.onUnload();
});

test("ice voices select distinct single-shot assets, stop before replay and persist", () => {
  const calls = [];
  let ended;
  const audio = {
    onEnded(fn) {
      ended = fn;
    },
    onError() {},
    play() {
      calls.push(["play", this.src]);
    },
    stop() {
      calls.push(["stop"]);
    },
    destroy() {},
  };
  const { page, store } = fixture({ audio });
  page.openSkins();
  assert.deepEqual(
    Array.from(page.data.skins, (s) => s.id),
    ["whale", "ice"],
  );
  page.previewSkin(event("ice"));
  page.interactSkin();
  assert.equal(audio.src, "/assets/ice-voice-1.mp3");
  assert.equal(audio.loop, false);
  assert.equal(audio.obeyMuteSwitch, false);
  assert.equal(page.data.skinAnimating, false);
  assert.equal(page._skinMotionTimer, undefined);
  ended();
  assert.equal(page.data.skinAnimating, false);
  page.changeIceVoice({ currentTarget: { dataset: { voice: "voice-2" } } });
  assert.equal(page.data.previewSkin.id, "ice");
  page.applySkin();
  for (let i = 0; i < 3; i++) page.interactSkin();
  assert.equal(audio.src, "/assets/ice-voice-2.mp3");
  assert.equal(calls.filter((c) => c[0] === "play").length, 4);
  for (let i = 0; i < calls.length; i++)
    if (calls[i][0] === "play") assert.equal(calls[i - 1][0], "stop");
  const reopened = fixture({ store }).page;
  assert.equal(reopened.data.iceVoice, "voice-2");
  assert.equal(reopened.data.activeSkin.id, "ice");
  page.onUnload();
  reopened.onUnload();
});
