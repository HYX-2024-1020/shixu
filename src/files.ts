export async function extractFile(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error("请选择小于 15 MB 的文件");
  const extension = file.name.split(".").pop()?.toLowerCase();
  let text = "";
  if (["txt", "md", "csv"].includes(extension || "")) {
    const buffer = await file.arrayBuffer();
    text = new TextDecoder("utf-8").decode(buffer);
    if ((text.match(/\ufffd/g) || []).length > 3)
      text = new TextDecoder("gb18030").decode(buffer);
  } else if (extension === "docx") {
    const { unzipSync, strFromU8 } = await import("fflate");
    const contents = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (item) => {
        if (item.name !== "word/document.xml") return false;
        if (item.originalSize > 5 * 1024 * 1024)
          throw new Error("文档解压后的文字过大，请拆分后导入");
        return true;
      },
    });
    if (!contents["word/document.xml"])
      throw new Error("无法读取 DOCX 正文，请检查文件是否损坏");
    const xml = new DOMParser().parseFromString(
      strFromU8(contents["word/document.xml"]),
      "application/xml",
    );
    if (xml.querySelector("parsererror"))
      throw new Error("DOCX 正文格式不正确");
    text = Array.from(xml.getElementsByTagNameNS("*", "p"))
      .map((p) =>
        Array.from(p.getElementsByTagNameNS("*", "t"))
          .map((t) => t.textContent || "")
          .join(""),
      )
      .join("\n");
  } else if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 100)
        throw new Error("文件超过 100 页，请先拆分后导入");
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join(""),
        );
      }
      text = pages.join("\n\n");
    } finally {
      await task.destroy();
    }
  } else
    throw new Error(
      "支持 TXT、Markdown、CSV、DOCX 和文字型 PDF。旧版 DOC 请先另存为 DOCX。",
    );
  if (!text.trim())
    throw new Error("没有读到文字，扫描件 PDF 请先用 OCR 转成文字型 PDF");
  if (text.length > 60000) throw new Error("文字超过 6 万字，请拆分文件后导入");
  return text.trim();
}

export function extractiveSummary(text: string): string[] {
  const sentences = text
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && !/^https?:/.test(s));
  const important = sentences.map((s, index) => ({
    s,
    index,
    score:
      (/截止|提交|作业|考试|时间|地点|要求|注意|材料|报名|请|需要|必须/.test(s)
        ? 4
        : 0) +
      (/\d{1,2}月|周[一二三四五六日]|\d{1,2}[:：]\d{2}/.test(s) ? 3 : 0) +
      (index < 3 ? 2 : 0),
  }));
  return important
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .sort((a, b) => a.index - b.index)
    .map((x) => (x.s.length > 200 ? x.s.slice(0, 199) + "…" : x.s));
}
