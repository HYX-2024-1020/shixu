import { readFileSync } from "node:fs";
import { readMaterial } from "./material.mjs";

// Fixed paths provided by the broker. User input never becomes an OS path.
const descriptor = JSON.parse(readFileSync("/input/descriptor.json", "utf8"));
const started = performance.now();
try {
  const material = await readMaterial({
    ...descriptor,
    body: readFileSync("/input/original"),
  }, { pdfWindow: descriptor.pdfWindow });
  const parsedAt = performance.now();
  const serialized = JSON.stringify(material);
  process.stdout.write('{"material":');
  process.stdout.write(serialized, () => {
    // Capture RSS after serialization and pipe writes, not before the largest
    // allocation. Keep large material strings out of diagnostics/journald.
    process.stdout.write(
      ',"metrics":' +
        JSON.stringify({
          parseMs: parsedAt - started,
          serializationAndTransferMs: performance.now() - parsedAt,
          maxRssKiB: process.resourceUsage().maxRSS,
        }) +
        "}",
    );
  });
} catch {
  process.stdout.write(JSON.stringify({ error: "READING_FAILED" }));
  process.exitCode = 1;
}
