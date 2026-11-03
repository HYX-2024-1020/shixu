import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectVisualReview, visualClaims } from "./visual-review.mjs";

for (const sample of ["pipeline", "replay"]) {
  test(`current visual projection replays archived scanned-PDF evidence: ${sample}`, () => {
    const evidence = JSON.parse(readFileSync(new URL(
      `../../docs/bcd/evidence/visual-review-real-${sample}.json`, import.meta.url,
    ), "utf8"));
    const [upstream] = evidence.modelResponses;
    const imageIds = new Set(evidence.coverage.flatMap(
      coverage => coverage.covered.map(range => range.sourceId),
    ));
    const claims = visualClaims(upstream, imageIds);
    const decisions = evidence.visualReviews.flatMap(review => review.result.claims);
    const { result, uncertain } = projectVisualReview(upstream, claims, decisions);
    assert.equal(result.items.length, 1);
    const [item] = result.items;
    assert.equal(item.kind, "task");
    assert.match(item.title, /^提交图像实验报告/);
    assert.equal(item.due.date, "2026-11-03");
    assert.equal(item.due.time, "16:45");
    const facts = item.facts.join("\n");
    assert.match(facts, /PDF/);
    assert.match(facts, /学号_姓名/);
    assert.match(facts, /算法思路/);
    assert.match(facts, /时间复杂度/);
    assert.ok(item.evidence.length > 0);
    assert.ok(item.evidence.every(quote => imageIds.has(quote.sourceId)));
    assert.doesNotMatch([...item.facts, ...item.nextSteps].join("\n"), /(?:写入|加入|写在).*尾部|尾部.*(?:写入|加入|写在)/);
    if (sample === "replay") {
      assert.equal(uncertain, 2);
      assert.match(item.uncertainties.join("\n"), /尾部/);
    } else {
      assert.equal(uncertain, 0);
    }
  });
}
