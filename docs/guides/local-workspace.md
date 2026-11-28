# 单仓开发与基线检查

日常开发统一在工作区根下的唯一主仓库 **`shixu/`** 进行，工作区登记表位于工作区根 `.codex/shixu-workspaces.json`。旧的多 worktree 历史副本已清理收拢，所有新任务均从最新 `origin/main` 建立独立任务分支推进。

## 每次任务的标准操作顺序

1. **检查工作区并同步主线**：在 `shixu/` 核对 `git status --short --branch` 与远端 `origin/main`，执行 `git fetch origin`。存在未提交修改时先收尾或报告，不自动 `stash` / `reset`。
2. **建立任务分支并运行基线检查**：从 `origin/main` 建立符合规范的专用分支，并运行起点检查：
   ```bash
   git checkout -b feat/your-task origin/main
   npm run workspace:check -- --start
   ```
   构建或交付前可再次运行 `npm run workspace:check`（只读校验，不改分支或文件）。工具会拒绝错误目录、`main` 或 `detached HEAD`、不规范分支名、滞后于 `origin/main` 的旧分支、未解决冲突，以及 `--start` 模式下的未提交改动。
3. **保护既有核心回归**：改动触及既有模块时，按影响面运行对应回归入口，确保修新不破旧。
4. **提交、PR 与合入**：显式暂存文件、遵循 Conventional Commits、通过全部必需 CI 后 squash merge，合入后同步 `main` 并清理已合并任务分支。

## 关键模块防回退对照表

| 触及模块 | 必须保留的核心行为 | 回归验证入口 |
| --- | --- | --- |
| 手机世界与卡片 | 正文可滚动，折叠/详情/完成/星标独立，排序不吞点击 | `e2e/admin-touch.spec.ts`、`e2e/admin-test.spec.ts`、`npm run test:sync` |
| 角色与皮肤 | 狐动作与音频同时间轴、结束回待机、换肤/卸载安全停音 | `e2e/skins.spec.ts`、`scripts/desktop/desktop-skins-smoke.mjs`、`npm run test:mini` |
| DDL 与布局 | 倒计时、录入日基准推定、日期与时刻区间、人工覆盖与重启保留 | `e2e/ddl.spec.ts`、`scripts/desktop/desktop-ddl-smoke.mjs`、`desktop-ddl-time-smoke.mjs` |
| 资料、同步与阅读 | 账号隔离、离线队列、冲突/删除不复活、独立账本与安全门禁 | `npm run test:sync`、`npm run test:desktop`、`node --test server/reading/*.test.mjs` |
| 桌面看板与更新 | 四视图浮窗尺寸/位置记忆、源隔离与 SHA-256 校验更新链 | `scripts/desktop/desktop-board-smoke.mjs`、`npm run test:desktop` |
