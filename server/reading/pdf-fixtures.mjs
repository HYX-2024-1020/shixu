// Project-authored synthetic PDFs: no third-party documents or fonts.
import { deflateSync } from "node:zlib";
export function pdfBytes(
  pages = [{ text: "中文😀PDF尾部" }],
  { compress = false, catalog = "" } = {},
) {
  const objects = [];
  const put = (value) => {
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    return objects.length;
  };
  const stream = (body, dictionary = "") => {
    let bytes = Buffer.from(body);
    if (compress) {
      bytes = deflateSync(bytes);
      dictionary += " /Filter /FlateDecode";
    }
    return Buffer.concat([
      Buffer.from(`<< /Length ${bytes.length}${dictionary} >>\nstream\n`),
      bytes,
      Buffer.from("\nendstream"),
    ]);
  };
  put(`<< /Type /Catalog /Pages 2 0 R ${catalog} >>`);
  put("");
  const chars = [
    ...new Set(
      pages.flatMap((p) => [...(p.text || "")]).filter((c) => c !== "\n"),
    ),
  ];
  const ids = new Map(
    chars.map((c, i) => [c, (i + 1).toString(16).padStart(4, "0")]),
  );
  const utf16 = (s) =>
    [...Buffer.from(s, "utf16le")].reduce(
      (out, _, i, b) =>
        i % 2
          ? out
          : out +
            b[i + 1].toString(16).padStart(2, "0") +
            b[i].toString(16).padStart(2, "0"),
      "",
    );
  const cmap = put(
    stream(
      `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Synthetic def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${chars.map((c) => `1 beginbfchar\n<${ids.get(c)}> <${utf16(c)}>\nendbfchar`).join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`,
    ),
  );
  const descendant = put(
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Synthetic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>",
  );
  const font = put(
    `<< /Type /Font /Subtype /Type0 /BaseFont /Synthetic /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${cmap} 0 R >>`,
  );
  const kids = [];
  for (const p of pages) {
    const text = (p.text || "")
      .split("\n")
      .map(
        (line, i) =>
          `1 0 0 1 ${p.reverse ? 300 - i * 100 : 20} ${9000 - i * 20} Tm <${[...line].map((c) => ids.get(c)).join("")}> Tj`,
      )
      .join("\n");
    const content = put(
      p.broken
        ? "<< /Length 20 /Filter /UnknownDecode >>\nstream\nnot valid\nendstream"
        : stream(`BT /F1 12 Tf\n${text}\nET\n${p.extra || ""}`),
    );
    const page = put(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10000 10000] /Rotate ${p.rotation || 0} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
    kids.push(`${page} 0 R`);
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >>`,
  );
  const parts = [Buffer.from("%PDF-1.7\n")],
    offsets = [0];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      body,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

export function pdfLimitSample() {
  const text = ("合成😀".repeat(20) + "\n").repeat(400);
  const pages = Array.from({length:4}, (_, i) => ({ text:
    (i === 0 ? "尾部唯一标记（位于可读前缀）\n" : "") + text +
    (i === 3 ? "已读前缀的最后内容" : "") }));
  const expectedText = pages.map(p => p.text.endsWith("\n") ? p.text : p.text + "\n").join("");
  return { name: "资源范围.pdf", type: "application/pdf",
    body: pdfBytes([...pages, {text}, {text:"不得假称已读的后缀"}], {compress:true}),
    expectedText, textUnitLimit: expectedText.length + 50 };
}
