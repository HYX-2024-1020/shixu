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
  READING_TIMEOUT: "读取步骤超时，本次未读取",
  READING_QUEUE_FULL: "读取队列已满，可稍后重试",
  PACKAGE_INVALID: "文件压缩结构或完整性校验失败",
  PACKAGE_UNSUPPORTED: "加密、ZIP64或此压缩方式暂不支持",
  PACKAGE_PATH: "文件内含不安全路径或链接",
  PACKAGE_LIMIT: "文件展开超过安全资源限制",
  PACKAGE_PART_MISSING: "文件所需组成部分缺失",
  DOCX_PACKAGE_MISSING: "缺少有效DOCX正文或类型声明",
  DOCX_MACRO_UNSUPPORTED: "含宏的Office文件暂不支持",
  DOCX_XML_UNSAFE: "文件含不安全的XML声明",
  DOCX_XML_ENCODING: "文件内部文字编码无效",
  DOCX_XML_DEPTH: "文件内部结构过深",
  DOCX_XML_MALFORMED: "文件内部XML损坏，未闭合部分未读取",
  DOCX_STRUCTURE_INVALID: "DOCX正文结构无效",
  DOCX_TABLE_INVALID: "表格合并范围无效",
  DOCX_OBJECT_UNREAD: "图片、公式或嵌入对象尚未读取",
  DOCX_EXTERNAL_LINK: "外部链接未访问",
  DOCX_REVISIONS: "修订内容尚需人工核对",
  DOCX_NUMBERING: "列表编号样式尚未还原，段落文字已保留",
  DOCX_DYNAMIC_FIELD: "动态域未执行，仅保留已有显示文字",
  DOCX_UNLINKED_PART: "未关联到正文的文档部分未读取",
  DOCX_ENCRYPTED_UNSUPPORTED: "加密或旧式Office容器暂不支持",
  XLSX_PACKAGE_MISSING: "缺少有效XLSX工作簿或类型声明",
  XLSX_MACRO_UNSUPPORTED: "含宏的工作簿暂不支持",
  XLSX_ENCRYPTED_UNSUPPORTED: "加密或旧式工作簿暂不支持",
  XLSX_XML_UNSAFE: "工作簿含不安全的XML声明",
  XLSX_XML_ENCODING: "工作簿内部文字编码无效",
  XLSX_XML_DEPTH: "工作簿内部结构过深",
  XLSX_XML_MALFORMED: "工作表XML损坏，未完整的行未读取",
  XLSX_STRUCTURE_INVALID: "工作簿或单元格结构无效",
  XLSX_RESOURCE_LIMIT: "工作簿展开或结构超过隔离资源限制",
  XLSX_FORMAT_UNREAD: "部分数值显示格式未还原，保留原始值待核对",
  XLSX_DATE_COMPAT: "工作簿使用Excel的1900闰日兼容值，日期需人工核对",
  XLSX_SHARED_STRING_MISSING: "单元格引用的共享文字缺失",
  XLSX_FORMULA_CACHED: "公式未执行，已有缓存值未重新计算，需核对时效",
  XLSX_FORMULA_NO_CACHE: "公式无缓存值，未计算结果",
  XLSX_CELL_ERROR: "单元格自身含错误值，原样保留待核对",
  XLSX_EXTERNAL_LINK: "工作簿外部链接未访问",
  XLSX_OBJECT_UNREAD: "工作簿图片、图表、对象或动态展示尚未读取",
  XLSX_SHEET_UNREAD: "部分工作表或未关联内容尚未读取",
  XLSX_PHONETIC_UNREAD: "注音标记未还原，普通单元格文字已保留",
  XLSX_DEFINED_NAME: "命名公式未执行，单元格已有值已保留",
  XLSX_VISUAL_LAYOUT: "列布局或隐藏列展示未还原，现有单元格已读取",
};
function location(range) {
  if (range.kind === "xlsx") {
    const sheet =
      typeof range.sheet === "string"
        ? `工作表 “${range.sheet.slice(0, 31)}”`
        : "工作簿";
    const positive = (n) => Number.isSafeInteger(n) && n >= 1;
    return (
      sheet +
      (positive(range.row) ? ` · 第 ${range.row} 行` : "") +
      (typeof range.cell === "string" &&
      /^[A-Z]{1,3}[1-9]\d{0,6}$/.test(range.cell)
        ? ` · 单元格 ${range.cell}`
        : positive(range.column)
          ? ` · 第 ${range.column}${positive(range.columnEnd) && range.columnEnd > range.column ? "–" + range.columnEnd : ""} 列`
          : "")
    );
  }
  if (range.kind === "docx") {
    const part =
      typeof range.part === "string" ? range.part.slice(0, 200) : "正文";
    const positive = (n) => Number.isSafeInteger(n) && n >= 1;
    return `${part}${positive(range.table) && positive(range.row) && positive(range.column) ? ` · 表 ${range.table} 第 ${range.row} 行第 ${range.column} 列` : ""}${positive(range.paragraph) ? ` · 第 ${range.paragraph} 段` : ""}`;
  }
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
export function processingView(processing) {
  if (!processing || processing.partial !== true) return "";
  const processed = Array.isArray(processing.processed)
    ? processing.processed.length
    : 0;
  const pending = Array.isArray(processing.pending)
    ? processing.pending.filter((r) => r && typeof r === "object")
    : [];
  return `本次已收下有效部分：已整理 ${processed} 个来源范围，${pending.length} 个范围尚未整理。${pending.map(location).join("；")}`;
}
export function walletView(wallet) {
  if (!wallet) return "额度状态尚未刷新";
  const paused = {
    RECONCILIATION_REQUIRED: "历史费用待核对，AI暂不可用；记录和同步仍可用",
    UNKNOWN_COST: "有调用费用待核对，AI已暂停；已完成进度保留",
    LEDGER_PAUSED: "费用账本待核对，AI已暂停；记录和同步仍可用",
  };
  if (wallet.pausedReason)
    return Object.hasOwn(paused, wallet.pausedReason)
      ? paused[wallet.pausedReason]
      : "AI已暂停，额度状态待核对";
  if (!Number.isFinite(wallet.spent) || !Number.isFinite(wallet.available))
    return "额度状态待核对";
  return `累计已消费 ¥${(wallet.spent / 1000000).toFixed(4)} · 可用 ¥${(wallet.available / 1000000).toFixed(2)}（不按天重置）${wallet.lowBalance ? " · 余额不足¥3" : ""}`;
}
