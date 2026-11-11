import { it, expect } from "vitest";
import { readableFileName } from "./file-display";
import type { Packet, Attachment } from "./types";
it("names opaque files from available context while retaining original identity", () => {
  const file: Attachment = {
    id: "image",
    name: "ba19a52e6c728835f81a4ff3459352b1.png",
    size: 10,
    type: "image/png",
  };
  const packet = {
    text: "实验室安全教育通知",
    attachments: [file],
    readingCoverage: [],
  } as unknown as Packet;
  expect(readableFileName(file, packet)).toBe(
    "实验室安全教育通知·相关材料1.png",
  );
  expect(file.name).toBe("ba19a52e6c728835f81a4ff3459352b1.png");
  expect(readableFileName({ ...file, name: "安全教育通知.png" }, packet)).toBe(
    "安全教育通知.png",
  );
  expect(readableFileName(file, { ...packet, text: "" })).toBe("投递材料1.png");
});
