# 拾序 Shixu

拾序是面向学生和个人的事务管理工具。把通知、截图、附件和零散想法放进「桶」，在「世界」编辑和管理事项，用「DDL」查看截止日期，在「看板」安排短期与长期计划。

**[下载 Windows 最新版](https://github.com/HYX-2024-1020/shixu/releases/latest) · [拾序官网](https://www.shixunote.top/) · [Windows 使用指南](docs/guides/windows.md)**

## Windows **0.3.33**

本版修复 GitHub 匿名 API 限流导致的软件更新检查失败。

1. 从 GitHub Releases 下载 Windows x64 安装器。覆盖升级前先备份，再从系统托盘退出拾序，安装时沿用原目录。
2. 从桌面「拾序」入口打开。可直接在本机录入、查看和备份资料。账号同步与 AI 服务按实际开通状态使用。
3. 在「看板」选择小条、窄栏、面板或 DDL，点击右上角「打开悬浮看板」。规划、配色、字号、缩放和透明度在主程序调整。

- **桶与世界**支持文字和文件投递、原件预览、分组、搜索、星标、拖动排序与恢复。
- **DDL**支持日期区间、时刻推定与人工核对。
- **桌面看板**包含多份规划、短期及长期事项、独立资料库，以及可拖动和调整大小的悬浮窗口。
- **资料管理**可在本机备份与恢复事项、草稿和原件。接入账号的资料按空间管理。

[版本说明](docs/releases/windows-0.3.33.md) · [更新日志](CHANGELOG.md) · [反馈问题](https://github.com/HYX-2024-1020/shixu/issues/new/choose)

## 其他入口

| 入口 | 用途 |
| --- | --- |
| [拾序官网](https://www.shixunote.top/) | 产品介绍、公开指引与隐私说明 |
| [网页版](https://hyx-2024-1020.github.io/shixu/) | 浏览器体验，资料留在对应浏览器 |
| [微信小程序](miniprogram/README.md) | 开发工程与导入指南 |
| [同步服务](deploy/sync/README.md) | 独立部署与账号服务说明 |

## 开发与贡献

需要 Node.js 24.x 和 npm，Windows 桌面运行及原生界面测试需要 Windows。

```bash
npm ci
npm run dev
npm run desktop:start
```

[文档目录](docs/README.md) · [开发指南](docs/guides/development.md) · [架构说明](docs/architecture.md) · [贡献流程](CONTRIBUTING.md)

[隐私与数据](PRIVACY.md) · [安全报告](SECURITY.md) · [社区行为准则](CODE_OF_CONDUCT.md)

代码采用 [MIT](LICENSE)。依赖和素材见 [第三方声明](THIRD_PARTY_NOTICES.md)。
