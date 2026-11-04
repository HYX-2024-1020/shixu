import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { archiveSample, zipBytes } from "../server/reading/archive-fixtures.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
const base = resolve(process.argv[2] || "");
const mixed = archiveSample(), long = archiveSample({ long: true });
const corrupt = zipBytes({ "损坏.txt": "crc-marker", "后续.txt": "安全尾部😀" });
corrupt[corrupt.indexOf(Buffer.from("crc-marker"))] ^= 1;
const samples = [mixed, long,
  { name: "损坏.zip", body: corrupt, expectedText: "安全尾部😀" },
  { name: "危险.zip", body: zipBytes({ "安全.txt": "不得读取", "../逃逸.txt": "no" }), expectedText: "" },
  { name: "炸弹.zip", body: zipBytes({ "大.txt": "x".repeat(200000) }, { level: 9 }), expectedText: "" },
];
const evidence = [];
for (const sample of samples) {
  const file = { id: "zip", name: sample.name, body: sample.body, hash: sha256(sample.body), size: sample.body.length };
  const golden = await readMaterial(file);
  const textHash = sha256(sample.expectedText);
  assert.equal(sha256(golden.segments.map(s => s.text).join("")), textHash);
  evidence.push({ file: { ...file, body: file.body.toString("base64") }, textHash, golden });
}
await writeFile(base + "/zip-samples.json", JSON.stringify(evidence));
await writeFile(base + "/zip-loop-fixture.json", JSON.stringify({ name: long.name, type: long.type, body: long.body.toString("base64") }));
