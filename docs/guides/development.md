# 开发、验证与打包

先读 [贡献流程](../../CONTRIBUTING.md)。需要 Node.js **24.x**、npm、Git；Electron 运行和桌面 UI 回归需要 Windows。一般测试使用合成资料和模拟模型，无需真实 API 密钥。

```bash
npm ci
npm run dev
```

网页开发默认 `http://localhost:5173`。Windows 独立桌面开发使用 `npm run desktop:start`，不使用早期“启动网页当桌面”的脚本。

## 验证命令

| 命令                          | 验证范围                                 |
| ----------------------------- | ---------------------------------------- |
| `npm run check`               | TypeScript                               |
| `npm test`                    | 整理逻辑、存储与皮肤单元测试             |
| `npm run build`               | 网页生产构建、离线壳与公开版本信息       |
| `npm run test:e2e`            | 当前网页 Chromium/WebKit 回归            |
| `npm run test:desktop`        | 文件、原件、备份与桌面存储               |
| `npm run desktop:build`       | Electron 前端资源                        |
| `npm run test:desktop:ui`     | 十二套 Windows UI 回归，含皮肤跨进程重启 |
| `npm run test:server`         | 可选旧个人网页服务                       |
| `npm run test:sync`           | v2 同步服务与小程序逻辑                  |
| `npm run test:sync:release`   | 服务发布包、重启、备份与恢复             |
| `node scripts/check-docs.mjs` | 当前文档本地链接与入口约定               |

首次运行浏览器测试可能需要 `npx playwright install chromium webkit`；本机默认 Edge，CI 使用 Chromium/WebKit。微信生命周期模拟不等于开发者工具编译或真机验收。

## Windows 打包

```bash
npm run desktop:pack
```

产物位于 `release/`，当前本机构建安装器为 `Shixu-Setup-0.3.9.exe`（尚未上传公开 Release）。`SHIXU_PACKAGED_EXE` 指向实际 exe 时可验证打包/安装后的程序，使用独立临时 profile。`SHIXU_DATA_DIR` 只应指向明确选定的测试目录。

安装包不进入 Git。版本、锁文件和说明经 PR 合并，必需检查通过后从对应提交发布 Release，附 SHA-256、验证范围和限制。打包成功、隔离 exe 回归和个人工作区安装分别记录。

## 网页发布

[Pages 工作流](../../.github/workflows/pages.yml)以 `/shixu/` 为资源基路径，从 main 通过 GitHub Actions 部署。仓库 Pages 设置必须启用并选择 workflow；只有源码或构建成功不能证明站点已发布。

生产构建生成 `version.json`，包含包版本与源码提交，不含个人信息。发布后核对该文件和皮肤入口。域名访问、部署状态与浏览器离线缓存是不同环节，排查时先确认远端提交再看缓存。

## 手工与真实模型验收

`scripts/desktop-live-*.mjs` 会使用已保存密钥、产生 API 费用，不属于默认验证，只有明确授权后运行。原生 QQ/微信拖入、iOS 系统入口也需真实环境。不要上传真实通知、密钥、个人 profile、数据库或备份。

旧个人网页服务与 v2 同步服务是不同入口：当前同步工作使用 [deploy/sync](../../deploy/sync/README.md)，不要把旧 `/api` 当作当前桌面全量同步协议。
