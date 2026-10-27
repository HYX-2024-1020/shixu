# 阶段 A 本地验证记录

日期：2026-10-28（北京时间）。Issue #71，分支 `docs/stage-a-baseline`，基于main 2574a5e。范围与限制见 [入口](README.md)。

## 已实际执行

| 命令 | 实际结果 |
| --- | --- |
| `node --test scripts/stage-a/*.test.mjs` | 20项通过：状态/迟到响应、付费块复用、北京时间日界、资源关系、恢复水位、真实旧模块合成库迁移、幂等、3处故障注入回滚、原始副本字节回退、3+1槽位/双连接抢槽、只追加事件/不可变价格、有效usage约束及重复迁移投影完整性 |
| `node scripts/stage-a/rehearse.mjs` | 2个合成账号、1份有资料租户、7任务迁移；原件/资料/绑定/游标/去重保留；未知预留保留、不重复赠额；4库完整性检查及回退通过；无供应商调用 |
| `node --test scripts/check-pr.test.mjs scripts/check-client-parity.test.mjs` | 8项通过 |
| `node scripts/check-docs.mjs` | 链接与当前入口通过；最终文档数量以命令输出为准 |
| `npm run test:sync` | 122项通过，真实本机HTTP与模拟模型、小程序逻辑；不等于微信原生UI/手机验收 |
| `npm run test:server` | 1项通过，模拟模型 |
| `npm run mini:check` | 14个生成文件同源检查通过 |
| `npm test` | 16文件、93项通过 |
| `npm run build` | TypeScript及生产网页构建通过；构建产物不入Git |
| `git diff --check` | 通过；提交前另检查显式暂存差异 |

新worktree首轮mini:check因未安装esbuild而未执行成功；执行 `npm ci --ignore-scripts --no-audit --no-fund` 后重新运行成功，锁文件和依赖声明无修改。这里不将忽略安装脚本的环境称为Electron安装/打包验证。阶段 A 演练自身只依赖Node 24内置模块和仓库已有旧模块，不需要新增npm包。

## 尚未执行或不属于 A 的证据

- 必需远端CI结果在本任务PR记录，不能以本地20项或旧提交CI代替。新增演练已接入Core checks。
- 本地未运行浏览器E2E、Electron UI/安装器、微信官方编译或手机真机；没有运行界面/客户端代码变动，CI仍按仓库规则运行全套必需检查。
- 未进行Linux沙箱/资源压力实测、10租户整套切换、实际运行服务备份恢复或生产迁移。A验证的是结构草案与恢复设计；这些仍由B/E/F实测。
- 没有真实DeepSeek、真实微信身份、私有资料读取、服务器部署、安装或发布。本任务新增模型费用0元；本轮跨任务10元验证预算的既有消费仍需调用前核对，不宣称其已用0元。

## 交付与回退

后续从本PR的固定提交消费契约，方案PR #70保持原有状态。A1/A2/A3技术证据在本文，合并/审查状态以PR为准；总Issue #69保持开放，B–F不勾选。

回退本任务只撤销文档、演练脚本和CI新增步骤。演练没有运行服务入口，不更改个人资料、服务器或客户端。正式迁移后发生新消费/删除/撤销时不能照搬合成副本全量回退，须遵守 [恢复屏障](data-and-recovery.md)。
