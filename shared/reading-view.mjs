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
  if (range.kind === "csv" && Number.isSafeInteger(range.row))
    return `CSV 第 ${range.row}${range.rowEnd && range.rowEnd !== range.row ? "–" + range.rowEnd : ""} 行`;
  if (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.end >= range.start
  )
    return `文字位置 ${range.start + 1}–${range.end}`;
  return "整份文件";
}
export function readingView(coverage = []) {
  if (!Array.isArray(coverage)) return [];
  return coverage.map((c) => {
    const covered = Array.isArray(c.covered) ? c.covered : [],
      missing = Array.isArray(c.uncovered) ? c.uncovered : [];
    return {
      id: c.attachmentId,
      name: c.name,
      state: c.state,
      label: labels[c.state] || "读取状态待核对",
      covered: `已读取 ${covered.length} 个来源范围`,
      missing: missing
        .map(
          (r) => `${location(r)}：${reasons[r.code] || "未处理，需核对原因"}`,
        )
        .join("；"),
      reason: (Array.isArray(c.reasons) ? c.reasons : [])
        .map((r) => reasons[r] || "需核对读取原因")
        .join("；"),
    };
  });
}
export function sourceLocation(coverage = [], sourceId) {
  for (const c of Array.isArray(coverage) ? coverage : []) {
    const range = (c.covered || []).find((r) => r.sourceId === sourceId);
    if (range) return `${c.name} · ${location(range)}`;
  }
  return "";
}
