# 拾序 Shixu

拾序是面向学生和个人的事务与资料整理工具：把通知、截图、附件和零散想法丢进「桶」，在「世界」管理事项，在「DDL」跟进截止日期，在「看板」规划短期与长期任务。

**[下载 Windows 最新版](https://github.com/HYX-2024-1020/shixu/releases/latest) · [拾序官网](https://www.shixunote.top/) · [网页体验版](https://hyx-2024-1020.github.io/shixu/) · [Windows 使用指南](docs/guides/windows.md)**

## Windows **0.3.33**

- **桶与世界**：文字与文件投递、原件预览、分组、搜索、星标、拖动排序、回收与恢复。
- **DDL 视图**：支持日期与时刻区间、录入日基准推定与人工核对。
- **桌面看板**：多份规划、短期/长期事项、独立资料库，以及小条/窄栏/面板/DDL 四视图悬浮窗口。
- **跨端与同步**：本机资料备份恢复、账号空间同步、受限隔离阅读与防限流软件更新检查。

安装与升级说明见 [0.3.33 发行说明](docs/releases/windows-0.3.33.md) · [更新日志](docs/CHANGELOG.md) · [反馈问题](https://github.com/HYX-2024-1020/shixu/issues/new/choose)。

## 仓库结构

```text
shixu/
├── apps/
│   ├── web/           # 前端主应用（桶 / 世界 / DDL / 看板 / 管理台 / 应急直连）
│   ├── desktop/       # Windows Electron 主进程、IPC、原件、备份、看板窗与更新器
│   ├── miniprogram/   # 微信小程序原生工程
│   ├── server/        # 同步服务、v4 云端阅读运行时、隔离代理、账本与管理服务
│   └── website/       # 拾序静态官网（shixunote.top）
├── packages/
│   └── shared/        # 跨端共享整理、DDL、关联、看板、用量与阅读视图规则
├── deploy/            # 阿里云服务、官网、Windows 管理台部署脚本与 env 模板
├── scripts/           # 分层工程脚本（build / check / desktop / ops / reading / stage-a）
├── tests/             # Playwright 端到端测试（e2e）与隔离夹具（fixtures）
└── docs/              # 文档导航、架构说明、指南、发行说明与历史归档
```

## 快速开始

需要 Node.js **24.x** 与 npm（Windows 桌面运行及原生 UI 测试需要 Windows）：

```bash
npm ci
npm run dev            # 网页开发（http://localhost:5173）
npm run desktop:start  # Windows Electron 桌面端
```

## 文档与合规

- **工程与开发**：[文档导航](docs/README.md) · [架构与目录](docs/architecture.md) · [项目交接](docs/HANDOFF.md) · [开发指南](docs/guides/development.md) · [贡献流程](.github/CONTRIBUTING.md)
- **端与部署**：[微信小程序指南](apps/miniprogram/README.md) · [同步与云端部署](deploy/sync/README.md) · [统一管理控制台](docs/e-admin-ui/README.md)
- **隐私、安全与许可**：[隐私与数据](docs/PRIVACY.md) · [安全报告](.github/SECURITY.md) · [社区行为准则](.github/CODE_OF_CONDUCT.md) · [第三方声明](docs/THIRD_PARTY_NOTICES.md) · [MIT License](LICENSE)
