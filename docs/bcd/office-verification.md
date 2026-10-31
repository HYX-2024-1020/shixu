# Office引用图片与窗口开发验证

2026-10-31，#73/#69，`feat/bcd-attachment-loop`、Draft #74。该增量是B/C/D开发实施，不是独立最终联合验收。

## 能力与边界

DOCX/XLSX结构文字之后，沿实际内部关系读取DrawingML引用的PNG/JPEG/GIF/WebP原图资源。DOCX保留故事part和段落；XLSX保留工作表、绘图part、one/two-cell锚点及单元格、隐藏/veryHidden状态；absolute锚点只记录绘图part，不编造单元格。图片按既有隔离解码器逐1024瓦片/动画帧规范化，保留原图像素/时间/方向与包内媒体名，进入同一图像依据核对和语义合并链。

这是内嵌原图资源读取。裁剪、旋转/形状变换、特效、页面布局、图表、VML、OLE/其他嵌入对象、AlternateContent不在此次渲染范围，明确保留unread/partial；不把全幅原图声称为Word/Excel可见截图。外链不获取，不读未引用媒体来猜位置；关系重复/越界、损坏XML、声明不符和不支持格式失败关闭。没有使用Office自动化、本地OCR或模型代替ZIP/XML校验。

文字输出每窗120000码点，随后每次只输出一张原图的一个瓦片；只有数值游标与覆盖可持久化，旧窗口文本/图片丢弃。包内Office同样延续，既有外层与Office累计64MiB展开预算不因跨窗重置或重复扣算；每件10MiB、图片32MP/16384边长/64瓦片、Linux512MiB与30秒保持。XML结构解析仍在受控包内进行，不将该输出窗口冒称整个Office解析已真正流式。

新broker协议7严格限定officeWindow字段；归档协议4扩展数值Office游标，整个归档仍完整预检。旧文字层调用不携带新游标时保留旧路径；任务需reader.officeWindows与provider.imageInput均启用，能力发现给出officeImageAssets。源版本archive/11与office-assets/1失效旧未完成输入，重新发起仍保留同根费用/时间/检查点，不能借新taskId洗掉门禁。

依据核对逐批独立收费，停止后迟到只结算不发布，付费复用先核验当前原件。双端来源区显示段落/单元格、内嵌原图名称及区域进度；提示不改变原件墓碑、额度、下载权或期限。

## 检查

- 首批相关45项通过；共享游标、解析器/内核/双端全读取回归385项通过。随后隐藏工作表来源专项加入并通过（Office内核/像素6项），Linux普通UID隐藏来源1项通过；游标审查补充23项相关与Office归档5项回归通过，拒绝把未用Office字段带入其他格式或用旧Office页别名跳过内容，未重复全部历史UI矩阵。
- DOCX/XLSX固定材料核对全文、Unicode顺序、段落/单元格与尾部；原图三瓦片全部像素重组一致。ZIP/RAR4/RAR5/7z内XLSX逐窗、原包路径、尾件及累计展开值等于Office一次完整展开量。JPEG方向、GIF/WebP所有瓦片/时间与既有独立codec像素证据对接，未重做未变codec全矩阵。
- 实际AccountWorkspace和实际Page/Node wx签名HTTP：顶层DOCX/XLSX、ZIP内DOCX和RAR4内XLSX四链；停止、原件到期/删除后同hash补传、依据核对、发布、修订只新增补充文本调用，图片和核对付费复用，来源/覆盖/区域进度及共同费用一致。不是原生微信/手机/安装版。
- 独立自包含发布包实际读取XLSX内图像、正文尾部与B3锚点，并执行原有识别→核对共账发布链；发布/策略10项通过。核心97、同步125、桌面无窗口18、build、mini:build/check、官方WXML/WXSS无窗口编译通过。完整必需CI按最终提交核实，不以本地结果替代。
- 独立Linux只读树 `/opt/shixu-bcd-test-20261031-office`，普通UID nobody：归档/内核/四链客户端等13项通过，首轮直接源模块扫描测试因隔离测试树没有裸sax包而失败；改为核验真正的自包含生产bundle后4项通过，未安装宿主软件包。固定XML bundle源码/现有SAX许可保留，生成一致性检查通过。
- [受保护broker证据](evidence/office-linux.json)：DOCX temporary与RAR4/XLSX deleted两条双端链，未授权daemon UID被拒绝；4MP原图第4瓦片1048576像素逐字节一致。单次input1922853字节，parse1476.96ms、端到端1838.00ms、RSS131236KiB，非P95/cgroup峰值或容量验收。只操作本任务合成目录和现有独立runtime，没有生产/私人资料/宿主包变更。

复现：`node --test server/reading/office-images.test.mjs server/reading/office.test.mjs server/reading/office-archive.test.mjs server/reading/office-clients.test.mjs`。Linux受控隔离：`node scripts/reading-office-linux.mjs /opt/shixu-bcd-test-20261031-office`（独立树内的root测试协调器，实际调用者nobody，不能对任意生产路径执行）。bundle：`node scripts/build-reading-parser.mjs --check`；发布：`node --test deploy/sync/release.test.mjs`。

## 真实模型

[合成DOCX报告](evidence/office-real-docx.json)，仅使用已有safeStorage，不创建BrowserWindow。预检零上游调用：原图规范化hash `b7b36c8900b528ad20e59bc19b7ff3e189f016ed43b549c82a1526f5c301de18` 与既有9537合成通知一致。

真实文字识别1次、图像识别1次、依据核对2次、语义核对1次，共5次，全部usage已结算，估算9297微元。保留任务编号、PDF、学号_姓名、算法思路/时间复杂度、2026-11-03 16:45、Word第2段与内嵌图片源；未产生“报告尾部写编号”硬要求。输出保留一条背景note和一条task，不据此声称只有行动事项或普遍准确。XLSX的实际适配/像素/费用恢复有模拟模型与Linux证据，本增量没有真实XLSX模型调用。

本接续累计24次、usage估算45774微元（¥0.045774），不代表所有历史费用或供应商账单已对平。所有真实/模拟开发账本、失败和unknown历史保留于outputs，不删除或篡改。价格使用已核对的2026-10-31周六空闲快照，见[官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。

结构参考：[Microsoft DrawingML图片引用](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.blip)、[Word内联DrawingML](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.wordprocessing.inline?view=openxml-3.0.1)。引用用于核对结构；没有复制SDK代码或引入SDK运行依赖。

其余Office图表/对象/布局、未支持PDF/图片编码、solid及真正大材料流式、历史关联共账、真实费用/宿主证据和安全重放/正式迁移仍待实施。保持Draft，不安装客户端、不迁移真实资料、不组织整体验收。
