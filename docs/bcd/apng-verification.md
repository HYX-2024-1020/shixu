# PNG动画逐帧读取开发证据

2026-11-01，Refs #73/#69。依据[W3C PNG Third Edition](https://www.w3.org/TR/png-3/#animation)新增项目自作解析器，不使用本地OCR/浏览器生产渲染，不请求图像URL。B/C/D实施继续，独立最终验收另行执行。

## 实际范围

支持.png内APNG及.apng扩展名；严格acTL/fcTL/fdAT序号、CRC、帧数/矩形/控制/数据/默认图顺序、zlib完整终态，所有后续帧均验证后才输出当前区域。复用受支持PNG色型/位深/Adam7；16位先按既有规则归一8位，再合成，不宣称16位无损保留或高级色彩支持。保留直通alpha至SOURCE/OVER及NONE/BACKGROUND/PREVIOUS合成完成，最后白底规范化；第一帧PREVIOUS按BACKGROUND处理。

每次只展开一个播放周期；若静态默认图不属于动画，另读为frameRole=default、零时长，随后动画重新从透明画布开始，默认图不混入动画。来源保留帧号、时间、原始delay分子/分母（分母0表示100）、静态角色与像素区域。顶层/ZIP/非solid RAR4/RAR5/7z、Office实际引用PNG均沿同一瓦片/付费/依据核对/恢复链。

原件10MiB、画布32MP/16384边长、包含静态默认图的累计画布帧像素32M、总64瓦片和最多10000结构块，Linux512MiB/30秒等限制保留。每窗重新验证整份有界动画不是大文件流式；大动画仍明确失败，不采样/丢后帧冒称完整。

## 验证与失败记录

- Windows读取415项、APNG/发布包直接相关13项，随后含16位alpha/拆分帧数据的12项及语义/发布包相关21项、核心97、同步125、build/mini检查及官方WXML/WXSS无窗口编译通过。共享来源增加静态默认图标记，小程序扩展名/MIME适配与生成文件同步。
- 固定全像素对照：Edge156.0.4314.56 ImageDecoder/Canvas动画，Pillow12.3.0仅用于独立静态默认图；两份共10个读取帧hash/时长一致。手工2像素golden另核对半透明、清背景、恢复上一帧、零延迟、分母0及默认图隔离。顶层/四归档完整像素、顺序、尾件，Office Word段落/Excel B3锚点通过。损坏末帧不输出首帧，超限明确失败。
- 首次Pillow动画oracle对照失败：半透明128帧叠不透明背景后Pillow给alpha191，而OVER应保持255；Edge输出与项目实现全像素一致。保留[原观测](../../server/reading/fixtures/apng-pillow-observed.json)，不按Pillow差异修改生产结果。重生成入口scripts/generate-apng-fixtures.py、generate-apng-goldens.mjs；测试只消费固定样本，无外部依赖。
- 独立Linux只读树/普通UID nobody11项通过；受保护broker top temporary与ZIP deleted实际双端签名HTTP链通过，未授权daemon UID拒绝。两帧2048×2048样本的末窗tile8，1048576像素完全匹配；单次解析4189.12ms、端到端4582.57ms、RSS197020KiB，不是P95/cgroup峰值或容量证明。[机器证据](evidence/apng-linux.json)。
- 双端AccountWorkspace与实际Page/Node wx adapter核对来源、时长、区域进度、停止/迟到丢弃、核验补传、图片依据核对与同事项语义合并；独立发布包实际读取.apng第二帧和时长。不是原生微信/手机/安装版证据，无重复本机UI。

## 真实API与质量修正

按[官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)于北京时间2026-11-01周日空闲时段冻结同一快照，Flash1017每百万输入未缓存1元/缓存0.02元/输出4元；能力见[官方图像理解](https://api-docs.deepseek.com/zh-cn/guides/vision/)。通过已有safeStorage，无BrowserWindow，原始动画不直接交供应商，逐区域发送规范化静态PNG。

首次[完整APNG链](evidence/apng-real-initial.json)：两帧识别2、依据核对3、语义1共6次，usage估算10738微元，全settled/unknown0。7319、PDF/学号_姓名、算法/复杂度、2026-10-30 18:00及第二帧UTF-8源码均保留，但combined=false：同编号补充要求仍拆成两个任务，脚本质量断言失败；不能称全链质量通过。依据核对同时移出了报告尾部编号硬要求，核对本身仍有误判风险。

修正语义提示：明确同一编号“提交报告时另附源码”是提交要求补充，缺少另一帧的日期/课程不等于冲突，实际动作/编号/日期冲突仍分开；语义版本升级paid-semantic-pairs/4，旧结果不复用。固定上述已核对输出并模拟上游（独立标记与账本保留），仅重新实际调用语义1次1346微元，[回放](evidence/apng-real-merge-replay.json)得到1个事项，PDF与UTF-8、日期时刻与全部8条引用保留。此为定向真实语义回放，不是假称整个APNG链第二次真实重跑。

本增量7次真实调用12084微元；接续累计31次usage估算57858微元=¥0.057858，不代表全部历史或最终供应商对账。保留outputs/shixu-image-ledger-9TXJIF与umRwNF实际账本；模拟上游消费与真实调用分列，历史失败不覆盖、不退款。

ICC/高级色彩、其他PDF/Office视觉、solid/真流式、历史投递关联AI、全域安全/完整多库迁移、真实外部证据源仍未完成；生产部署/真实迁移/E/F/安装/全BCD最终验收均未执行。CI按本批最终头PR评论记证。
