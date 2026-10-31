import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nativeArchiveSample } from "../server/reading/native-archive-fixtures.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { runClientLoop } from "./reading-client-loop.mjs";
import { readingView } from "../shared/reading-view.mjs";
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-native-clients";
await mkdir(staging, { mode: 0o700 });
const isolated = createLinuxReader({
  runtime: "/opt/shixu-bcd-test-20261028/runtime",
  staging,
});
const report = { synthetic: true, realProviderCalls: 0, cases: [] };
try {
  for (const format of ["rar", "7z"]) {
    const directory = await mkdtemp(join(base, "native-loop-"));
    try {
      const original = await nativeArchiveSample(format, { long: true });
      const start = performance.now();
      const result = await runClientLoop({
        directory,
        reader: async (...args) => (await isolated(...args)).material,
        sourceByMini: true,
        startByMini: true,
        reviseAfterPublication: true,
        ...(format === "rar"
          ? { originalQuota: 1, expireBeforeStart: true }
          : { deleteBeforeStart: true }),
        original: {
          ...original,
          verify({ win, mini, page }) {
            assert.deepEqual(win.readingCoverage, mini.readingCoverage);
            assert.match(
              readingView(win.readingCoverage)[0].missing,
              /05页面.pdf.*第 2 页/,
            );
            assert.match(
              page._detail(win.itemIds[0]).evidence[0].name,
              /01说明.txt/,
            );
          },
        },
      });
      report.cases.push({
        format,
        elapsedMs: performance.now() - start,
        ...result,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  await writeFile(
    join(base, "native-clients-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(staging, { recursive: true, force: true });
}
