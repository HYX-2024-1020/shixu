# 桌面实现入口

当前源码版本 **0.3.27**，Electron 45 + React/TypeScript，复用 `shared/` 的整理、关联和用量逻辑。产品包来源f8771df，原云端与Windows/原管理台已更新，用户原入口确认及无包身份物理回执核验通过，功能集中复验仍待。公开Release仍为0.3.8，运行包、必需CI、部署与安装分层见[第二轮整改记录](project-continuity/acceptance-round2-repair-20261113.md)，复验见[0.3.27指南](guides/product-acceptance-0.3.27.md)；实际状态与未合并成果先读[当前入口](current-baseline.md)。下方历史实现入口继续保留，不能用源码版本替代物理安装证据。

- 入口与生命周期：`desktop/main.cjs`，独立窗口、托盘、退出前草稿保存。
- 安全边界：sandbox/contextIsolation、受限 IPC、静态协议路径校验、外部网页交给系统浏览器。
- 数据、原件与备份：`desktop/storage.cjs`、`backup.cjs`，专属 profile、原件去重、最近删除与一致性保护。
- 文件处理：`archive.cjs`、`office.cjs`、`src/bucket/ingest.ts`；明确返回覆盖说明，代码只作文本，不执行宏或脚本。
- 当前 UI 与皮肤：`src/bucket/`，卡片原位开合、长按排序、本次投喂与皮肤共用当前桌面基线。
- 绯樱狐使用同一时间轴的30fps透明视频与Opus原声，不另开音频播放器；`shixu:`本地资源协议启用`stream`以支持视频解码，仍通过既有路径校验和`net.fetch(file:)`取本地文件；未增加外部网络能力。协议标志含义见[Electron官方文档](https://www.electronjs.org/docs/latest/api/protocol)。
- 验证：`test:desktop` 与 `test:desktop:ui`（当前套件以package.json和CI为准）；`SHIXU_PACKAGED_EXE` 可指向实际 exe，使用隔离 profile。

详细目录见 [架构](architecture.md)，操作命令见 [开发指南](guides/development.md)。[历史日志](archive/desktop-implementation-2026-10.md)仅供追溯，实际发行验证见 [0.3.8](releases/windows-0.3.8.md)和对应 Release 报告。

- DDL：`src/bucket/DDL.tsx` 与 `shared/deadlines.mjs`，小程序共用解析/分区函数；见 [DDL 实现记录](ddl.md)。

  0.3.9本机安装与微信工程的早期记录见[交付记录](releases/windows-0.3.9.md)；后续版本见[当前入口](current-baseline.md)，旧机器状态不作为继续开发依据。
