# 架构与目录

拾序使用 React/TypeScript 构建当前「桶 / 世界」，复用 JavaScript 整理、关联和用量逻辑。Windows 使用 Electron 提供独立窗口、托盘、受限文件处理、本机资料和系统密钥加密；网页使用浏览器存储。

| 目录               | 职责                                 |
| ------------------ | ------------------------------------ |
| `src/bucket/`      | 当前界面、皮肤、事项与输入处理       |
| `shared/`          | 模型整理、关联、用量与类型定义       |
| `desktop/`         | Electron 主进程、IPC、文件/原件/备份 |
| `server/`          | 可选网页服务与独立 v2 文字同步服务   |
| `miniprogram/`     | 微信小程序开发工程与同步客户端       |
| `deploy/sync/`     | 固定快照部署、systemd、备份和恢复    |
| `e2e/`、`scripts/` | 当前端到端测试、构建与维护工具       |
| `public/`、`docs/` | 运行资源与项目文档                   |

## 数据与运行边界

- **Windows**：`shixu://app/` 加载打包资源，不运行 Vite 服务；渲染器隔离，文件操作走受限 IPC。资料在专属 profile，附件按 SHA-256 去重。
- **浏览器**：默认当前 UI，IndexedDB 保存草稿与资料，记住的密钥使用本机 localStorage。静态托管不保存个人投递。
- **旧资料兼容**：`src/main.tsx` 仅在 `?legacy=1` 选择 `LegacyApp`。相关旧组件、Supabase schema 和独立数据入口保留，以免切断既有资料访问；不作为默认展示。
- **旧个人服务**：`server/index.mjs` 提供单人网页服务、Cookie 会话与整理队列，默认 8787。它不能完整承接当前 Windows 的 v2 同步语义。
- **v2 同步**：`sync-server.mjs` / `sync-store.mjs`，默认 8788，独立 SQLite、设备令牌、版本游标、操作去重、冲突与删除标记。当前只有文字同步，AI、附件、微信登录尚未接通。

## 界面与历史

[视觉约束](../design/README.md)记录当前风格，运行资源只有 `public/` 与代码组件。早期静态参考页重复副本已删除，Git 历史保留；[第三方声明](../THIRD_PARTY_NOTICES.md)保留来源及待补授权。

逐轮日志集中在 [archive](archive/README.md)，当前需求和验收见 [产品计划](desktop-product-plan.md)、[开发指南](guides/development.md)与 [CI](../.github/workflows/ci.yml)。
