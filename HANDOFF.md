# 开发接续

开始修改前读取 [AGENTS.md](AGENTS.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)，检查 Git 状态、远端和已有 PR。

2026-11-02：已整理[当前基线](docs/current-baseline.md)、[成果复用与推进约束](docs/project-continuity/README.md)及[本地/远端盘点](docs/project-continuity/inventory-20261102.md)。功能开发仍暂停；保留既有成果，总清单不自动成为执行队列。先定位实际checkout，不能从旧main或预览目录直接继续。Windows最新本机交付记录为0.3.23，公开Release仍为0.3.8；B/C/D在Draft #74，未合并或部署。

- 当前发行：Windows **0.3.8**，包含皮肤市场；以 [最新 Release](https://github.com/HYX-2024-1020/shixu/releases/latest) 为下载入口。
- 进度与下一步：[当前基线](docs/current-baseline.md)。
- 桌面需求：[产品计划](docs/desktop-product-plan.md)；实现入口：[桌面实现](docs/desktop-implementation.md)。
- 开发、测试和打包：[开发指南](docs/guides/development.md)。

每个任务从更新后的 origin/main 创建专用分支。有其他任务的未提交文件时使用独立 worktree，禁止直接在 main 开发、覆盖旧工作区或夹带改动。

早期逐轮实施日志已移至 [历史归档](docs/archive/README.md)，其中的版本、机器路径和历史授权不能代替当前任务的 Git 状态或开发规范。
