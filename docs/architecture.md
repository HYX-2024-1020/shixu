# 架构与目录

拾序采用清晰的 Monorepo 组织方式：前端基于 React / TypeScript 构建「桶 / 世界 / DDL / 看板 / 管理台」，由 `packages/shared/` 提供跨端共享核心规则；Windows 桌面端基于 Electron 提供独立窗口、托盘、悬浮看板与本机隔离存储；微信小程序位于 `apps/miniprogram/`，由构建脚本同源同步共享逻辑与样式；云端同步与受限阅读服务位于 `apps/server/`，基于 Node.js 24 与 SQLite 运行。

## 仓库目录地图

| 目录 | 职责 |
| --- | --- |
| `apps/web/` | 前端工程：`index.html`、`admin/index.html`、`admin-test/index.html`、`public/` 与 `src/{bucket,board,admin}/` |
| `apps/desktop/` | Windows Electron 主进程、预加载 IPC、多账号空间、原件存储、备份、看板窗与更新器 |
| `apps/miniprogram/` | 微信小程序原生工程、本机空间、云同步客户端及同源生成产物 |
| `apps/server/` | 个人服务、v2/v3 同步服务、v4 云端阅读运行时、隔离代理、账本与管理服务 |
| `apps/website/` | 公开静态官网源码（[shixunote.top](https://www.shixunote.top/)） |
| `packages/shared/` | 跨端共享整理、DDL 解析/推定、关联、用量、看板与阅读视图（含 `.d.mts`） |
| `deploy/` | 阿里云同步/云端服务、静态官网、Windows 管理台部署脚本与 `deploy/env/` 模板 |
| `scripts/` | 按职责分层的工程脚本：`build/`、`check/`、`desktop/`、`ops/`、`reading/`、`stage-a/` |
| `tests/` | Playwright 端到端回归测试（`tests/e2e/`）与隔离测试夹具（`tests/fixtures/`） |
| `docs/` | 统一文档中心（架构、交接、更新日志、隐私、术语、第三方声明、指南、发行与归档） |
| `.github/` | GitHub Actions CI/Pages 工作流、Issue/PR 模板及社区规范（`CONTRIBUTING`/`SECURITY`/`CODE_OF_CONDUCT`） |

## 数据与运行边界

- **Windows 桌面端**：打包后通过 `shixu://app/` 加载本地资源，渲染器进程隔离，一切本机空间读写和原件操作经 `apps/desktop/preload.cjs` 受限 IPC 由主进程校验后执行。资料存于独立 profile，附件按 SHA-256 去重。
- **网页版与应急手机版**：默认打开当前「桶 / 世界 / DDL」应用，资料存于浏览器 IndexedDB；`apps/web/admin-test/` 复用同一前端但使用独立 IndexedDB 空间与备份格式，面向 iPhone 应急直连，不接入云账号同步（详见 [管理员测试版指南](guides/admin-test.md)）。
- **微信小程序**：原生页面直接维护本机空间，并与云端 v3/v4 同步协议及原件存取互通；共享逻辑与页面样式由 `npm run mini:build` 同源生成并受 `npm run mini:check` 门禁保护。
- **服务端层次**：
  - `apps/server/index.mjs`（8787）：单人轻量网页服务。
  - `apps/server/sync-server.mjs` / `apps/server/sync-multi-user.mjs`（8788）：v2 单空间与 v3 多账号同步服务。
  - `apps/server/reading-runtime.mjs`：v4 云端阅读运行时，装配账号同步、受限隔离阅读代理（`apps/server/reading/broker-service.mjs`）、独立费用账本（`apps/server/reading/ledger.mjs`）及独立管理服务（`apps/server/admin-service.mjs` / `apps/server/console-gateway.mjs`）。

## 视觉与文档入口

- 视觉规范见 [界面与视觉约束](design.md)，第三方素材与依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 当前版本状态见 [当前版本基线](current-baseline.md)，开发与验证命令见 [开发指南](guides/development.md) 与 [CI 配置](../.github/workflows/ci.yml)，历次实施记录集中归档于 [历史归档](archive/README.md)。
