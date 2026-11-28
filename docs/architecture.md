# 架构与目录

拾序使用 React / TypeScript 构建「桶 / 世界 / DDL / 看板 / 管理台」，由 `shared/` 提供跨端复用的整理、截止日期、关联、看板和用量逻辑。Windows 桌面端基于 Electron 提供独立窗口、托盘、悬浮看板、受限文件读取、本机资料隔离和系统密钥保护；微信小程序由 `miniprogram/` 原生实现，并通过构建脚本同源同步共享逻辑与样式；云端服务由 Node.js + SQLite 独立运行。

## 仓库目录地图

| 目录 | 职责 |
| --- | --- |
| `src/bucket/` | 核心产品界面（桶、世界、DDL、附件预览、皮肤、连接与设置） |
| `src/board/` | Windows 桌面看板与悬浮窗口（小条、窄栏、面板、DDL、资料库） |
| `src/admin/` | 统一管理控制台前端（登录、总览、用户、任务、存储、告警与运维） |
| `shared/` | 跨端共享整理、DDL 解析/推定、关联、用量、看板与阅读视图（含 `.d.mts`） |
| `desktop/` | Electron 主进程、预加载 IPC、多账号空间、原件存储、备份、看板窗与更新器 |
| `miniprogram/` | 微信小程序原生工程、本机空间、云同步客户端及自动生成副本 |
| `server/` | 个人服务、v2/v3 同步服务、v4 云端阅读运行时、隔离代理、账本与管理服务 |
| `website/` | 公开静态官网源码（[shixunote.top](https://www.shixunote.top/)） |
| `admin/`、`admin-test/` | 管理控制台与 iPhone 应急直连版的 HTML 入口 |
| `deploy/` | 阿里云同步/云端服务、静态官网与 Windows 管理台的部署脚本与验证测试 |
| `scripts/` | 按职责分层的工程脚本：`build/`、`check/`、`desktop/`、`ops/`、`reading/`、`stage-a/` |
| `e2e/`、`test-fixtures/` | Playwright 端到端回归测试与隔离测试夹具 |
| `public/`、`docs/` | 运行静态资源（图标、角色原画/音频、字体）与分层项目文档 |

## 数据与运行边界

- **Windows 桌面端**：打包后通过 `shixu://app/` 加载本地资源，渲染器进程隔离，一切本机空间读写和原件操作经 `desktop/preload.cjs` 受限 IPC 由主进程校验后执行。资料存于独立 profile，附件按 SHA-256 去重。
- **网页版与应急手机版**：默认打开当前「桶 / 世界 / DDL」应用，资料存于浏览器 IndexedDB；`admin-test/` 复用同一前端但使用独立 IndexedDB 空间与备份格式，面向 iPhone 应急直连，不接入云账号同步（详见 [管理员测试版指南](guides/admin-test.md)）。
- **微信小程序**：原生页面直接维护本机空间，并与云端 v3/v4 同步协议及原件存取互通；共享逻辑与页面样式由 `npm run mini:build` 同源生成并受 `npm run mini:check` 门禁保护。
- **服务端层次**：
  - `server/index.mjs`（8787）：单人轻量网页服务。
  - `server/sync-server.mjs` / `server/sync-multi-user.mjs`（8788）：v2 单空间与 v3 多账号同步服务。
  - `server/reading-runtime.mjs`：v4 云端阅读运行时，装配账号同步、受限隔离阅读代理（`server/reading/broker-service.mjs`）、独立费用账本（`server/reading/ledger.mjs`）及独立管理服务（`server/admin-service.mjs` / `server/console-gateway.mjs`）。

## 视觉与文档入口

- 视觉规范见 [界面与视觉约束](design.md)，第三方素材与依赖许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
- 当前版本状态见 [当前版本基线](current-baseline.md)，开发与验证命令见 [开发指南](guides/development.md) 与 [CI 配置](../.github/workflows/ci.yml)，历次实施记录集中归档于 [历史归档](archive/README.md)。
