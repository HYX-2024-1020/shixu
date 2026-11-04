import test from "node:test";
import assert from "node:assert/strict";
import { readMaterial, sha256 } from "./material.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
import { validatePdfWindow } from "./pdf-window.mjs";
import { ReadingWindows } from "./windows.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { processingView } from "../../shared/reading-view.mjs";
const descriptor = (body) => ({
  id: "pdf",
  name: "分页.pdf",
  body,
  size: body.length,
  hash: sha256(body),
});
test("PDF page windows stitch to exact full text, Unicode offsets, source IDs and visual omissions", async () => {
  const pages = Array.from({ length: 19 }, (_, i) => ({
    text: i === 8 ? "" : `第${i + 1}页独有正文😀\n尾部${i}`,
  }));
  const file = descriptor(pdfBytes(pages, { compress: true }));
  const full = await readMaterial(file);
  let cursor = { page: 1, offset: 0 };
  const segments = [],
    covered = [],
    uncovered = [];
  for (let n = 0; n < 10 && cursor; n++) {
    const m = await readMaterial(file, { pdfWindow: cursor });
    segments.push(...m.segments);
    covered.push(...m.covered);
    uncovered.push(
      ...m.uncovered.filter((r) => r.code !== "PDF_WINDOW_PENDING"),
    );
    cursor = m.pagination.nextPage
      ? { page: m.pagination.nextPage, offset: m.pagination.nextOffset }
      : null;
  }
  assert.equal(cursor, null);
  assert.deepEqual(segments, full.segments);
  assert.deepEqual(covered, full.covered);
  assert.deepEqual(uncovered, full.uncovered);
  assert.equal(new Set(covered.map((r) => r.sourceId)).size, covered.length);
  const first = await readMaterial(file, { pdfWindow: { page: 1, offset: 0 } });
  const verify = (value) =>
    ReadingWindows.prototype.verify(value, { page: 1, offset: 0 });
  verify(first);
  assert.throws(
    () =>
      verify({
        ...first,
        pagination: {
          ...first.pagination,
          nextOffset: first.pagination.nextOffset + 1,
        },
      }),
    /INVALID_READER_WINDOW/,
  );
  assert.throws(
    () =>
      verify({ ...first, pagination: { ...first.pagination, nextPage: 8 } }),
    /INVALID_READER_WINDOW/,
  );
  for (const value of [
    { page: 0, offset: 0 },
    { page: 1, offset: -1 },
    { page: 1, offset: 0, probe: "network" },
    [],
    null,
  ])
    assert.throws(() => validatePdfWindow(value), /INVALID_PDF_WINDOW/);
});
function fixture(t, { blankPrefix = false, invalidReader = false, archive = false } = {}) {
  const store = new SyncStore(":memory:");
  createAttachmentStore(store);
  const ledger = new ReadingLedger(":memory:");
  ledger.grantInitial("a");
  ledger.freezePrice({
    id: "test",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  const device = store.createDevice("synthetic").deviceId;
  const pages = Array.from({ length: 19 }, (_, i) => ({
    text: blankPrefix && i < 8 ? "" : `第${i + 1}页独有正文😀，尾部${i}`,
  }));
  let calls = 0;
  const reads = [];
  const put = (data) =>
    store.apply(
      device,
      {
        id: "p",
        opId: crypto.randomUUID(),
        type: "put",
        baseVersion: store.record("p")?.version || 0,
        data,
      },
      store.epoch,
    );
  put({
    text: "",
    sources: [],
    attachments: [],
    captureDate: "2026-10-29",
    result: null,
    status: "pending",
  });
  const pdf = pdfBytes(pages, { compress: true });
  const bytes = archive ? zipBytes({"01.txt":"前件😀", "02.pdf":pdf,"03.txt":"尾部唯一标记"}) : pdf;
  const file = store.files.put("p", "pdf", {
    name: archive ? "分页.zip" : "分页.pdf",
    body: bytes,
    type: "application/pdf",
    epoch: store.epoch,
  });
  const text = store.files.put("p", "txt", {
    name: "后件.txt",
    body: Buffer.from("后件安全原文"),
    type: "text/plain",
    epoch: store.epoch,
  });
  put({ attachments: [file, text] });
  const args = {
    store,
    ledger,
    account: "a",
    priceId: "test",
    modelVersion: "synthetic/1",
    authorize: (id) => assert.equal(id, device),
    reader: Object.assign(
      async (file, options) => {
        reads.push({ id: file.id, window: options.pdfWindow, archiveWindow:options.archiveWindow });
        return readMaterial(
          file,
          invalidReader ? {} : { pdfWindow: options.pdfWindow, archiveWindow:options.archiveWindow },
        );
      },
      { pdfWindows: true, archiveWindows:archive },
    ),
    provider: async (sources) => {
      calls++;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成事项",
              summary: "合成结果",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [
                {
                  sourceId: sources[0].id,
                  quote: sources[0].text.slice(0, 10),
                },
              ],
            },
          ],
        },
      };
    },
  };
  let tasks = new ReadingTasks(args);
  const action = (name) => {
    const current = tasks.get("t");
    return tasks.action(
      "t",
      {
        operationId: crypto.randomUUID(),
        expectedGeneration: current.generation,
        expectedRevision: current.input_revision,
      },
      name,
      device,
    );
  };
  tasks.enqueue({ id: "t", packetId: "p", deviceId: device });
  t.after(() => {
    tasks.close();
    ledger.close();
    store.close();
  });
  return {
    store,
    ledger,
    reads,
    pages,
    args,
    action,
    get tasks() {
      return tasks;
    },
    calls: () => calls,
    restart() {
      tasks.close();
      tasks = new ReadingTasks(args);
    },
    async finish() {
      for (let n = 0; n < 50 && tasks.get("t").state === "queued"; n++)
        await tasks.run("t");
      return tasks.get("t");
    },
  };
}
test("bounded task windows preserve order, release old text, skip completed other originals and resume paid pages after restart", async (t) => {
  const f = fixture(t);
  await f.tasks.run("t");
  assert.equal(f.calls(), 1);
  f.action("stop");
  f.restart();
  f.action("continue");
  assert.equal((await f.finish()).state, "done");
  assert.equal(f.calls(), 4); // Three PDF windows, then the TXT original.
  assert.deepEqual(
    f.reads.filter((r) => r.id === "pdf").map((r) => r.window.page),
    [1, 1, 9, 17],
  );
  assert.equal(f.reads.filter((r) => r.id === "txt").length, 1);
  const coverage = f.store.record("p").data.readingCoverage;
  assert.deepEqual(
    coverage[0].covered.map((r) => r.page),
    Array.from({ length: 19 }, (_, i) => i + 1),
  );
  assert.ok(
    !coverage[0].uncovered.some((r) => r.code === "PDF_WINDOW_PENDING"),
  );
  assert.equal(coverage[0].pagination.nextPage, null);
  assert.equal(f.tasks.materials.size, 0);
  assert.ok(!JSON.stringify(f.tasks.windows.rows("t")).includes("独有正文"));
  assert.equal(f.tasks.roots.stats("t").calls, 4);
});
test("empty early PDF windows advance without models, and a reader ignoring window cursors fails closed", async (t) => {
  const blank = fixture(t, { blankPrefix: true });
  assert.equal((await blank.finish()).state, "done");
  assert.equal(blank.calls(), 3);
  assert.deepEqual(
    blank.reads.filter((r) => r.id === "pdf").map((r) => r.window.page),
    [1, 9, 17],
  );
  const bad = fixture(t, { invalidReader: true });
  assert.equal((await bad.finish()).state, "paused");
  assert.equal(bad.calls(), 0);
  assert.equal(bad.tasks.windows.rows("t").length, 0);
});
test("a failed cursor transaction cannot skip a paid window or incur a duplicate charge on retry", async (t) => {
  const f = fixture(t);
  await f.tasks.run("t");
  const prepare = f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare = (sql) => {
    if (sql.startsWith("INSERT OR REPLACE INTO reading_windows"))
      throw Error("synthetic cursor failure");
    return prepare(sql);
  };
  try {
    assert.equal((await f.tasks.run("t")).state, "paused");
  } finally {
    f.store.db.prepare = prepare;
  }
  assert.equal(f.tasks.windows.rows("t").length, 0);
  assert.equal(f.calls(), 1);
  f.action("continue");
  assert.equal((await f.finish()).state, "done");
  assert.equal(f.calls(), 4);
});
test("accepting paid partial windows distinguishes unread future pages from unprocessed text", async (t) => {
  const f = fixture(t);
  await f.tasks.run("t");
  f.tasks.activeLimitMs = 1;
  assert.equal((await f.tasks.run("t")).state, "paused");
  assert.equal(f.action("accept-partial").state, "partial");
  const processing = f.store.record("p").data.processingCoverage;
  assert.equal(processing.pending.length, 0);
  assert.deepEqual(
    processing.unread.map((r) => [r.page, r.pageEnd]),
    [[9, 19]],
  );
  assert.match(processingView(processing), /后续页尚未读取：PDF 第 9–19 页/);
  assert.equal(f.calls(), 1);
});

test("archive member windows resume paid work after restart, retain PDF progress and require cursor-aware readers", async t => {
  const f = fixture(t,{archive:true});
  for(let n=0;n<3;n++) await f.tasks.run("t");
  assert.equal(f.calls(),2);
  f.action("stop"); f.restart(); f.action("continue");
  assert.equal((await f.finish()).state,"done",JSON.stringify(f.tasks.get("t")));
  assert.equal(f.calls(),6); // Three PDF windows, two archive text members and other original.
  const coverage=f.store.record("p").data.readingCoverage[0];
  assert.deepEqual(coverage.archivePdfPages,[{archivePath:"02.pdf",checked:19,total:19}]);
  assert.equal(coverage.archivePagination.next,null);
  assert.equal(coverage.covered.filter(r=>r.archivePath==="02.pdf").length,19);
  assert.ok(!coverage.uncovered.some(r=>/WINDOW_PENDING/.test(r.code)));
  assert.ok(!JSON.stringify(f.tasks.windows.rows("t")).includes("独有正文"));
  assert.equal(f.tasks.materials.size,0);
  assert.deepEqual(f.reads.filter(r=>r.archiveWindow?.entry===1).map(r=>r.archiveWindow.page),[1,1,9,17]);
  const bad=fixture(t,{archive:true,invalidReader:true});
  assert.equal((await bad.finish()).state,"paused");
  assert.equal(bad.calls(),0);
});
test("archive cursor writes are atomic and paid blocks survive a failed cursor commit", async t => {
  const f=fixture(t,{archive:true});
  await f.tasks.run("t");
  const prepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=sql=>{
    if(sql.startsWith("INSERT OR REPLACE INTO reading_windows"))throw Error("synthetic cursor failure");
    return prepare(sql);
  };
  try {assert.equal((await f.tasks.run("t")).state,"paused");}
  finally {f.store.db.prepare=prepare;}
  assert.equal(f.tasks.windows.rows("t").length,0);
  f.action("continue");
  assert.equal((await f.finish()).state,"done",JSON.stringify(f.tasks.get("t")));
  assert.equal(f.calls(),6);
});
test("partial archive publication names unread members and pages, never classifies them as processed", async t=>{
  const f=fixture(t,{archive:true});
  // Commit the first text member, then pay the first PDF window.
  for(let n=0;n<3;n++) await f.tasks.run("t");
  f.tasks.activeLimitMs=1;
  assert.equal((await f.tasks.run("t")).state,"paused");
  assert.equal(f.action("accept-partial").state,"partial");
  const p=f.store.record("p").data.processingCoverage;
  assert.ok(p.unread.some(r=>r.archivePath==="02.pdf"&&r.page===9&&r.pageEnd===19));
  assert.ok(p.unread.some(r=>r.archivePath==="03.txt"&&r.code==="ARCHIVE_WINDOW_PENDING"));
  assert.ok(!p.processed.some(r=>r.archivePath==="03.txt"));
  assert.match(processingView(p),/包内 “03.txt”/);
});
