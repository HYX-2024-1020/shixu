const labels = {
  read: "完整读取",
  partial: "部分读取",
  unsupported: "暂不支持",
  failed: "读取失败",
};
const reasons = {
  FORMAT_UNSUPPORTED: "此格式暂不支持读取",
  ENCODING_UNSUPPORTED: "文字编码暂不支持",
  FORMAT_MISMATCH: "文件内容与格式不符",
  BINARY_TEXT: "文字中含二进制内容",
  EMPTY_TEXT: "文件为空白文字",
  CSV_MALFORMED: "CSV 行或引号损坏",
  ISOLATED_READING_FAILED: "隔离读取未完成",
};
function location(range) {
  if (range.kind === "csv" && Number.isSafeInteger(range.row) && range.row >= 1)
    return `CSV 第 ${range.row}${Number.isSafeInteger(range.rowEnd) && range.rowEnd > range.row ? "–" + range.rowEnd : ""} 行`;
  if (
    Number.isSafeInteger(range.start) &&
    range.start >= 0 &&
    Number.isSafeInteger(range.end) &&
    range.end >= range.start
  )
    return `文字位置 ${range.start + 1}–${range.end}`;
  return "整份文件";
}
export function readingView(coverage = []) {
  if (!Array.isArray(coverage)) return [];
  return coverage
    .filter((c) => c && typeof c === "object")
    .map((c, index) => {
      const covered = Array.isArray(c.covered)
          ? c.covered.filter((r) => r && typeof r === "object")
          : [],
        missing = Array.isArray(c.uncovered)
          ? c.uncovered.filter((r) => r && typeof r === "object")
          : [];
      return {
        id:
          typeof c.attachmentId === "string"
            ? c.attachmentId
            : "unknown_" + index,
        name: typeof c.name === "string" ? c.name.slice(0, 200) : "未命名附件",
        state: typeof c.state === "string" ? c.state : "unknown",
        label:
          typeof c.state === "string" && Object.hasOwn(labels, c.state)
            ? labels[c.state]
            : "读取状态待核对",
        covered: `已读取 ${covered.length} 个来源范围`,
        missing: missing
          .map(
            (r) =>
              `${location(r)}：${typeof r.code === "string" && Object.hasOwn(reasons, r.code) ? reasons[r.code] : "未处理，需核对原因"}`,
          )
          .join("；"),
        reason: (Array.isArray(c.reasons) ? c.reasons : [])
          .map((r) =>
            typeof r === "string" && Object.hasOwn(reasons, r)
              ? reasons[r]
              : "需核对读取原因",
          )
          .join("；"),
      };
    });
}
export function sourceLocation(coverage = [], sourceId) {
  for (const c of Array.isArray(coverage) ? coverage : []) {
    if (!c || typeof c !== "object") continue;
    const range = (Array.isArray(c.covered) ? c.covered : []).find(
      (r) => r && r.sourceId === sourceId,
    );
    if (range)
      return `${typeof c.name === "string" ? c.name.slice(0, 200) : "未命名附件"} · ${location(range)}`;
  }
  return "";
}
