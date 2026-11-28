import test from "node:test";
import assert from "node:assert/strict";
import { ReadingProviderReceipts } from "./provider-receipts.mjs";
import { ReadingLedger } from "./ledger.mjs";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "./deepseek.mjs";
import { sha256, readMaterial } from "./material.mjs";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
import { encodePng } from "./image.mjs";
const intent = {
  provider: "deepseek",
  requestHash: sha256("synthetic request"),
  model: "deepseek-flash",
};
const receipt = (extra = {}) => ({
  provider: "deepseek",
  requestHash: intent.requestHash,
  responseId: "synthetic-response-1",
  model: "synthetic-model-1",
  created: 1,
  httpStatus: 200,
  responseHash: sha256("synthetic response"),
  ...extra,
});
const usage = { prompt_tokens: 10, completion_tokens: 2 };
function fixture(t) {
  const l = new ReadingLedger(":memory:");
  t.after(() => l.close());
  l.freezePrice({ ...deepseekPriceSnapshots(1)[1] });
  l.grantInitial("a");
  return l;
}
function sent(l, id = "c", request = intent) {
  l.reserve({
    callId: id,
    account: "a",
    task: "t",
    block: id,
    generation: 1,
    priceId: deepseekPriceSnapshots(1)[1].id,
    maxPromptTokens: 100,
    maxOutputTokens: 100,
  });
  l.sent(id, request);
}
test("request intent is atomic with dispatch; receipts are immutable, private and idempotent", (t) => {
  const l = fixture(t);
  sent(l);
  assert.equal(l.receipts.review("c").status, "awaiting");
  l.settle("c", usage, receipt());
  const sequence = l.sequence("a");
  l.settle("c", usage, receipt());
  assert.equal(l.sequence("a"), sequence);
  assert.equal(l.wallet("a").spent, 18);
  const review = l.receipts.review("c");
  assert.equal(review.status, "linked");
  assert.equal(review.responseId, undefined);
  assert.equal(review.responseIdHash, sha256("synthetic-response-1"));
  assert.equal(review.finalBillingEvidence, false);
  assert.equal(
    l.receipts.review("c", { includeIds: true }).responseId,
    "synthetic-response-1",
  );
  for (const table of [
    "reading_provider_requests",
    "reading_provider_receipts",
    "reading_provider_response_links",
  ])
    assert.throws(
      () => l.db.exec("DELETE FROM " + table),
      /IMMUTABLE_PROVIDER_RECEIPT/,
    );
  l.audit("a");
});
test("reused supplier response ID on another local call preserves both fees and pauses", (t) => {
  const l = fixture(t);
  sent(l);
  l.settle("c", usage, receipt());
  sent(l, "other");
  assert.throws(
    () => l.settle("other", usage, receipt()),
    /PROVIDER_RECEIPT_RECONCILIATION/,
  );
  assert.equal(l.wallet("a").spent, 36);
  assert.equal(l.call("other").state, "settled");
  assert.equal(l.receipts.review("other").status, "conflict");
  assert.equal(
    l.db.prepare("SELECT paused FROM reading_controls").get().paused,
    1,
  );
  l.audit("a");
});
test("request mismatch, changed usage and missing receipt cannot certify a paid result", (t) => {
  for (const mode of ["hash", "usage", "missing"]) {
    const l = fixture(t);
    sent(l);
    if (mode === "usage") {
      l.settle("c", usage, receipt());
      assert.throws(
        () =>
          l.settle("c", { prompt_tokens: 11, completion_tokens: 2 }, receipt()),
        /USAGE_CONFLICT/,
      );
      assert.equal(l.receipts.review("c").status, "conflict");
    } else
      assert.throws(
        () =>
          l.settle(
            "c",
            usage,
            mode === "hash"
              ? receipt({ requestHash: sha256("other") })
              : undefined,
          ),
        /PROVIDER_RECEIPT_RECONCILIATION/,
      );
    assert.equal(l.wallet("a").spent, 18);
    assert.throws(
      () => l.receipts.assertUsable("c"),
      /PROVIDER_RECEIPT_RECONCILIATION/,
    );
  }
});
test("receipt failure still commits valid usage; independent receipt recovers crash before settlement", (t) => {
  const l = fixture(t);
  sent(l);
  const original = l.receipts.captureLocked;
  l.receipts.captureLocked = () => {
    throw Error("disk failure");
  };
  assert.throws(
    () => l.settle("c", usage, receipt()),
    /PROVIDER_RECEIPT_WRITE_FAILED/,
  );
  assert.equal(l.wallet("a").spent, 18);
  l.receipts.captureLocked = original;
  const b = fixture(t);
  sent(b);
  b.captureProviderReceipt("c", receipt(), usage);
  b.recoverSent();
  assert.equal(b.call("c").state, "settled");
  assert.equal(b.wallet("a").spent, 18);
  b.recoverSent();
  assert.equal(b.wallet("a").spent, 18);
});
test("response identity without usage retains full unknown risk; legacy has no invented identity", (t) => {
  const l = fixture(t);
  sent(l);
  l.captureUnknownReceipt("c", receipt());
  l.recoverSent();
  assert.equal(l.call("c").state, "unknown");
  assert.equal(l.wallet("a").spent, 0);
  assert.ok(l.wallet("a").unknownRisk > 0);
  assert.equal(l.receipts.review("old").status, "legacy-unrecorded");
});
test("adapter hashes exact bytes and carries response metadata on invalid usage, without retry or raw body", async () => {
  let calls = 0;
  const body = {
      id: "synthetic-id",
      model: "synthetic-model",
      created: 42,
      usage,
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    },
    raw = JSON.stringify(body),
    sources = [{ id: "s", name: "x.txt", text: "合成" }];
  const provider = createDeepSeekReadingProvider({
      apiKey: "synthetic",
      priceAt: () => deepseekPriceSnapshots(1)[1].id,
      fetcher: async () => {
        calls++;
        return new Response(raw);
      },
    }),
    prepared = provider.prepare(sources, { captureDate: "2026-11-01" }),
    response = await provider(sources, undefined, { prepared });
  assert.equal(prepared.receiptIntent.requestHash, sha256(prepared.body));
  assert.equal(response.receipt.responseHash, sha256(raw));
  assert.equal(response.receipt.responseId, body.id);
  assert.equal(calls, 1);
  const bad = createDeepSeekReadingProvider({
    apiKey: "synthetic",
    priceAt: () => prepared.priceId,
    fetcher: async () => {
      calls++;
      return Response.json({ ...body, usage: null });
    },
  });
  await assert.rejects(
    bad(sources, undefined, { prepared }),
    (e) =>
      e.message === "PROVIDER_USAGE_UNKNOWN" &&
      e.receipt.responseId === body.id &&
      !JSON.stringify(e).includes("choices"),
  );
  assert.equal(calls, 2);
  const http = createDeepSeekReadingProvider({
    apiKey: "synthetic",
    priceAt: () => prepared.priceId,
    fetcher: async () => new Response("private error", { status: 503 }),
  });
  await assert.rejects(
    http(sources, undefined, { prepared }),
    (e) => e.receipt.httpStatus === 503 && e.receipt.responseHash === null,
  );
  const l = fixture({ after: () => {} });
  try {
    sent(l, "c", prepared.receiptIntent);
    l.captureUnknownReceipt("c", {
      provider: "deepseek",
      requestHash: prepared.receiptIntent.requestHash,
      responseId: null,
      model: null,
      created: null,
      httpStatus: 503,
      responseHash: null,
    });
    l.unknown("c");
    assert.equal(l.receipts.review("c").status, "missing");
  } finally {
    l.close();
  }
});

function traced(fn, label, { fail = false } = {}) {
  let calls = 0;
  const prepare = (sources) => ({
    receiptIntent: {
      provider: "deepseek",
      requestHash: sha256(JSON.stringify(sources)),
      model: "synthetic-model",
    },
  });
  return Object.assign(
    async (sources, signal, context) => {
      calls++;
      const value = receipt({
        requestHash: context.prepared.receiptIntent.requestHash,
        responseId: label + "-" + calls,
        responseHash: sha256(label + calls),
      });
      if (fail) throw Object.assign(Error("no usage"), { receipt: value });
      return { ...(await fn(sources, signal, context)), receipt: value };
    },
    { prepare },
  );
}
test("organizing, semantic, history and item-chat stages persist their own request and receipt through publication", async (t) => {
  const f = mergeFixture(t);
  const provider = traced(f.tasks.provider, "organize");
  provider.merge = traced(f.tasks.provider.merge, "merge");
  provider.association = traced(
    async () => ({ usage, result: { links: [] } }),
    "history",
  );
  provider.chat = traced(
    async () => ({
      usage,
      result: { reply: "合成回复", patch: { group: "证据组" } },
    }),
    "chat",
  );
  f.tasks.provider = provider;
  f.store.apply(
    f.device,
    {
      id: "history",
      opId: "seed-history",
      type: "put",
      baseVersion: 0,
      data: {
        text: "",
        sources: [],
        attachments: [],
        captureDate: "2026-11-01",
        status: "ready",
        itemIds: ["old"],
        result: {
          summary: "",
          warnings: [],
          items: [
            {
              kind: "task",
              title: "历史报告",
              summary: "",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [{ sourceId: "old", quote: "历史报告" }],
            },
          ],
        },
      },
    },
    f.store.epoch,
  );
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  const packet = f.store.record("packet");
  f.tasks.enqueue({
    id: "chat",
    packetId: "packet",
    deviceId: f.device,
    chat: {
      itemId: packet.data.itemIds[0],
      instruction: "放到证据组",
      baseVersion: packet.version,
      epoch: f.store.epoch,
    },
  });
  assert.equal((await finishMerge(f.tasks, "chat")).state, "done");
  const rows = f.ledger.db.prepare("SELECT id FROM reading_calls").all();
  assert.ok(rows.length >= 5);
  for (const { id } of rows)
    assert.equal(f.ledger.receipts.review(id).status, "linked");
  assert.equal(
    f.store.record("packet").data.itemState[packet.data.itemIds[0]].group,
    "证据组",
  );
  // An otherwise valid paid proof cannot be reused once later supplier evidence conflicts.
  const proof = f.ledger.db
    .prepare("SELECT * FROM reading_paid_proofs LIMIT 1")
    .get();
  f.ledger.captureProviderReceipt(
    proof.call_id,
    receipt({ requestHash: sha256("wrong request") }),
  );
  assert.throws(
    () => f.tasks.reuse.proof(proof.task, proof.fingerprint),
    /PROVIDER_RECEIPT_RECONCILIATION/,
  );
});
test("visual review and missing-usage provider failure retain independent receipt metadata", async (t) => {
  const main = traced(
    async (sources) => ({
      usage,
      result: {
        summary: "合成",
        warnings: [],
        items: [
          {
            kind: "task",
            title: "提交报告",
            summary: "",
            facts: ["格式PDF"],
            nextSteps: [],
            uncertainties: [],
            due: null,
            evidence: [{ sourceId: sources[0].id, quote: "格式PDF" }],
          },
        ],
      },
    }),
    "image",
  );
  main.imageInput = true;
  main.reviewVisual = traced(
    async (sources) => ({
      usage,
      result: {
        claims: JSON.parse(sources[0].text).claims.map((c) => ({
          id: c.id,
          status: "supported",
          reason: "",
        })),
      },
    }),
    "review",
  );
  const f = mergeFixture(t, {
    provider: main,
    sourceName: "x.png",
    sourceBytes: encodePng(1, 1, Buffer.from([0, 0, 0, 255])),
    reader: Object.assign((file, o) => readMaterial(file, o), {
      imageWindows: true,
      pdfWindows: true,
    }),
  });
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(
    f.ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_provider_requests")
      .get().n,
    2,
  );
  for (const row of f.ledger.db.prepare("SELECT id FROM reading_calls").all())
    assert.equal(f.ledger.receipts.review(row.id).status, "linked");
  const bad = mergeFixture(t, {
    provider: traced(async () => {}, "unknown", { fail: true }),
    sourceText: "合成",
  });
  bad.enqueue();
  assert.equal((await finishMerge(bad.tasks)).reason, "UNKNOWN_COST");
  const call = bad.ledger.db.prepare("SELECT * FROM reading_calls").get();
  assert.equal(call.state, "unknown");
  assert.equal(bad.ledger.receipts.review(call.id).status, "linked");
  assert.ok(bad.ledger.wallet("synthetic").unknownRisk > 0);
});

test("changed dispatch intent is refused before another send and missing schema protection fails startup", (t) => {
  const l = fixture(t);
  sent(l);
  assert.throws(
    () => l.sent("c", { ...intent, requestHash: sha256("changed") }),
    /PROVIDER_REQUEST_CONFLICT/,
  );
  assert.equal(l.call("c").state, "sent");
  assert.equal(l.wallet("a").spent, 0);
  assert.equal(
    l.db.prepare("SELECT paused FROM reading_controls").get().paused,
    1,
  );
  l.db.exec("DROP TRIGGER reading_provider_receipts_update");
  assert.throws(
    () => new ReadingProviderReceipts(l),
    /READING_SCHEMA_MISMATCH/,
  );
});
test("valid usage with missing supplier identity remains chargeable and is never labelled linked", (t) => {
  const l = fixture(t);
  sent(l);
  l.settle(
    "c",
    usage,
    receipt({ responseId: null, model: null, created: null }),
  );
  assert.equal(l.wallet("a").spent, 18);
  assert.equal(l.receipts.review("c").status, "missing");
  assert.equal(l.receipts.review("c").responseIdHash, null);
  l.audit("a");
});

test("a later incomplete observation cannot downgrade a linked response or erase its conflict", (t) => {
  const l = fixture(t);
  sent(l);
  l.settle("c", usage, receipt());
  l.captureUnknownReceipt("c", receipt({ responseId: null }));
  assert.equal(l.receipts.review("c").status, "conflict");
  l.captureUnknownReceipt("c", receipt());
  assert.equal(l.receipts.review("c").status, "conflict");
  assert.equal(l.wallet("a").spent, 18);
});
