# 拾序 Windows 改造接续入口

更新于 2026-10-23。用户已授权持续分阶段完成全部首版主体，每完成并验证一项更新清单；不要重复询问已确认的产品问题。先读 docs/desktop-product-plan.md，再看 docs/desktop-implementation.md 最新验证记录。

## 当前状态

当前版本为 **0.3.3**，已安装并验证。采纳建议有就地反馈和防连点；同行材料直接进入预览，下载为次级菜单。最新完整验收见本文末尾 0.3.3 记录。以下 0.3.1 描述保留视觉纠偏背景，不是当前版本号。

最新反馈：用户认为 0.3.0 改坏其前端观感，已纠偏为 0.3.1 并实际安装成功，安装器退出码 0，已安装版本 0.3.1.0。必须以原稿构图与视觉为基准，只改真实功能必需之处，不再擅改为左右分栏、全黑阴影或其他设计。已恢复居中标题/黄底描边块/角色/气泡/计数/短投喂栏、世界页左角色与两行标题、彩色阴影与导航数字。原稿字体和许可随包离线提供，笑声仅点击播放。已按安装后的 exe 验证新交互与字体。原生 QQ/微信/资源管理器拖拽仍未实际验证，不能把此历史待验项冒称通过。

已实现：

- 独立 Electron 窗口、内置资源、单实例、关窗进托盘、托盘打开/退出；没有全局呼出快捷键或默认开机启动。
- 投递桶与整理结果两工作区；混合文字、文件、截图先积攒草稿再手动提交；缩略图、落点反馈、重复提示和持久整理回执。
- 原件按 SHA-256 去重保存；串行原子写入、版本检查、首批桌面 profile 升级；系统加密密钥；含草稿/原件/用量/最近删除的备份导回与损坏原件修复。
- DeepSeek Flash 图片与扫描页识别链路；DOC/DOCX、XLS/XLSX、PPT/PPTX、代码、ZIP/RAR/7z；逐文件/逐页来源和成功/未读覆盖清单。旧 PPT 文本可能含母版/历史，旧 XLS 最多 5000 行；嵌套、分卷、加密及失败均明确说明，附件代码不会执行。
- 七类内容按需显示；课程/项目和手动分组；稳定 UUID 事项与关联；任务状态、其他类别归档、星标、置顶、跨日临期排序、自定义顺序、人工编辑、简单习惯打卡。
- 事项/整次投递/原件分别删除恢复，30 天清理，保护共享原件；过期/永久删除记录和附件不可被旧保存请求复活。
- 总结/原文要求/建议/待确认分层，来源转写修正留存首次版本；补充读取先列候选，明确确认新增或合并，保护人工修改并记录依据。处理中断保留检查点，等待明确重试，避免自动重复提交。
- 最新视觉为纸黄/亮黄、墨黑描边、硬阴影与用户提供鲸鱼角色，底部“桶 / 世界”。旧紫桶已移除，Windows 图标也已更新。
- 结果默认卡片，分组可选，不出现“未分组”；右上角星形切换星标、圆形勾选完成、菜单置顶/编辑/删除。打开卡片后要求与来源直接展开；原始文字/图片/文件随同一次投递保留，不独立堆在页面底部。
- 默认缩减说明与小字，筛选/重要程度理由/记录按需进入；保留真实用量统计及输入隔离优化。

## 已验证

- npm run check：通过。
- npm test：39 项通过。
- npm run test:desktop：12 项通过。
- npm run test:server：1 项原服务器回归通过；没有部署服务器。
- npm run test:desktop:ui：6 套 Electron 脚本，覆盖生命周期/混合输入/加密设置、管理、混合材料与扫描页、补充恢复、中断、旧桌面升级及 1000 次投递 / 2000 条事项性能。
- 0.2.0 安装后的 exe 及 0.2.1 发布构建均运行 UI 回归；此次还修正了测试脚本对异步条件过早通过的问题，6 套重新通过。具体包标识见 release/validation-summary.json。
- ZIP/7z/RAR 与旧 Office 使用真实格式样本。默认回归中的模型仍为模拟接口；独立真实模型脚本已完成实际调用。
- release/live-validation.json：合成通知日期/时刻、PDF、命名、表格、公式和来源 6 项检查通过。
- release/live-acceptance.json：实际发布程序中的 PNG、扫描 PDF、公开中文手写读取，以及六类内容、相对/绝对/模糊日期、建议/附件指令边界共 14 项检查通过。只发送公开/合成材料，未读取个人投递；有限样本不等于通用准确率。

## 当前交付位置

- 最新安装包：release/拾序 Setup 0.3.1.exe。SHA-256：F8B9D7CF5CA4028E1636BE299547AB0EDB7CF6AA9F6435B232898122C3F36E84。
- 已安装 0.3.1.0：C:/Users/No Choice/AppData/Local/Programs/shixu/拾序.exe；桌面“拾序”快捷方式指向独立应用，安装器退出码 0。
- 旧桌面启动快捷方式已备份到 .private/before-desktop-install/拾序-old-launcher.lnk；原 scripts/launch-desktop.ps1 和 vite.config.ts 既有 watch 修改保留。
- 默认资料：%APPDATA%/ShixuDesktop/workspace/state.json 与 files/；密钥是 profile 下独立 api-key.enc，不进备份。
- 未提交、未推送。保留全部工作区改动；不要运行 git reset/clean，不删除旧浏览器测试资料。

## 唯一剩余的验收与接续动作

1. **来源应用拖拽**：Windows 目前锁屏，已向用户异步请求解锁并保持桌面可操作。computer-use 技能实际可通过 node_repl 的 @oai/sky 控制 Windows，先前“没有原生工具”的结论已纠正。必须先读该技能及 guidance/confirmations；锁屏时不得尝试交互或代为认证。QQ、微信均有运行窗口；必须分别实测真实文件、图片、文字/链接等载荷及不可读反馈，不以 DOM 测试替代。
2. 可运行 node scripts/desktop-native-input-probe.mjs，SHIXU_PACKAGED_EXE 指向 release/win-unpacked/拾序.exe。该探针创建无密钥隔离 profile、只接收草稿不提交、不调用模型；drop 的 types/items/files 与草稿数量保存在 release/native-input-probe.json。上次探针已结束且无任何实际 drop，不能算通过。
3. 用户 2026-10-23 已回复“已配置”，密钥存在且真实调用成功，不再索要配置。真实脚本只克隆加密密钥/Local State，不读个人 workspace；验收后移除临时加密元数据。公开手写样本准备方式见 desktop/fixtures/README.md。
4. 桌面解锁后让旧实例正常退出、运行 0.3.0 安装器，再用 SHIXU_PACKAGED_EXE 指向安装路径完成回归，更新 validation-summary.json 中 installedVersion/patchInstallation。不要强杀用户运行中的实例。
5. 用户明确可以一边试用当前成品、一边给改进意见；新反馈与剩余验收并行处理，不扩展到手机、鱼动画、复杂日历或云端部署。

## 常用命令与约束

- npm run desktop:start / npm run desktop:pack。
- npm run test:desktop:ui 使用临时独立 SHIXU_DATA_DIR；模型部分为模拟接口。
- SHIXU_PACKAGED_EXE 可指向安装后的 exe，以同一套脚本验证发布构建。
- node scripts/desktop-live-check.mjs 是单独的真实效果检查，不能混入默认自动测试。
- 测试附件在 desktop/fixtures；来源与限制见该目录 README。
- 不输出密钥，不查服务器凭证，不部署服务器，不把未验证项勾成完成。


## 0.3.0 接续注意

- 当前用户反馈优先于旧视觉计划；不重新引入紫桶、“未分组”占位、默认折叠组或独立附件仓库。
- 对原型仅采用风格/素材，真实程序仍是 React/Electron，不能替换为原型的静态演示和按文件名猜测类型。
- 新增 ItemDialog.tsx / DeliverySources.tsx；事项详情通过原生 dialog 管理焦点和 Escape；附件按投递保存/软删/恢复/永久删除。
- scripts/desktop-management-smoke.mjs 已按卡片与菜单入口更新并增加无“未分组”、无独立附件区、直接展开、置顶、Escape 断言。
- 发布构建源代码与 exe 各跑完六套回归；已视检 release/desktop-smoke.png、desktop-results.png、desktop-detail.png。
- 本轮已看到可操作桌面，不再以历史锁屏断言当前状态；旧来源拖拽验收仍未执行。不要自动发送 QQ/微信消息。
- 安装后更新 release/validation-summary.json 的 installedVersion/patchInstallation，并勾选产品清单第 7 节最后一项。


## 0.3.1 当前接续点

- 用户明确否定上一轮视觉自由发挥，保持参考稿是最高优先级；本轮已逐项对照截图，说明见 design/README.md。
- 新版源码六套回归通过，字体最终完整文件 NotoSansSC.ttf 17772300 字节、SpaceGrotesk.ttf 136676 字节，OFL 许可一并存放；不要用字体未下载完整时的旧构建。
- 用户已退出旧实例。打包完后正常运行安装器 /S --currentuser，再以 SHIXU_PACKAGED_EXE 指向安装路径跑六套回归。安装完成后更新本文及 release/validation-summary.json，打开真正安装的新版。


## 0.3.1 完成记录

- 安装已实际完成，不再要求用户重复退出旧版或安装旧 0.3.0 包。用户已明确退出，进程为 0 后正常覆盖安装；没有强杀个人实例。
- 新增回归验证离线 Noto 字体已真正加载，角色点击开始/停止（测试模拟媒体 play，避免出声）；所有投递/管理/恢复/性能脚本保留。
- 当前安装包标识和验证结果以 release/validation-summary.json 为准；不要使用上文历史 0.2.0/0.3.0 安装描述。


## 用户请求的 20 场景演示

- 已通过真实安装版投递与模型处理生成 20 次虚构投递、26 条事项、22 个原始附件（PNG/PDF/DOCX/MD/CSV/ZIP），共 39 次模型调用，无读取失败。
- 已导入当前 %APPDATA%/ShixuDesktop，保留原先 1 条记录；导入前备份路径及本批 packetIds 见 release/demo20-manifest.json。所有新事项标题均带 [演示]，便于检索和以后清理。不要重复生成或重复调用模型。
- 通过 Ctrl+R 刷新真实应用，世界页显示全部 26；已设置搜索 [演示]。生成脚本 scripts/demo-twenty.mjs，材料与隔离生成 profile 位于 manifest 指向的 .private/demo20-*。加密密钥和 Local State 临时副本已移除；备份不含密钥。
- 用户中途两次要求继续并催促速度，内容其实已处理完，耗时点是原生文件选择窗口；最终改用应用同一份 importBackup/原子存储代码安全合并，完成后刷新 UI。后续避免在文件选择窗口反复试探。

## 0.3.2 补充信息与直接预览

- [x] 移除概览卡片、详情和回执默认“不确定项/待确认”提示；保留底层来源与日期依据，不编造缺失日期。补充读取的候选仍由用户选择合并/新增，入口改为“补充整理结果”。
- [x] 每个事项详情增加“我的补充”输入与记录，保存到该事项 itemState.additions；重启、人工编辑仍保留，搜索包含补充内容；不自动再次调用模型。
- [x] card-copy.ts 为已有文案去除演示前缀、日期待确认括注、重复标题及部分说明性赘语，完整原始内容仍保留；标题两行、摘要三行。引擎提示词约束未来标题与摘要的核心信息和长度，完整要求放 facts。
- [x] 附件默认直接预览，材料先于补充输入和长篇依据显示；紧凑横向文件切换，下载/删除为次级图标。图片直接显示，PDF 本地 canvas 翻页；DOCX/Office/压缩包显示正文或已提取文字，CSV/TXT 安全文本显示。Office 不宣称保持原排版，暂不支持的格式仍可保存原件。
- [x] 新增 desktop-preview-smoke.mjs：图片自动显示、两页 PDF 实际像素、DOCX 正文、CSV 不执行 HTML、压缩包内容、快速切换取消、零下载/运行错误；management 回归覆盖有不确定项也无提醒、补充保存与重启保留。
- [x] 43 项前端/引擎 + 12 桌面 + 1 服务器检查通过；源码、打包 exe、安装 exe 七套界面回归通过。截图 release/desktop-preview-image.png / desktop-preview-pdf.png / desktop-detail.png。
- [x] 用户正常退出旧版后安装 0.3.2，退出码 0，实际版本 0.3.2.0；升级前备份 .private/before-0.3.2.zip，升级状态记录 .private/upgrade-0.3.2.json；21 次投递/35 条事项原始状态哈希一致，保留用户后来新增与采纳的事项，不要再恢复到最初 26 条。
- 打包器重新下载 Electron 会等待很久；可复用已安装且版本匹配的运行时：npm run desktop:build 后 npx electron-builder --win --x64 --config.electronDist=node_modules/electron/dist。不要同时运行两个打包进程。

## 0.3.3 用户报错修复（优先于旧版完成描述）

- [x] 修复“采纳为行动”无就地反馈：原来成功 toast 在原生模态 dialog 后，按钮也不显示已采纳；现在根据持久化 origin 显示禁用的“已采纳 ✓”与窗口内“已加入任务卡片”。按投递加同步 ref 锁和处理中状态，捕获失败可重试，不依赖 toast。
- [x] 回归模拟同一按钮同一事件循环连点 5 次，只产出一条 origin；关闭再打开仍禁用，人工编辑与补充继续保留。
- [x] 卡片“同行材料”直接进入独立原生预览窗口，默认显示首个原件；文件名和缩略图为预览入口，有明确“预览”字样；保存原件收进更多菜单，不再给主要入口下载图标。图片支持原图放大，PDF 仍为真实画面翻页。旧 PacketCard 文件入口也改为预览（此组件当前未挂载到主流程）。
- [x] scripts/desktop-demo-preview-check.mjs 从个人存储只读提取 manifest 的 20 条演示投递，在隔离 profile 逐个点实际“同行材料”入口并检查 22 个原始附件（不是重造测试样本）；全部显示内容，零下载，不复制密钥、不调用模型、不改个人资料。报告 release/demo-preview-validation.json。
- [x] 0.3.3 已正常安装，实际版本 0.3.3.0；用户退出后安装，未强杀。升级前备份 .private/before-0.3.3.zip，状态摘要 .private/upgrade-0.3.3.json。安装后验证及资料哈希以 release/validation-summary.json 为准。
- 不要再以“之前合成样本预览通过”否定用户体验；真实入口、明确视觉反馈、已安装版本必须一起核对。

## GitHub 同步方式

- 用户于 2026-10-23 明确要求同步当前全部成果。目标私有仓库 HYX-2024-1020/shixu，远程名 origin，主分支 main。
- 本地与远程早期提交历史不同，但早期代码快照基本相同；同步保留两边历史，以当前验证过的桌面成果为最终文件快照，不使用强制推送。
- 同步源码、用户提供的参考前端、离线素材/字体和许可、测试与交接清单。构建产物不进入 Git，Windows 安装包在 GitHub Releases；个人 workspace、密钥、草稿、导出备份及 .private 不上传。
- .openai/hosting.json 只保留本地运行配置，不进入仓库；原远程也没有此文件。

### 2026-10-23 同步已完成

- [x] 桌面成果提交 7660ceb；保留远程历史的合并提交 506257129a992c612ad2d918492863b019dda764 已推送 main，GitHub package.json 已核对为 0.3.3。无强制推送。
- [x] Release：https://github.com/HYX-2024-1020/shixu/releases/tag/v0.3.3 。安装包资产名 Shixu-Setup-0.3.3.exe，144240623 字节，SHA-256 7923e920c1c5090614952e4b485d18ecdc2ea2db3ca0005144d1b076f7f1d33a，GitHub 返回摘要与本地一致。附 blockmap、预览截图、去除本机路径的验证摘要、SHA256SUMS.txt。
- [x] 工作区追踪 main → origin/main；个人资料/密钥/.private/备份未上传。GitHub 仍为私有仓库。
- GitHub 原有 Pages 发布工作流的构建、测试、产物上传通过，但部署返回 404，日志提示启用 GitHub Pages（settings/pages）。本次为源码与 Windows 成果同步，未改仓库可见性或 Pages 设置；这不是 Windows 安装包发布失败。云端 Verify 在同步时仍执行，不宣称云端全部通过。
- 大包首次 push 出现 HTTP 408，重试使用 git -c http.postBuffer=524288000 -c http.version=HTTP/1.1 push -u origin main 成功。
