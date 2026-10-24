# 桌面实现入口

当前 Windows **0.3.8**，Electron 45 + React/TypeScript，复用 `shared/` 的整理、关联和用量逻辑。

- 入口与生命周期：`desktop/main.cjs`，独立窗口、托盘、退出前草稿保存。
- 安全边界：sandbox/contextIsolation、受限 IPC、静态协议路径校验、外部网页交给系统浏览器。
- 数据、原件与备份：`desktop/storage.cjs`、`backup.cjs`，专属 profile、原件去重、最近删除与一致性保护。
- 文件处理：`archive.cjs`、`office.cjs`、`src/bucket/ingest.ts`；明确返回覆盖说明，代码只作文本，不执行宏或脚本。
- 当前 UI 与皮肤：`src/bucket/`，卡片原位开合、长按排序、本次投喂与皮肤共用当前桌面基线。
- 验证：`test:desktop` 与十二套 `test:desktop:ui`；`SHIXU_PACKAGED_EXE` 可指向实际 exe，使用隔离 profile。

详细目录见 [架构](architecture.md)，操作命令见 [开发指南](guides/development.md)。[历史日志](archive/desktop-implementation-2026-10.md)仅供追溯，实际发行验证见 [0.3.8](releases/windows-0.3.8.md)和对应 Release 报告。

- DDL：`src/bucket/DDL.tsx` 与 `shared/deadlines.mjs`，小程序共用解析/分区函数；见 [DDL 实现记录](ddl.md)。
