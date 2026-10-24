# 开发接续

开始修改前读取 [AGENTS.md](AGENTS.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)，检查 Git 状态、远端和已有 PR。

- 当前发行：Windows **0.3.8**，包含皮肤市场；以 [最新 Release](https://github.com/HYX-2024-1020/shixu/releases/latest) 为下载入口。
- 进度与下一步：[当前基线](docs/current-baseline.md)。
- 桌面需求：[产品计划](docs/desktop-product-plan.md)；实现入口：[桌面实现](docs/desktop-implementation.md)。
- 开发、测试和打包：[开发指南](docs/guides/development.md)。

每个任务从更新后的 origin/main 创建专用分支。有其他任务的未提交文件时使用独立 worktree，禁止直接在 main 开发、覆盖旧工作区或夹带改动。

早期逐轮实施日志已移至 [历史归档](docs/archive/README.md)，其中的版本、机器路径和历史授权不能代替当前任务的 Git 状态或开发规范。
