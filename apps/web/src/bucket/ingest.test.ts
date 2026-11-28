import { it, expect } from "vitest";
import { ingestAttachment } from "./ingest";
it("identifies split archive payloads before attempting extraction and reports the alternative", async () => {
  for (const name of [
    "资料.part1.rar",
    "资料.r00",
    "资料.7z.001",
    "资料.zip.001",
    "资料.z01",
  ]) {
    const result = await ingestAttachment(
      { id: "split", name, size: 1, type: "", blob: new Blob(["0"]) },
      { apiKey: "unused", captureDate: "2026-10-23" },
    );
    expect(result.sources).toEqual([]);
    expect(result.coverage[0].state).toBe("failed");
    expect(result.coverage[0].detail).toContain("分卷");
    expect(result.coverage[0].detail).toContain("首版不自动合并");
  }
});
