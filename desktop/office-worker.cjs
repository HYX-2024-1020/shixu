const { parentPort, workerData } = require("node:worker_threads");
async function parse(bytes, extension) {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1")
    throw new Error("不是可识别的 Office 二进制复合文档，可能损坏或扩展名不符");
  if (buffer.length > 16 * 1024 * 1024)
    throw new Error("旧版 Office 单文件超过16MB");
  if (extension === "doc") {
    const Extractor = require("word-extractor"),
      doc = await new Extractor().extract(buffer);
    return (
      "[Word 正文]\n" +
      doc.getBody() +
      "\n[页眉 / 页脚]\n" +
      doc.getHeaders() +
      "\n" +
      doc.getFooters() +
      "\n[脚注]\n" +
      doc.getFootnotes()
    );
  }
  const XLSX = require("xlsx");
  if (extension === "xls") {
    const book = XLSX.read(buffer, {
      type: "buffer",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      sheetRows: 5000,
    });
    return book.SheetNames.map(
      (name) =>
        `[工作表：${name}，最多读取5000行]\n${XLSX.utils.sheet_to_csv(book.Sheets[name], { FS: " | " })}`,
    ).join("\n\n");
  }
  if (extension !== "ppt") throw new Error("Office 格式无效");
  const compound = XLSX.CFB.read(buffer, { type: "buffer" }),
    stream = compound.FileIndex.find((e) => e.name === "PowerPoint Document");
  if (!stream)
    throw new Error("找不到 PowerPoint 文本流，可能已加密或格式不支持");
  const data = Buffer.from(stream.content),
    text = [];
  function records(start, end, depth) {
    if (depth > 40) throw new Error("PPT 容器嵌套超限");
    for (let cursor = start; cursor + 8 <= end; ) {
      const version = data.readUInt16LE(cursor) & 15,
        type = data.readUInt16LE(cursor + 2),
        length = data.readUInt32LE(cursor + 4),
        next = cursor + 8 + length;
      if (next > end || next <= cursor) throw new Error("PPT 记录损坏");
      if (version === 15) records(cursor + 8, next, depth + 1);
      else if ([4000, 4008, 4026].includes(type)) {
        const value = data
          .subarray(cursor + 8, next)
          .toString(type === 4008 ? "latin1" : "utf16le")
          .replaceAll("\0", "")
          .trim();
        if (value) text.push(`[PowerPoint 文本流，偏移 ${cursor}] ${value}`);
      }
      if (text.join("").length > 120000)
        throw new Error("PPT 提取文字超过12万字");
      cursor = next;
    }
  }
  records(0, data.length, 0);
  if (!text.length) throw new Error("旧版 PPT 未提取出文字");
  return (
    "[旧版 PPT 文本流提取，可能包含母版与历史文本，需要对照幻灯片核对；图片、图表未识别]\n" +
    text.join("\n")
  );
}
parse(workerData.bytes, workerData.extension)
  .then((text) => {
    if (!text.trim())
      throw new Error("没有提取出可靠正文，请转换为现代 Office 或 PDF 后重试");
    if (text.length > 120000)
      throw new Error("Office 提取文字超过12万字，请拆分");
    parentPort.postMessage({ text });
  })
  .catch((error) =>
    parentPort.postMessage({
      error:
        "旧版 Office 读取失败：" +
        error.message +
        "；原件保留，可另存为现代 Office / PDF 后投递",
    }),
  );
