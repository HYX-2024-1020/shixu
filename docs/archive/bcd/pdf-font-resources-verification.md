# PDF固定字体与CMap资源开发验证

2026-11-02，#73 / Draft PR #74。补齐固定字体/CMap与实际资源工厂，B/C/D继续实施，非最终独立验收。

## 实现与边界

- 沿lockfile的PDF.js6.2.108打包168个bcmap、14个标准字体和3份原许可，185文件/1,948,053字节（约1.86MiB）；固定目录、长度、SHA-256在源码catalog逐项记录。构建拒绝新文件/改名/长度/hash变化，原文件和许可证随平台包、服务自包含包完整复制，生成物不提交Git。[第三方许可](../../THIRD_PARTY_NOTICES.md)。
- 适配实际PDF.js6 `BinaryDataFactory`；旧CMapReaderFactory/StandardFontDataFactory已不生效。文档只能选择精确白名单文件名，不能构造路径、URL或Wasm请求。逐资源固定长度读取、超长/符号链接/坏hash拒绝、文档内缓存返回独立副本；不加载系统或用户字体，不启用网络/JS/Wasm。文字与视觉共用资源策略，失败无可信页面前缀，两端显示相应字体/映射不可用。
- 修复固定上游新用法在Node24中缺少`Math.sumPrecise`导致字体修复失败：局部二进制精确累加与一次nearest-even舍入，不改全局Math或原型。消去、次正规、负零、溢出、NaN/类型与ties-even专项通过。精确字体修复路径实际执行。
- 非嵌入Zapf默认编码使用上游已有Dingbats Unicode表，修正铅笔/笔尖/勾号被提取为数字；`0123`码位对应`✐✑✒✓`，文字与视觉来源相同，显式ToUnicode优先。依据[PDF.js实际API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[ECMAScript求和语义](https://tc39.es/ecma262/#sec-math.sumprecise)及[公开Dingbats编码表](https://www.unicode.org/L2/L2000/00436-Dingbats.pdf)。
- `pdf-text/4`、`pdf-visual/2;resources/1`、渲染协议2；重新构建对应平台工具及自包含包。旧生成包拒绝。归档、付费复用按新读取契约，预算和未知费用保护保持。
- CJK CMap可恢复精确“中文”，缺少实际CJK字体轮廓仍明确视觉未读。注释/表单、外部或缺失字体、ICC/Wasm和其他PDF特性尚未全部完成；不能把本批写为完整PDF支持。

## 开发验证

- Windows完整reading536项：535通过、1既有symlink权限跳过；同步125、自包含发布2、mini生成/检查通过。14种标准字体有真实轮廓且宿主字体族为0；所有182个非许可资源实际读取/hash核对；缺失、超长、同长度改坏数据、目录/URL/未知名/Wasm均拒绝。
- 项目合成14字体页，用独立PyMuPDF1.28.2生成固定栅格mask/原PDF hash；13字体双向2像素容差覆盖≥97%、墨迹面积比0.85–1.2。不同引擎字体替代/抗锯齿并不逐像素一致；Zapf的独立引擎在铅笔/笔尖设计不同，原参考保留为诊断，不纳入像素相等声明，另按公开编码核对Unicode。已查看实际与参考图片；Poppler当前缺少展示字体，不能作该样本的有效golden。生成脚本不安装包，不采用个人文档。
- 两页标准字体PDF及ZIP内PDF，实际Windows AccountWorkspace和Page/Node wx签名HTTP停止/继续、迟到丢弃、到期/删除后补传、文字/页图/覆盖一致；每链4次**模拟**调用/80微元，修订仅1次且复用2付费块。不是原生微信/手机/安装版验证；本批未新开UI窗口。
- Linux只读自有树`/opt/shixu-bcd-test-20261102-pdf-fonts`，普通UID65534联合27项通过；受保护broker双端两链、未授权daemon拒绝及实际systemd字体视觉/CMap文字读取通过。[机器证据](evidence/pdf-font-linux.json)。工具由Windows esbuild配合SRI验证的Linux原生包交叉构建，实际Linux执行；未冒充Linux本机构建。最小runtime仅加入已验证渲染器的系统动态库，无宿主包安装/字体目录；每次只创建新runtime，不改已有生产服务。
- 字体小页614字节，隔离解析约797ms/RSS103808KiB；CMap页811字节约502ms/RSS91744KiB，为单次样本，非大文档/P95/cgroup峰值证明。
- 首次完整reading暴露WebP隔离测试缺少新增模块副本，补齐后最终完整通过；Windows自包含视觉测试首次在父进程加载DLL导致清理EPERM，改为独立子进程验证后通过。Linux构建环境缺少构建用esbuild，改用现有跨平台构建；broker最初缺客户端视觉能力标记、随后缺渲染动态库，均保留失败日志并实际修正验证。

RAR前头`8d9489b`的CI首attempt卡片夹具未出现；失败作业重跑中该项通过，随后时间审计继续等待20秒超时。原失败保留，未宣称全绿；本批为该等待补最小任务状态诊断，不放宽断言/时间/安全门禁，最终CI按新提交独立核对。

复现：`npm run reading:pdf:visual:build`、`node scripts/build-reading-pdf.mjs --check`；`node --test server/reading/pdf-resources.test.mjs server/reading/pdf-number.test.mjs server/reading/pdf-font-clients.test.mjs server/reading/pdf-visual.test.mjs server/reading/pdf.test.mjs deploy/sync/release.test.mjs`。字体golden由`scripts/generate-pdf-font-goldens.py`生成；隔离脚本`scripts/reading-pdf-font-linux.mjs`仅对全新自有测试树运行。

新增真实API 0；接续既有33次usage估算¥0.060148保持，非最终供应商账单。其余BCD材料、流式/性能、完整独立安全重放及真实证据源继续；不做E/F、生产开放、真实库迁移或安装发布。
