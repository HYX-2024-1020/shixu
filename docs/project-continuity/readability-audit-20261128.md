# 问题与重构清单

基线为 `71b3a2c`，以下行号均取自修改前。清点 Git 跟踪的 1,072 个文件，对 579 个 JS、TS、TSX、MJS 和 CJS 文件做语法树扫描，查找长函数、仅在导入处出现的标识符、空异常处理和相同函数体。另检索部署脚本和锁文件。声明、模板、样式、工作流、资源及文档计入文件盘点。结果属于静态筛查，动态入口与用户操作流程仍需结合运行情况判断。

## 潜在 Bug、异常处理与边界条件（人工确认）

| 基线位置 | 触发条件与可能影响 | 待决定 |
| --- | --- | --- |
| `scripts/build-console-release.mjs:125`、`:146` | 已有发行目录的文件会逐项比较，但已有安装清单只在输出时解析并取出 sourceRevision。如果清单可解析而内容损坏，脚本仍可能给出成功回执。 | 是否校验已有清单的文件表；相同内容来自不同提交时应沿用哪一个来源。 |
| `scripts/build-cloud-release.mjs:54`、`:59` | 新 manifest 与 SHA256SUMS 分两次写入，中途 I/O 失败可能留下不一致的输出目录。 | 是否要求整个目录原子交付，以及失败时谁负责清理。 |
| `miniprogram/pages/index/index.js:3268` | 音频 stop 抛错后仍执行界面收尾。如果底层仍在播放，动画和声音可能不同步。 | 真机确认错误后音频实例的状态，再决定是否销毁或提示。 |

## 死代码与未使用导入

本轮移除云端发行脚本和控制台发行脚本中的三个 Node 内置模块导入绑定。两个脚本继续从原模块导入其他成员。其余候选按文件列于附表，标识符出现次数只用于定位线索。没有足够证据判定整个文件可删除，尤其是通过 npm、微信配置或安装脚本调用的入口。

## 可读性

| 基线位置 | 观察与处理 |
| --- | --- |
| `scripts/build-console-release.mjs:106` | 指纹、发行名和目标路径在同一条声明中构造。本轮拆成独立声明，并说明排序后的文件摘要与发行名的关系。 |
| `src/bucket/BucketApp.tsx:114` | BucketApp 跨 2,334 行。拆分前需梳理状态与副作用的所有者，尤其是回调闭包。留待专项处理。 |
| `src/bucket/Results.tsx:48` | Results 跨 2,046 行，结果操作与渲染交织。拆分需核对交互状态与渲染顺序。 |
| `server/reading/tasks.mjs:1048` | step 跨 811 行。提取步骤可能改变任务中断与恢复时的写入顺序，留待专项处理。 |

## 重复逻辑与过时依赖

| 基线位置 | 观察与处理 |
| --- | --- |
| `scripts/build-console-release.mjs:67`、`:104`、`:106`、`:117` | 多处计算 SHA-256 十六进制摘要。本轮复用同一文件内的摘要函数，保留输入字节、文件排序及指纹拼接格式。 |
| `scripts/stage-a/legacy/sync-files.mjs:38`、`server/sync-files.mjs:38` | validateReferences 函数体相同。前者属于历史实现，独立副本有助于对照，保留。 |
| `package-lock.json:2799`、`:4012`、`:4310`、`:5407` | 锁文件分别标记 boolean 3.2.0、glob 7.2.3、inflight 1.0.6 和 rimraf 2.6.3 已弃用。升级需检查上游依赖和打包兼容性。 |

## 附表：未使用的具名导入候选

| 文件 | 基线行号与本地绑定 |
| --- | --- |
| `e2e/bucket.spec.ts` | 5 `closeRecords` |
| `e2e/relations.spec.ts` | 12 `readFile` |
| `scripts/build-cloud-release.mjs` | 7 `copyFile`、9 `resolve` |
| `scripts/build-console-release.mjs` | 1 `stat` |
| `scripts/build-reading-archive.mjs` | 14 `dirname` |
| `scripts/cloud-operations-worker.mjs` | 9 `unlinkSync` |
| `scripts/demo-twenty.mjs` | 3 `readFile` |
| `scripts/desktop-chat-smoke.mjs` | 4 `copyFile` |
| `scripts/reading-apng-linux.mjs` | 2 `mkdir` |
| `scripts/reading-association-linux.mjs` | 2 `mkdir`、6 `createLinuxReader` |
| `scripts/reading-association-live.mjs` | 4 `readFileSync` |
| `scripts/reading-client-loop.mjs` | 18 `resolve` |
| `scripts/reading-native-verification.mjs` | 2 `readFile` |
| `scripts/reading-office-clients.mjs` | 6 `imageProgressView` |
| `scripts/reading-office-linux.mjs` | 2 `mkdir` |
| `scripts/reading-pdf-annotation-linux.mjs` | 2 `mkdir` |
| `scripts/reading-pdf-font-linux.mjs` | 2 `mkdir` |
| `scripts/reading-pdf-text-annotation-linux.mjs` | 2 `mkdir` |
| `scripts/reading-pdf-visual-linux.mjs` | 2 `mkdir` |
| `scripts/reading-rar-solid-linux.mjs` | 2 `mkdir` |
| `scripts/reading-solid-linux.mjs` | 2 `mkdir` |
| `scripts/reading-window-safety-linux.mjs` | 2 `mkdir`、6 `createLinuxReader` |
| `server/reading/office-fixtures.mjs` | 1 `WORD_NS` |
| `server/reading/pdf-visual.test.mjs` | 4 `readPdfVisual`、19 `decodeJpeg` |
| `shared/deadline-date.mjs` | 1 `groundedTime` |
| `src/App.tsx` | 12 `ArrowDown`、15 `BookOpen`、18 `CheckCheck`、23 `Command`、25 `Flag`、48 `LinkArrow`、57 `Kind` |
| `src/Settings.tsx` | 15 `DEFAULT_PREFS` |
| `src/bucket/card-merge.ts` | 1 `ItemState` |
| `src/bucket/item-chat.ts` | 9 `groundedDate`、10 `groundedTime` |

## 第二批重构结果

附表共列出 40 个绑定。第一批删除 3 个，第二批删除 37 个。逐文件核对源码文本后，没有发现这些本地名称在导入以外的引用。历史对照实现与生产实现继续独立保存。

- BucketApp 拆出附件筛选和待整理投递的创建。附件超限时逐项跳过或中止的顺序、提示、草稿清空与云端提交仍由原流程控制。
- Results 拆出原文检索索引、事项行构造与排序字段映射。保留旧事项索引回退、习惯打卡、手动排序和组内排序的优先级。
- ReadingTasks.step 拆出单输入读取，沿用原有分页选择、校验、覆盖记录和错误传播。窗口选择与两处待处理输入判断共用同一个私有能力查询，每次调用重新读取当前能力。
- 归档构建器将自身脚本摘要作为缓存键。删除未使用导入会在下次调用时触发一次正常的原生工具重建；本次没有生成或手工修改缓存凭据。

### 三项待确认的修复

| 位置（第一批基线） | 建议的最小修改 | 风险与后续验收场景 |
| --- | --- | --- |
| 控制台安装清单，`scripts/build-console-release.mjs:125` | 复用现有目录前，解析并比较 application、fingerprint、Node 版本与许可地址，以及按路径对应的完整文件表、大小和摘要。验证 sourceRevision 是合法提交标识；同内容不同提交保留首次打包的来源。格式或内容损坏时报错退出，保留现场。 | 中。旧清单缺字段时会阻断复用，需要重新生成。验收覆盖损坏清单、有效旧清单和同字节不同提交。 |
| 云端发行目录，`scripts/build-cloud-release.mjs:54` | 在目标同一文件系统的私有临时目录完成基础包和增量文件写入，校验更新后的清单和 SHA256SUMS，最后一次重命名发布。保留目标已存在时拒绝覆盖的约定，并让并发构建遵循同一目标锁。 | 中。需保留默认输出命名、命令回执和跨平台目录语义。正常失败只清理本次临时目录；进程被强杀可留下临时目录。验收覆盖中断、重试与同目标竞争。 |
| 微信音频停止，`miniprogram/pages/index/index.js:3268` | 仅在 stop 抛错时，保存失败实例，解除当前实例引用并清空文件缓存，再尽力 destroy；动画收尾仍执行一次。下次播放沿用现有创建流程。 | 低至中。destroy 也可能失败，底层声音无法保证立即停止。需真机验证切换皮肤、连续点击与页面卸载，确认旧回调不会结束新播放。 |

### 四项弃用依赖的迁移评估

本机安装树显示，四项都由 electron-builder 的构建工具链间接引入。下表为实施成本估计，具体可用的父包版本须在批准迁移时重新核对。多个依赖共用上游，成本不能简单相加。

| 锁定依赖 | 当前引入路径（自 app-builder-lib 起） | 替换方案与成本 |
| --- | --- | --- |
| boolean 3.2.0 | @electron/get → global-agent；global-agent 的 roarr 也使用它 | 中。优先选用已迁出这两个调用点的上游代理或下载器版本。保留代理环境变量字符串的布尔语义，需覆盖代理下载和日志开关。 |
| glob 7.2.3 | @electron/asar；另一条路径来自 temp → rimraf | 中至高。更新使用受维护 glob API 的 ASAR 打包器，并处理 rimraf 路径。核对 Windows 通配符、排除项及 ASAR 文件清单。参见[上游接口](https://github.com/isaacs/node-glob)。 |
| inflight 1.0.6 | 两条 glob 7 路径共享 | 低（随 glob 迁出）。确认两条路径都移除旧版后重算锁文件。只有上游仍需要并发去重时，才由该调用方适配受维护实现。[上游已归档](https://github.com/isaacs/inflight-DEPRECATED-DO-NOT-USE)。 |
| rimraf 2.6.3 | electron-builder-squirrel-windows → electron-winstaller → temp | 中。选择使用受维护清理实现的父包；若维护 temp 适配层，可对确定的临时目录使用 Node 的 fs.rm。核对 Windows 文件占用、重试和安装器清理。参见[上游迁移说明](https://github.com/isaacs/rimraf)。 |

### 第二批具体文件

- `docs/client-parity.md`
- `docs/project-continuity/readability-audit-20261128.md`
- `e2e/bucket.spec.ts`
- `e2e/relations.spec.ts`
- `scripts/build-reading-archive.mjs`
- `scripts/cloud-operations-worker.mjs`
- `scripts/demo-twenty.mjs`
- `scripts/desktop-chat-smoke.mjs`
- `scripts/reading-apng-linux.mjs`
- `scripts/reading-association-linux.mjs`
- `scripts/reading-association-live.mjs`
- `scripts/reading-client-loop.mjs`
- `scripts/reading-native-verification.mjs`
- `scripts/reading-office-clients.mjs`
- `scripts/reading-office-linux.mjs`
- `scripts/reading-pdf-annotation-linux.mjs`
- `scripts/reading-pdf-font-linux.mjs`
- `scripts/reading-pdf-text-annotation-linux.mjs`
- `scripts/reading-pdf-visual-linux.mjs`
- `scripts/reading-rar-solid-linux.mjs`
- `scripts/reading-solid-linux.mjs`
- `scripts/reading-window-safety-linux.mjs`
- `server/reading/office-fixtures.mjs`
- `server/reading/pdf-visual.test.mjs`
- `server/reading/tasks.mjs`
- `shared/deadline-date.mjs`
- `src/App.tsx`
- `src/Settings.tsx`
- `src/bucket/BucketApp.tsx`
- `src/bucket/Results.tsx`
- `src/bucket/card-merge.ts`
- `src/bucket/item-chat.ts`
