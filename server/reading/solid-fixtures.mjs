import { sevenZipBytes } from "./native-archive-fixtures.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
export function solidText(length = 30000) {
  let seed = 712;
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < bytes.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    bytes[i] = 32 + ((seed >>> 0) % 90);
  }
  return bytes;
}
export async function solidWindowSample() {
  const text = solidText(),
    entries = {
      "01说明😀.txt": text,
      "02.pdf": pdfBytes(
        Array.from({ length: 19 }, (_, i) => ({
          text: "solid第" + (i + 1) + "页唯一合成内容",
        })),
      ),
      "03.txt": text,
      "04尾部.txt": Buffer.from("solid尾部唯一标记"),
    };
  return { body: await sevenZipBytes(entries, ["-mx=1", "-ms=on"]), entries };
}
