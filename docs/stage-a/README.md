# 阶段 A：设计基线与验证入口

日期：2026-10-28。关联 [实施总跟踪 #69](https://github.com/HYX-2024-1020/shixu/issues/69)、[阶段 A #71](https://github.com/HYX-2024-1020/shixu/issues/71)。

依据 [重要方案 PR #70](https://github.com/HYX-2024-1020/shixu/pull/70)，固定基线为 [da28c1f 的方案](https://github.com/HYX-2024-1020/shixu/blob/da28c1fbf76a0e7c5aae15228d25ecef6cca3ad9/docs/server-client-plan-2026-10-28.md) 与 [术语表](https://github.com/HYX-2024-1020/shixu/blob/da28c1fbf76a0e7c5aae15228d25ecef6cca3ad9/GLOSSARY.md)。开始时 #70 仍为 Draft，main 为 2574a5e，没有方案文件。本分支从该 main 建立，不合并或复制其他任务分支；上述固定链接在 #70 合入前仍可读。后续方案变动须审查差异、更新契约版本和证据，不能自动解释为已实现。

**A 交付的是设计和离线演练。应用服务尚未导入演练模块，没有启用新账号、预算、读取器、清理或任务接口。B–F 的真实功能和生产迁移必须分别实现、验证。**

## 工作包及门禁

| 工作包 | 交付 | A 验收证据 | 后续责任 |
| --- | --- | --- | --- |
| A1 | [任务与接口契约](contracts.md)；输入只读、读取四态、停止/复用/发布、双端降级 | 状态转换、旧状态映射和迟到响应规则测试 | B 读取、C 任务、D 双端接入 |
| A2 | [结构与迁移/恢复](data-and-recovery.md)；版本化 SQLite 结构草案 | 实际旧模块生成合成库，迁移幂等、约束、失败回滚、备份副本回退和恢复屏障测试 | C/D 实施正式迁移，E 演练运行恢复 |
| A3 | [资源配置与验证矩阵](resources.md)；有数值、理由、执行位置和验证方法 | 配置关系校验及逐项可执行的 B–F 验收门禁 | B 实测隔离，F 验证10人容量 |

三个工作包构成一个独立的设计基线任务 #71 / `docs/stage-a-baseline`，以同一 PR 提交，避免互相尚未定稿的契约各自合入。后续 B/C/D 可拆模块推进，但三者必须消费同一个 `contractVersion=1`；E 在安全记录与账本结构稳定后推进，F 在各模块证据齐备后执行。

## 已有能力与改动位置

以 2574a5e 源码为准，不依据旧版 current-baseline 的机器状态推断交付。

| 模块 | 已有 | 必须改变 / 阶段 |
| --- | --- | --- |
| `server/sync-store.mjs` | 租户独立库、版本/游标、操作去重、软删除与清除 | C/D 输入占位写保护、字段级合并与覆盖历史、7天投递回收站；单项最近删除仍30天 |
| `server/sync-files.mjs` | 10MiB单件、20附件、内容哈希和下载校验；UTF-8文本读取 | B 四态、部分覆盖/分页；D 每次20MiB、500MiB逻辑额度、30+7、临时材料隔离 |
| `server/sync-jobs.mjs` | queued/running/applying/done/error/conflict/interrupted、重启恢复、提交编号去重 | C 处理块、cancelled/paused/partial、有效付费块复用、迟到响应屏障、原子发布 |
| `server/sync-provider.mjs`、`shared/bucket-engine.mjs` | 单次请求、结构化整理和事项对话 | B 多模态及来源验证；C 分块、usage、价格快照、每24调用检查点；不恢复单次调用总硬顶 |
| `server/sync-accounts.mjs` | 邀请、Ed25519签名、防重放、微信身份、单端一个有效槽、每日次数/固定预留 | C 累计账本；D 一次性注册、账号密码、3+1槽位、撤销/恢复、登录限制 |
| `server/sync-multi-user.mjs` | 账号隔离、全站并发2、等待20、默认AI关闭 | C 解析1/模型3、公平轮转、独立账本；保留基本操作独立通道 |
| `desktop/accounts.cjs`、`desktop/cloud.cjs`、`src/bucket/` | 主进程凭证/隔离空间、同步和服务端任务入口 | D 注册登录、设备替换、云原件窗口、停止继续、覆盖与额度提示 |
| `miniprogram/lib/accounts.js`、`transport.js`、`pages/` | wx.login、原生存储、任务轮询与离线同步 | D 同一契约与提示，平台文件配额核查；不直接编辑生成副本 |
| `deploy/sync/`、`server/sync-admin.mjs` | CLI、固定快照、停服备份 | E 独立回环管理网页、账本/安全水位、一致备份、7天留存和降级 |

## 执行和证据

Node.js 24，以下命令不需要 npm 安装、凭据或联网：

```sh
node --test scripts/stage-a/*.test.mjs
node scripts/stage-a/rehearse.mjs
node scripts/check-docs.mjs
node --test scripts/check-pr.test.mjs scripts/check-client-parity.test.mjs
git diff --check
```

`rehearse.mjs` 不接受数据目录参数，只创建系统临时目录，使用当前旧模块生成合成 accounts/tenant 数据、关闭连接、复制并迁移，再检查与回退；结束删除自己创建的临时目录。报告仅有检查名称、计数和布尔值，不含账号、令牌、原文或磁盘路径。测试加入 CI Core checks，不替代服务接线、Linux隔离、断电/磁盘满故障注入、微信/Windows UI验收。

详细实际结果在[本地验证记录](verification.md)、本 PR 及 [总 Issue](https://github.com/HYX-2024-1020/shixu/issues/69) 回链；未跑的项目保持未完成，不能将 A 的设计测试作为 B–F 交付。

## 无需夜间打断的问题记录

用户要求常规决策自行记录。以下采用关闭相应新增能力的保守边界，不修改产品共识：

1. 旧 `ai_usage` 只有固定预留、没有供应商 usage，无法还原实际消费。迁移保留全部旧行并建立未知费用记录；旧账号 AI 保持关闭，直到核对历史消费与已领额度，不能当零消费再发20元。资料/同步仍保留。C/D 必须给出管理核对入口。
2. 本轮跨任务10元真实验证已用额无法从公开源码确认。本任务不读私人账本，也不做真实调用，本任务新增费用0元；后续验证前建立同一验证批次账本并核对既往证据，无法确认则不发请求。不能宣称本轮已用0元。
3. DeepSeek 图像能力、价格会变。A 已查官方 [图像文档](https://api-docs.deepseek.com/guides/vision/) 与 [价格](https://api-docs.deepseek.com/quick_start/pricing/)，当前 Flash 支持图像；B/C 在调用前再次核对模型能力、人民币价格来源/换算快照及最大请求，禁止把原有文本模型配置当作已支持图像。没有可靠价格/能力则暂停对应步骤，不接入新供应商。
4. 小程序本地文件的真实配额、生命周期和失败交互在 D 依官方接口与目标基础库实测。当前只承诺尝试保存及失败提示，不承诺永久本地副本；不把该核查阻塞解释为丢弃材料的许可。
5. 资源表是可验证的起步限制，不是当前ECS容量实测。B 不能绕过隔离，F 未证实容量前不开放真实用户。
6. 方案 PR 保持原有 Draft；阶段 A 的 PR 单独审查和 CI。用户未授权本轮部署、安装、发布，均不执行。阶段 A 不自动进入 B。

回退 A 只需 revert 本任务；演练模块不被运行服务引用。生产结构回退限制及无法安全回退时的关闭策略见 [恢复设计](data-and-recovery.md)。
