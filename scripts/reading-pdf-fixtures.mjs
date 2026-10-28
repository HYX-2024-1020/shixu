import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pdfLoopOriginal } from "./reading-pdf-samples.mjs";
const base = resolve(process.argv[2] || "");
await writeFile(
  base + "/pdf-loop-fixture.json",
  JSON.stringify({
    ...pdfLoopOriginal,
    body: pdfLoopOriginal.body.toString("base64"),
  }),
);
