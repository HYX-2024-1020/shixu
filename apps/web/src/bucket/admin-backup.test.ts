import { describe, it, expect } from "vitest";
import {
  encodeSnapshot,
  decodeSnapshot,
  type BrowserSnapshot,
} from "./admin-backup";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
const fixture = (): BrowserSnapshot => ({
  packets: [
    {
      id: "packet-1",
      text: "合成通知",
      sources: [{ id: "input", name: "输入", text: "合成通知" }],
      attachments: [],
      capturedAt: "2026-10-31T00:00:00Z",
      captureDate: "2026-10-31",
      status: "pending",
      result: null,
      error: "",
      doneIds: [],
      updatedAt: "2026-10-31T00:00:00Z",
    },
  ],
  usage: [],
  draft: {
    text: "未投递草稿",
    attachments: [
      {
        id: "draft-file",
        name: "合成.txt",
        type: "text/plain",
        size: 3,
        blob: new Blob(["abc"]),
      },
    ],
  },
});
describe("administrator local backups", () => {
  it("round trips original bytes and drafts and requires explicit retry for restored work", async () => {
    const data = await encodeSnapshot(fixture());
    const restored = decodeSnapshot(data);
    expect(restored.draft.text).toBe("未投递草稿");
    expect(await restored.draft.attachments[0].blob!.text()).toBe("abc");
    expect(restored.packets[0].status).toBe("error");
    expect(restored.packets[0].syncAutoOrganize).toBe(false);
    expect(
      Object.keys(JSON.parse(strFromU8(unzipSync(data)["manifest.json"]))),
    ).toEqual(["format", "exportedAt", "packets", "usage", "draft"]);
  });
  it("rejects malformed result structures and missing originals before writing anything", async () => {
    const data = unzipSync(await encodeSnapshot(fixture()));
    delete data["files/draft-file"];
    expect(() => decodeSnapshot(zipSync(data))).toThrow("不完整");
    const invalid: any = fixture();
    invalid.format = "shixu-admin-test-v1";
    invalid.packets[0].result = { summary: "", items: "broken", warnings: [] };
    expect(() =>
      decodeSnapshot(
        zipSync({ "manifest.json": strToU8(JSON.stringify(invalid)) }),
      ),
    ).toThrow("不完整");
  });
  it("refuses an export that would silently omit an original", async () => {
    const value = fixture();
    delete value.draft.attachments[0].blob;
    await expect(encodeSnapshot(value)).rejects.toThrow("原件缺失");
  });
});
