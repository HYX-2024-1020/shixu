# 当前版本基线

更新日期：2026-11-28。本页汇总当前各端真实基线与活跃入口；部署、本机安装与微信审核状态须分别核实，不以源码提交代替生产验收。

## 各端当前基线

| 模块 | 当前基线 | 核心入口与说明 |
| --- | --- | --- |
| **主线源码** | 包版本 **0.3.33**（`main`） | 唯一主仓库 `shixu/`，结构按 `src/{bucket,board,admin}`、`shared/`、`desktop/`、`miniprogram/`、`server/`、`scripts/{build,check,desktop,ops,reading,stage-a}` 分层。 |
| **Windows 客户端** | 公开发布 **[v0.3.33](https://github.com/HYX-2024-1020/shixu/releases/latest)** | 含桌面四视图看板、世界刷新卡片与防限流软件更新检查；详见 [Windows 0.3.33 说明](releases/windows-0.3.33.md) 与 [Windows 指南](guides/windows.md)。 |
| **微信小程序** | 已上传开发版 **0.3.31**（`bf0251e`） | 备案与代码审核流程由 [#133](https://github.com/HYX-2024-1020/shixu/issues/133) 与真机反馈 [#135](https://github.com/HYX-2024-1020/shixu/issues/135) 跟踪；详见 [小程序指南](../miniprogram/README.md)。 |
| **阿里云服务与管理台** | 现网 **0.3.30**（含 11/25 计价可用性热修复） | 同步与管理服务在 AI 计价表过期时可独立启动，付费请求前仍强检 `priceAt`；平台承担未知费用结案已验证，详见 [运维与操作指南](guides/platform-cost-resolution.md) 与 [同步部署说明](../deploy/sync/README.md)。 |
| **拾序官网** | 现网实机截图版 | 公开地址 [https://www.shixunote.top/](https://www.shixunote.top/)，静态源码位于 `website/`，CI 由 `npm run site:check` 校验。 |
| **应急手机网页** | GitHub Pages 独立空间版 | 入口 `/shixu/admin-test/`，独立 IndexedDB 与 ZIP 备份恢复；详见 [管理员测试版指南](guides/admin-test.md)。 |

## 活跃跟踪与开发约定

- **活跃业务 Issue**：[#69](https://github.com/HYX-2024-1020/shixu/issues/69)（分阶段实施总清单）、[#133](https://github.com/HYX-2024-1020/shixu/issues/133)（小程序首次发布）、[#135](https://github.com/HYX-2024-1020/shixu/issues/135)（小程序真机反馈）。
- **日常开发入口**：先读 [AGENTS.md](../AGENTS.md)、[CONTRIBUTING.md](../CONTRIBUTING.md) 与 [单仓开发与基线检查](guides/local-workspace.md)，在唯一主仓 `shixu/` 从最新 `origin/main` 建立专用任务分支推进。
- **核心架构不变量**：
  - 保留同步与阅读任务的错误码、继续/取消/超时/部分完成恢复语义与独立账本安全门禁。
  - DDL 日期与时刻推定始终以保存的录入日为基准，保留明确时刻、日期区间与人工覆盖。
  - 共享产物通过 `npm run mini:build` 同源生成并由 `npm run mini:check` 校验。

## 历史记录归档

历次整改、三轮集中验收、平台承担结案、看板迭代与 B/C/D 阶段专项证据均已统一归档至 [docs/archive/](archive/README.md)，供追溯查证。

[文档导航](README.md) · [架构与目录](architecture.md) · [双端能力基线](client-parity.md) · [开发指南](guides/development.md)
