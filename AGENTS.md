# 仓库协作要求

本文件适用于 `shixu/` 主仓库内的所有开发任务。修改前结合 [贡献流程](.github/CONTRIBUTING.md) 与 [项目交接](docs/HANDOFF.md) 核对适用验证；桌面产品变更参考 [桌面产品计划](docs/desktop-product-plan.md) 和 [桌面实现](docs/desktop-implementation.md)，当前基线与历史归档见 [当前基线](docs/current-baseline.md) 与 [历史归档](docs/archive/README.md)。

## 日常开发与 PR 流程

1. **唯一主仓与任务分支**：在登记的主仓库目录 `shixu/` 工作。先检查 `git status --short --branch` 与远端 `origin/main`，不在 `main` 或 `detached HEAD` 直接编辑；禁止自动 `reset`、`clean`、`stash` 或覆盖未提交改动。
2. **分支与提交格式**：任务分支使用 `feat/`、`fix/`、`docs/`、`refactor/`、`test/`、`chore/`、`ci/`、`perf/` + 小写英文连字符；显式暂存本任务文件（禁止 `git add .` / `-A`）；提交与 PR 标题遵循 Conventional Commits。纯阅读或咨询不制造空提交/空 PR。
3. **有效验证与诚实记录**：按 [贡献流程](.github/CONTRIBUTING.md) 运行适用检查；修复缺陷优先补充能复现问题的回归测试。不把模拟测试、真实 API 验证、Windows UI 测试或真机测试混为一谈；未执行的检查如实说明。
4. **PR 合并授权**：PR 正文保留「变更内容 / 验证结果 / 风险与回滚 / 双端影响」四节并关联 Issue（未完成保留 Draft PR）。维护者已长期授权：任务完成适用验证、全部必需 CI 通过且无未解决审查阻塞后，由代理直接 squash merge，无需重复请示；禁止绕过 `main` 保护或强推。
5. **分层交付意识**：代码合入、构建打包、用户本机原生安装、云端部署与真机验收分别核实与记录，不互相替代；禁止桌面 UI 代操作（computer-use）。普通技术实现与架构重构由代理自主推进，仅重大方向或外部发布/平台操作向维护者确认。

## 双端持续开发

- **共同能力默认双端评估**：产品行为变更默认评估 Windows 与微信小程序，同步更新 [双端能力表](docs/client-parity.md)（PR policy 强制校验），并在 PR 中写清实际影响与平台适配；单端改动说明判断依据即可。
- **共享产物同源生成**：修改 `packages/shared/`、桌面共享逻辑或微信样式/素材后运行 `npm run mini:build` 并随源提交，由 `npm run mini:check` 校验一致；禁止手改自动生成文件。
- **保留既有核心规则**：
  - 触及已有模块时保留既有修复并跑对应回归（参考 [单仓开发与基线检查](docs/guides/local-workspace.md)）。
  - **DDL 日期与时刻策略**：明确时刻不得丢失，省略年份/月日或缺失时刻均以保存的录入日为基准推定，支持日期与时刻区间，保留人工覆盖与原文；不得退回旧版“缺少年份/时刻一律留空或待确认”策略。

## 数据、费用与发布安全

- 严禁读取或提交 `.env*`、`.private/`、个人 profile、真实通知、密钥、会话、数据库与备份；测试默认使用合成材料、隔离目录和模拟模型。
- 真实付费模型 API 仅在明确授权范围内调用，不把个人资料发送给外部服务作为默认验证。
- `dist/`、`release/` 与安装包不提交进 Git；新增第三方代码或素材须在 [第三方声明](docs/THIRD_PARTY_NOTICES.md) 记录来源与许可证。
- 强制门禁位于 `.github/workflows/ci.yml`（PR 规范、双端能力表、Gitleaks 全历史扫描、核心/浏览器/Windows 桌面测试）与 GitHub `main` ruleset（详见 [仓库治理说明](docs/repository-governance.md)）。
