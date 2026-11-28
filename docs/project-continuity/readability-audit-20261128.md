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
