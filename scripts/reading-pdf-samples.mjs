import { pdfBytes } from "../server/reading/pdf-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
const smallPages = [
  { text: "中文😀第一页\n第二行" },
  { text: "旋转页尾部唯一标记", rotation: 90 },
  { text: "" },
];
const longPages = [
  ...Array.from({ length: 180 }, (_, i) => ({
    text: `第${i + 1}页合成资料😀。\n`.repeat(100),
  })),
  { text: "" },
  { text: "尾部唯一标记", rotation: 270 },
];
export const pdfSamples = [
  {
    name: "unicode.pdf",
    pages: smallPages,
    text: "中文😀第一页\n第二行\n旋转页尾部唯一标记\n",
    state: "partial",
  },
  {
    name: "long.pdf",
    pages: longPages,
    text: longPages
      .filter((p) => p.text)
      .map((p) => (p.text.endsWith("\n") ? p.text : p.text + "\n"))
      .join(""),
    state: "partial",
  },
  { name: "blank.pdf", pages: [{ text: "" }], text: "", state: "failed" },
  {
    name: "damaged-page.pdf",
    pages: [
      { text: "安全前页" },
      { broken: true },
      { text: "安全尾部唯一标记" },
    ],
    text: "安全前页\n安全尾部唯一标记\n",
    state: "partial",
  },
  {
    name: "invalid.pdf",
    body: Buffer.from("%PDF-invalid"),
    text: "",
    state: "failed",
  },
  // Deliberate JS and external-action strings are untrusted document bytes;
  // text extraction never runs a PDF scripting manager or follows actions.
  {
    name: "actions.pdf",
    pages: [
      {
        text: "动作只能作为数据",
        extra:
          "% /JavaScript (throw forbidden) /URI (https://example.invalid/)",
      },
    ],
    text: "动作只能作为数据\n",
    state: "partial",
  },
].map((s) => ({
  ...s,
  body:
    s.body ||
    pdfBytes(s.pages, {
      compress: true,
      ...(s.name === "actions.pdf"
        ? {
            catalog:
              "/OpenAction << /S /JavaScript /JS (globalThis.__shixuPdfExecuted = true) >> /AA << /WC << /S /URI /URI (https://example.invalid/) >> >>",
          }
        : {}),
    }),
  textHash: sha256(s.text),
}));
export const pdfLoopOriginal = {
  name: "合成.pdf",
  type: "application/pdf",
  body: pdfSamples[1].body,
};
