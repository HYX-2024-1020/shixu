# 参与拾序开发

欢迎反馈问题、改善文档和提交代码。项目采用 [MIT](LICENSE)；第三方素材及样本的来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。请遵守 [社区行为准则](CODE_OF_CONDUCT.md)，安全问题使用 [私密漏洞报告](SECURITY.md#报告安全问题)。

## 开发环境

需要 Node.js 24（CI 使用相同主版本）、npm 和 Git。Windows 桌面 UI 验证需要 Windows；网页开发可使用 Windows、macOS 或 Linux。

```bash
npm ci
npm run dev
# Windows 独立桌面窗口
npm run desktop:start
```

一般开发和自动测试无需真实 API 密钥。需要本地环境变量时复制 `.env.example`，不要提交 `.env`。`package.json` 的 `private: true` 防止误发布 npm 包，不影响 GitHub 公开或 MIT 许可。

## Issue → 分支 → PR → 合并

1. 较大功能或缺陷先开 Issue，说明场景、目标和验收标准；小型文档/拼写修正可直接 PR。不要贴真实个人文件或凭据。
2. 检查工作区，更新 `origin/main`，为一个独立任务创建分支。外部贡献者先 fork；维护者可以直接在仓库建立任务分支。

   ```bash
   git fetch origin
   git switch -c fix/attachment-recovery origin/main
   ```

   已有未提交工作时使用独立 worktree，不覆盖、不混入。允许 `feat/`、`fix/`、`docs/`、`refactor/`、`test/`、`chore/`、`ci/`、`perf/` 前缀，后面用小写英文及连字符。

3. 完成实现和适用验证。提交前审查差异、敏感信息及第三方许可，显式选择要暂存的文件。
4. 提交使用 `type: 简述` 或 `type(scope): 简述`；PR 标题遵守同样格式。正文保留“变更内容”“验证结果”“风险与回滚”三节，填写实际结果，关联 Issue（例如 `Closes #123`）。未完成工作开 Draft PR。
5. 推送任务分支并创建 PR，等待 `Required checks` 成功、处理 review。由维护者审阅并 squash merge，GitHub 自动删除已合并远端分支。不要绕过保护或直接推送 `main`。

单维护者阶段不要求额外一名审批人，因为作者不能批准自己的 PR；PR、CI 和讨论解决仍强制执行。引入第二位维护者后，可以把 required approvals 提升为 1。AI 代理还须遵守 [AGENTS.md](AGENTS.md)。

## 变更验证表

| 变更                       | 合并前验证                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 所有变更                   | `git diff --check`，检查 PR 描述、无凭据或个人数据；CI 全部必需检查                                                        |
| 文档/仓库配置              | 检查链接、命令和配置语法；`node scripts/check-docs.mjs` 检查文档链接，`node --test scripts/check-pr.test.mjs` 验证 PR 门禁 |
| 前端/共享整理逻辑          | `npm test`、`npm run build`、`npm run test:e2e`                                                                            |
| 个人服务                   | 上述核心检查及 `npm run test:server`                                                                                       |
| Electron/文件/备份/桌面 UI | `npm run test:desktop`、`npm run desktop:build`、`npm run test:desktop:ui`（Windows）                                      |
| 新增模块                   | 增加模块所需验证并接入 CI；不能引用尚未提交的其他工作区文件                                                                |

CI 对所有 PR 执行核心测试/构建、浏览器 Chromium/WebKit 回归、Windows 桌面回归、PR 规范检查和 Gitleaks 全历史扫描，不按文件路径跳过必需检查。UI 测试使用隔离 profile 和模拟接口。没有实际执行的验证必须在 PR 中明确标注，不能用“应该通过”代替结果。

本地浏览器测试默认使用 Edge，CI 使用 Chromium/WebKit。首次运行可能需要安装浏览器：

```bash
npx playwright install chromium webkit
npm run test:e2e
```

`desktop-live-*.mjs` 使用已保存的真实密钥并产生费用，不属于默认测试；只有获得用户授权后才运行。Windows 安装包与 GitHub Releases 需要另外完成发布验收，不以源码测试成功代替。

## 提交前检查

- 差异只包含本任务；没有 `.env`、个人文件、备份、数据库、构建产物或真实 API 凭据。
- 用户能观察到的行为变化已更新说明；缺陷有适当回归验证。
- 第三方材料有来源和许可；截图/报告只含合成或已获授权的公开数据。
- PR 写明测试命令与实际结果、未验证限制和回滚方式。

凭据扫描工具会有漏报，发现疑似泄露请私密报告并优先撤销凭据，不要把完整凭据粘贴到 Issue。

目录与运行边界见 [架构说明](docs/architecture.md)，开发/测试/发布命令见 [开发指南](docs/guides/development.md)。旧实施日志集中在 docs/archive，不从历史机器状态推断当前交付。
