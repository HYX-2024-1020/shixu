# 仓库治理与设置

目标仓库：<https://github.com/HYX-2024-1020/shixu>，默认分支 `main`。代码采用 MIT，第三方材料单独保留许可。开发流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)，代理必须遵守 [AGENTS.md](../AGENTS.md)。

## GitHub 端的硬门禁

仓库设为 Public，启用 Issues、私密漏洞报告、依赖漏洞提醒、secret scanning 与 push protection（以账号/平台支持为准）。仅允许 squash merge，合并后自动删除远端任务分支。

`main-pull-request-and-ci` ruleset 的可复现配置位于 [.github/repository-rules.json](../.github/repository-rules.json)：

- 作用于默认分支，无绕过者（管理员也没有默认豁免）。
- 修改必须经过 PR；禁止删除和非快进推送，要求线性历史。
- 必须解决审查讨论，且基于最新 main 通过 GitHub Actions 的 `Required checks`。
- 单维护者阶段额外审批人数为 0；这不等于可跳过 PR 或检查。新增独立维护者后可提升至 1。

`Required checks` 汇总 PR policy、Secret scan、Core checks、Browser E2E、Windows desktop。任一检查失败、取消或跳过，汇总检查失败。所有 PR 都执行这些检查，避免路径过滤导致缺少必需状态。

PR 元数据编辑也会重新验证规范。Dependabot 创建的 PR 免除人工正文格式，但仍需所有测试和安全扫描。工作流不使用 `pull_request_target` 执行贡献者代码，不提供真实模型密钥，默认只有 `contents: read` 权限。

## 管理员复现设置

需要仓库管理员权限，以及支持这些功能的 GitHub 套餐/公开仓库。GitHub 插件未提供仓库设置管理时，可以用 GitHub CLI（`gh auth login` 后）管理；不要把凭据放进命令、文件或提交。

```bash
gh repo edit HYX-2024-1020/shixu --enable-issues --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
gh api repos/HYX-2024-1020/shixu/rulesets
# 首次创建：先确认没有同名规则；更新时用 PUT rulesets/<id>，不要重复添加。
gh api --method POST repos/HYX-2024-1020/shixu/rulesets --input .github/repository-rules.json
# 验证实际生效的规则，而不只是检查本地 JSON
gh api repos/HYX-2024-1020/shixu/rules/branches/main
```

改变可见性会公开已推送的分支、历史、Issue 和 release。首次公开前，应扫描所有可达 Git 历史及检查样本/素材来源；`.gitignore` 不能清除历史中的文件。凭据扫描通过不代表完整隐私或许可证审计。

## 发布和回滚

默认分支只接收通过审查和检查的 PR。版本更新、CHANGELOG 和安装包验收应放在发布 PR 内，GitHub Releases 记录版本、验证范围和 SHA-256。网页 Pages 发布沿用主分支工作流。不要把开发中的分支直接当作正式发布。

出问题时创建 `fix/` 或 `revert/` 对应的任务分支（当前门禁允许的前缀中可用 `fix/revert-...`），通过新 PR revert 原 squash commit，不重写主分支历史、不临时撤销保护。涉及数据库/个人文件先说明兼容性与恢复方法。

## 原工作区接续

治理改动独立于其他未提交的桌面、同步服务、小程序或皮肤功能。维护者接续这些任务时，先检查工作区、拆分任务分支并补齐验证/PR；不要把遗留未提交工作当作已经开源发布。HANDOFF 中历史“未提交/未推送”记录只描述当时状态，以 Git 和 PR 当前证据为准。
