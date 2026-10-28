# PDF文字层与任务、原件联合增量

2026-10-28（北京时间），Refs [#73](https://github.com/HYX-2024-1020/shixu/issues/73) / [#69](https://github.com/HYX-2024-1020/shixu/issues/69)，继续 feat/bcd-attachment-loop / Draft PR #74。基于固定方案da28c1f与A合入aad1903；本轮起点e6f65e1。PDF整体和B/C/D仍未验收，生产v3未升级、未迁移或开放账号。

## 行为与取舍

- PDF原字节长度/SHA-256核对后进入既有受保护broker；异步文字提取在同一动态非root、无网络/凭据、512MiB/CPU50%/单步30秒的最小根内执行。应用没有得到任意命令、路径、worker或systemd权限。正文只在短期内存；覆盖/页码随原子发布同步，不持久化全文。
- 按文件页序、PDF文字内容流顺序读取，保留中文、emoji、页码和旋转元数据，按既有Unicode窗口分段。完整提取一页后才提交该页；页级异常不提交其前缀，后续页继续。PDF.js能容错成空文字的损坏流被标为未提取文字，不能据此声称空白或修复成功。
- **所有有文字页仍为partial**：逐页列出PDF_VISUAL_UNREAD，明确图片/视觉布局和顺序待核对，不推断表格。无文字页列PDF_NO_TEXT，区分“未提取到文字”与“已确认空白”。未识别扫描/图片、复杂布局、字体映射和可见性不能靠文字层保证；没有使用OCR或真实图片模型。
- 加密拒绝，结构损坏失败；单页失败、文件失败和资源拒绝都保留原因。未设置总页数上限；8Mi UTF-16文字展开保护、broker总输出64MiB、内存和根执行时间各自生效，触限不能静默截断或报告read。超限后缀列未读范围；外层杀进程时整文件失败，不能捏造可信前缀。
- 复用任务账本、根累计、停止generation、有效付费块、原件核对、部分收下与原子发布；无可读内容不调用模型。PDF读取版本加入输入指纹，旧读取版本的任务不得直接冒用新结果。

## 依赖、维护和分发

沿用lockfile已有pdfjs-dist **6.2.108**（Apache-2.0），不安装新包、canvas原生模块、宿主字体或OCR。依赖的Node声明为>=22.13或>=24，但实测本机/服务器Node24.20.0仍缺Uint8Array.toHex；浏览器build还会在模块加载时创建DOMMatrix。不能以package engines或旧客户端预览推断最小根可用。

`scripts/build-reading-pdf.mjs`生成约429KB API与1.20MB core两个独立ESM；文字API通过固定WorkerMessageHandler在隔离进程内通信，不启动浏览器worker。精确版本保护、render-only SCALE_MATRIX初始化与启动警告的唯一匹配检查、toHex的局部纯JS替换都在生成脚本可审查，不改全局原型。没有渲染API调用，误用渲染时不能依赖伪造DOM。Node可直接加载，不需要运行时node_modules、CMap资源、canvas或字体安装；不能因此宣称所有外置CMap和字体均支持。解析参数关闭eval、系统字体、fontFace、Wasm、图像解码/OffscreenCanvas、worker资源获取和自动外部请求。PDF文档动作不执行，网络最终仍由隔离层拒绝。

CI现有build-reading-parser --check同时核对PDF生成字节与完整许可；release显式包含PDF源码、两个包和pdf-reader.LICENSE，并从无node_modules的独立release读取合成PDF。升级PDF.js需人工复核适配和固定样本，不能只放宽版本断言。上游来源：[PDF.js](https://github.com/mozilla/pdf.js)、[API参数](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)。此次未对比所有上游新版本或完成独立漏洞审计，不把固定版本称为最新安全版本。

## C：有限安全重试

仅受保护broker HTTP429入口拒绝可以证明worker未启动，客户端添加notExecuted标记、可信waitingMs=0。内核针对这种读取拒绝使用100/300ms退避，最多2次重试，退避计入根活跃时间且受剩余时限约束；停止/关闭立即中止，已耗尽不发新读取。耗尽后附件明确失败，其他安全附件仍可继续。

解析失败、取消、超时、断连、缺终态或计时不明没有非执行证明，不自动重读。供应商已发送/费用未知维持unknown，不借本次读取重试改动自动重发模型或释放风险。重试次数随覆盖保留；没有宣称已完成供应商安全重试和维护审计解除。

## D：清理后的临时核验

复现并修复双端新建任务缺补传、小程序pendingAction重放缺补传。新建整理、继续、部分收下与重放均先核对当前投递附件；旧原件墓碑不被当作当前新增附件，也不借编辑事项恢复文件。

新增鉴权入口 `PUT /api/v4/originals/:packet/:file/verify`：已deleted/cleaned、仍在当前投递的原件可重传**相同长度与SHA-256**字节，仅置于原有账号40MiB/全站64MiB限额RAM，并沿用上传请求体最多2路。墓碑、版本、期限、逻辑空间和持久blob不变。仅内核forReading允许使用，普通下载仍REUPLOAD_REQUIRED；旧上传仍ORIGINAL_DELETED，不能恢复保留副本。首次核验仍受输入写锁和投递删除/清除保护。

storage的available维持false，另有readingAvailable表示当前临时核验窗口；两端提示云端仍已清除。无本地副本明确要求换有副本设备或重选同一原件；停止、结束、空闲/关闭清理，不把核验变成备份。此实现不提供长期PDF全文或页图检查点。

## 固定质量与性能

项目自写PDF对象/xref/ToUnicode合成器，无私人文档或第三方字体。独立文字golden先于解析计算，比较完整文字SHA-256、全部来源/覆盖元数据和尾部；不能只验非空或状态码。覆盖Unicode/emoji、多页、旋转、内容顺序与几何顺序相反、空白/无文字、损坏页、损坏文件、长材料及真实PDF动作字典。不是复杂真实世界PDF语义准确率评估；加密错误分支尚缺真实加密样本的独立质量验收。

独立Linux目录 `/opt/shixu-bcd-test-20261028-pdf`，沿用已核实Node24.20.0最小runtime；公开源码/已有依赖受控复制，校正独立目录权限，没有安装宿主包或读取生产资料。6组各5次，最近秩P95即最大值；总耗时包含broker准备、隔离进程、序列化、传输与清理。首次长样本golden发现合成器把文字画出MediaBox（起点700、100行向下），修为9000后完整重跑，不修改golden迎合漏字。

| 合成样本 | 原字节 | 隔离P50/P95 ms | worker峰值RSS KiB |
| --- | ---: | ---: | ---: |
| 中文/emoji/旋转/无文字 | 1961 | 448 / 488 | 73720 |
| 182页长材料/缺失页/尾部 | 108650 | 2204 / 2236 | 89832 |
| 无文字页 | 1166 | 435 / 477 | 73740 |
| 损坏中页及安全后页 | 1869 | 461 / 492 | 74084 |
| 损坏文件 | 12 | 364 / 429 | 71060 |
| 动作字典 | 1452 | 431 / 492 | 73192 |

上表为最终完整批次，动作样本含实际OpenAction/AA，[结构化测量](evidence/pdf-benchmark.json)保留全部重复值和golden。宿主累计maxRSS122772KiB，与各worker峰值分开，不推算生产容量或真实模型P95。

[资源压力](evidence/pdf-safety.json)的531269原字节PDF展开为高密度241页，触发ISOLATED_READING_FAILED外层隔离拒绝（约24.8秒），没有可信材料输出；**未命中可证明的内层8Mi文字阈值，不宣称该阈值已实测验收**。需要后续优化PDF.js内存与按页流式窗口再推进更大材料。现有内存/时间/进程、无网络/宿主/跨任务读取、只读输入及broker崩溃清理再次通过；首次探针脚本因本目录runtime不存在未执行，显式复制已有最小runtime后重跑，未放松目录检查。

普通UID经受保护socket完成PDF temporary停止/补传、到期后小程序新建、retained删除后小程序临时核验/停止/继续、同结果发布；每次2次真实隔离解析、3次模拟模型调用、60微元合成消费，约6秒级单次观察，非P95。非法UID及probe注入均拒绝。普通UID任务/PDF/原件/双端/关闭回归65项通过；最终小改动的复核见本轮验证JSON。[Linux联合证据](evidence/pdf-linux-loop.json)、[删除核验](evidence/pdf-reverify-loop.json)、[到期补传](evidence/pdf-expired-loop.json)、[隔离探针](evidence/pdf-isolation.json)。

## 双端与验证边界

Windows签名HTTP与小程序实际Page/Node wx适配器核对结果/覆盖一致、页码依据、缺失页、根累计、跨设备停止/继续和新建前补传。Windows源码Electron实际PDF上传→停止→继续→发布→重载材料面板，显示第181无文字页和第182视觉未读；另复跑retained/temporary原件与离线锁专项。首次PDF UI在供应商尚未进入时就停止，继续后的模拟首调用一直等待取消而导致高频轮询触限；补等待模拟调用进入后重跑通过，未提高生产限额。

本机读取内核109、同步/小程序124、核心93、浏览器92、桌面数据18、个人服务1、release4、PR/双端门禁8；网页/桌面构建、15生成文件、69文档入口、官方WXML/WXSS编译和模板渲染分别验证，摘要见[本轮验证](evidence/pdf-validation.json)。最初mini:compile未设置编译器路径未运行，显式指定已安装官方wcc-exec后通过。新增PDF源码Electron专项接入Windows CI。最终提交必需CI另查，不借旧e6f65e1成功代替。

Linux最后复核暴露退避定时器浮点毫秒向下取整：不足完整退避的根余量可能早醒并多试一次。已在有限等待后显式拒绝余量不足的重试，Windows完整内核及Linux普通UID65项重新通过；未调整断言掩盖问题。

原生微信develop、真实微信身份、手机、安装版、真实模型视觉/语义、生产迁移与公网发布未验收。本轮真实DeepSeek新增0次；跨任务10元既往支出仍未核清，未自动调用或加预算。图片输入/扫描PDF、归档、跨修订语义合并/供应商安全重试、审计解除、独立安全水位、正式迁移与10人负载等继续#73/#69，B/C/D保持未勾选、PR保持Draft。回滚可revert源码；消费/删除/撤销后不得以旧库覆盖安全状态。
