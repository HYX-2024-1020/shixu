const labels = {
  read: "完整读取",
  partial: "部分读取",
  unsupported: "暂不支持",
  failed: "读取失败",
};
export function mergeProgressView(phase, completed, visualCompleted) {
  if(phase === "verifying")return `图像依据核对 · 已完成 ${Number.isSafeInteger(visualCompleted) && visualCompleted >= 0 ? visualCompleted : 0} 批（共用累计费用）`;
  return phase === "merging" ? `语义核对 · 已完成 ${Number.isSafeInteger(completed) && completed >= 0 ? completed : 0} 批（共用累计费用）` : "";
}
const reasons = {
  PDF_VISUAL_UNSUPPORTED:"服务端页面视觉读取尚未启用，不能把文字层当作扫描页已读",
  PDF_VISUAL_TOOL_UNSUPPORTED:"服务端固定页面渲染工具未就绪",
  PDF_VISUAL_PIXEL_LIMIT:"PDF页面或中间画布超过隔离像素范围，本页视觉未完成",
  PDF_VISUAL_FONT_UNSUPPORTED:"页面缺少必要字体轮廓，本页视觉未完整读取",
  PDF_VISUAL_RENDER_WARNING:"页面渲染存在缺失或不支持内容，本页视觉未完整读取",
  PDF_VISUAL_RGB_BOUNDS:"页面图像样本长度与声明不符，本页视觉未完成",
  PDF_VISUAL_RENDER_FAILED:"PDF页面渲染失败，本页视觉未完成",
  PDF_EXTERNAL_RESOURCE_UNSUPPORTED:"页面所需外部字体或资源未加载",
  PDF_ANNOTATION_UNREAD:"页面批注或表单外观尚未读取",
  PDF_VISUAL_WINDOW_PENDING:"后续PDF页面或区域尚未读取",

  IMAGE_PROVIDER_UNSUPPORTED:'服务端安全图像读取或模型图像输入尚未就绪',
  IMAGE_WINDOW_PENDING:'后续图像区域等待读取，尚未进入整理结果',
  PNG_ENCODING_UNSUPPORTED:'此PNG位深或编码方式暂不支持',
  PNG_COLOR_OR_ORIENTATION_UNSUPPORTED:'此图像色彩或方向元数据尚未支持，未擅自忽略',
  IMAGE_ANIMATION_UNSUPPORTED:'动画图像暂不支持，未只读取第一帧',
  IMAGE_PIXEL_LIMIT:'图像尺寸超过隔离解码上限',
  IMAGE_TILE_LIMIT:'图像区域超过安全范围',
  IMAGE_DECODE_FAILED:'图像解码失败',
  PNG_CRC:'PNG完整性校验失败',
  PNG_MALFORMED:'PNG结构损坏',
  GIF_MALFORMED:'GIF结构、像素或压缩终态校验失败',
  WEBP_MALFORMED:'WebP容器、帧或完整性校验失败',
  WEBP_RESOURCE_LIMIT:'WebP全部帧累计像素超过隔离资源范围',
  WEBP_DECODE_FAILED:'WebP解码或工具终态校验失败',
  WEBP_COLOR_OR_ORIENTATION_UNSUPPORTED:'此WebP色彩或方向元数据尚未支持',
  WEBP_CHUNK_UNSUPPORTED:'此WebP扩展尚未安全支持',
  NATIVE_WEBP_UNSUPPORTED:'服务端固定WebP读取工具尚未就绪',
  GIF_RESOURCE_LIMIT:'GIF全部帧累计像素超过隔离资源范围',
  GIF_ASPECT_UNSUPPORTED:'非方形像素GIF尚未支持',
  GIF_DISPOSAL_UNSUPPORTED:'此GIF帧处置方式尚未支持',
  GIF_INTERACTIVE_UNSUPPORTED:'需用户输入的GIF尚未支持',
  GIF_TEXT_UNSUPPORTED:'GIF纯文本扩展尚未支持',
  GIF_EXTENSION_UNSUPPORTED:'此GIF应用或扩展内容尚未安全支持',
  JPEG_MALFORMED:'JPEG结构或完整性校验失败',
  JPEG_METADATA_UNSUPPORTED:'JPEG色彩、方向或多图元数据尚未安全支持',
  JPEG_ENCODING_UNSUPPORTED:'此JPEG编码暂不支持',
  JPEG_RESOURCE_LIMIT:'JPEG展开超过隔离解码资源限制',
  ARCHIVE_WINDOW_PENDING: "后续包内材料等待读取，尚未进入整理结果",
  ARCHIVE_ENCODING_UNSUPPORTED: "归档路径编码不明确，暂不支持",
  ARCHIVE_RAR4_UNSUPPORTED: "对应服务端尚未安全核验此RAR4材料，请核对工具版本与编码",
  NATIVE_READER_UNSUPPORTED: "服务端安全归档读取工具未就绪，请联系维护者",
  ARCHIVE_NESTED_UNSUPPORTED: "嵌套归档暂不支持，未展开",
  ARCHIVE_ENTRY_LIMIT: "包内文件超过单件安全限制，未读取",
  ARCHIVE_ENTRY_FAILED: "包内文件完整性校验或读取失败，其他安全文件继续",
  ARCHIVE_EMPTY_ENTRY: "包内文件为空，未提取文字",
  PDF_VISUAL_UNREAD:
    "仅提取文字层；图像、视觉布局与文字顺序待核对，未推断表格关系",
  PDF_NO_TEXT: "未提取到文字；可能是扫描或空白页，需图片输入核对",
  PDF_PAGE_FAILED: "此页文字提取失败，其他页继续读取",
  PDF_INVALID: "PDF结构损坏或无法解析",
  PDF_ENCRYPTED_UNSUPPORTED: "加密PDF暂不支持",
  PDF_RESOURCE_LIMIT: "PDF展开超过安全资源限制，剩余页未读取",
  PDF_WINDOW_PENDING: "后续页等待读取，尚未进入整理结果",
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
  PACKAGE_UNSUPPORTED: "加密、多卷、solid、ZIP64或此归档特性暂不支持",
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
  if (typeof range.archivePath === "string") {
    const { archivePath, ...inner } = range;
    return `包内 “${archivePath.slice(0, 512)}” · ${location(inner)}`;
  }
  if(range.kind==='image'){
    const n=v=>Number.isSafeInteger(v)&&v>=0;
    if([range.x,range.y,range.width,range.height].every(n))return `${Number.isSafeInteger(range.page)&&range.page>0?`PDF 第 ${range.page} 页（${range.dpi||108}dpi） · `:""}图像模型识别 · ${range.frame?`第 ${range.frame}/${range.totalFrames} 帧（${range.frameStartMs}ms起，${range.frameDurationMs}ms） · `:''}第 ${range.tile} 块 · ${range.orientation>1?'按原图方向校正 · ':''}像素(${range.x},${range.y},${range.width},${range.height})`;
    return Number.isSafeInteger(range.tile)?`图像第 ${range.tile}${range.tileEnd?'–'+range.tileEnd:''} 块`:'整份图像';
  }
  if (range.kind === "pdf") {
    const valid = (n) => Number.isSafeInteger(n) && n > 0;
    return valid(range.page)
      ? `PDF 第 ${range.page}${valid(range.pageEnd) && range.pageEnd > range.page ? "–" + range.pageEnd : ""} 页`
      : "PDF整份文件";
  }
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
  const unread = Array.isArray(processing.unread) ? processing.unread.filter(r => r && typeof r === "object") : [];
  return `本次已收下有效部分：已整理 ${processed} 个来源范围，${pending.length} 个已读取范围尚未整理。${pending.map(location).join("；")}${unread.length ? `另有 ${unread.length} 段后续${unread.every(r=>r.kind === "pdf") ? "页" : "材料"}尚未读取：${unread.map(location).join("；")}` : ""}`;
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
export function reuseView(count) {
  return Number.isSafeInteger(count) && count > 0
    ? `复用 ${count} 个已付费块（已核验当前材料）` : "";
}
export function pdfProgressView(summary) {
  if (!Array.isArray(summary)) return "";
  const rows = summary.flatMap(c => {
    if (!c || typeof c !== "object") return [];
    const members = Array.isArray(c.archivePdfPages) ? c.archivePdfPages : [];
    return [c, ...members.filter(p => p && typeof p.archivePath === "string").map(p => ({
      name: `${typeof c.name === "string" ? c.name.slice(0, 200) : "归档"} · 包内 “${p.archivePath.slice(0, 512)}”`,
      pdfPages: p,
    }))];
  });
  const visual=summary.flatMap(c=>{
    if(!c||typeof c!=="object")return [];
    return [...(c.pdfVisual?[{name:c.name,...c.pdfVisual}]:[]),...(c.archivePdfVisualPages||[]).map(p=>({...p,name:`${c.name} · 包内 “${p.archivePath}”`}))];
  }).filter(p=>Number.isSafeInteger(p.page)&&p.page>0&&Number.isSafeInteger(p.totalPages)&&p.totalPages>=p.page).map(p=>
    `${String(p.name||"PDF").slice(0,740)}：页面视觉 · 第 ${p.page} / ${p.totalPages} 页 · ${p.failedPage?"本页视觉未完成":`已检查 ${p.startTile||p.checked} / ${p.totalTiles||p.total} 个区域（108dpi）`}`);
  const text=rows.filter(c => c.pdfPages && Number.isSafeInteger(c.pdfPages.checked) &&
    Number.isSafeInteger(c.pdfPages.total) && c.pdfPages.total > 0 && c.pdfPages.checked >= 0 &&
    c.pdfPages.checked <= c.pdfPages.total).map(c =>
      `${typeof c.name === "string" ? c.name.slice(0, 740) : "PDF"}：已检查 ${c.pdfPages.checked} / ${c.pdfPages.total} 页`);
  return [...text,...visual].join("；");
}

export function imageProgressView(summary){
  if(!Array.isArray(summary))return '';
  const rows = summary.flatMap(c => {
    if (!c || typeof c !== 'object') return [];
    const members = Array.isArray(c.archiveImageTiles) ? c.archiveImageTiles : [];
    return [c, ...members.filter(p => p && typeof p.archivePath === 'string').map(p => ({
      name: `${typeof c.name === 'string' ? c.name.slice(0, 200) : '归档'} · 包内 “${p.archivePath.slice(0, 512)}”`,
      imageTiles: p,
    }))];
  });
  return rows.filter(c=>c && c.imageTiles && Number.isSafeInteger(c.imageTiles.checked) &&
    Number.isSafeInteger(c.imageTiles.total) && c.imageTiles.total>0 && c.imageTiles.checked>=0 &&
    c.imageTiles.checked<=c.imageTiles.total).map(c=>`${typeof c.name==='string'?c.name.slice(0,740):'图像'}：已检查 ${c.imageTiles.checked} / ${c.imageTiles.total} 个图像区域`).join('；');
}
