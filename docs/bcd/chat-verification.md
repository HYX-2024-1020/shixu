# 事项对话接入共享账本与任务内核

2026-10-31，#73/#69，Draft PR #74。本增量是 C 的事项对话实施与开发验证，B/C/D 整体仍未完成，不是最终联合验收。

## 行为与边界

Windows AccountWorkspace 与微信 Page 都通过 `/api/v4/tasks` 的 `kind: chat` 发起请求。只有配置了显式 `provider.chat` 才声明可用；旧 v3 AI 入口继续拒绝绕过累计账本。两端远端发现任务时保留 kind/itemId，界面说明仅依据已保存事项与本轮指令，不重新读取原件，输入统一限制 4000 字。

对话使用 ReadingTasks 原有账号槽、公平队列、独立 ReadingLedger、个人累计 ¥20、全站北京时间每日 ¥50、单任务并发预留 ¥2、根累计 1800 秒/24 调用检查点、generation 停止和关闭流程。不是另建聊天额度，也不把 24 调用变成任务总量上限。原件可用性/同 hash 核验及必要临时补传仍按 D 的既有门禁执行；它们不代表把附件正文重新发送给模型。对话材料是服务端构造的受限 JSON，不执行附件解析器。

只发送当前保存事项、状态、笔记、最近 16 条对话及本轮指令。省略历史条数明确提供；当前事项与指令不静默截断，整个上下文超过 512KiB/120000 码点即拒绝。未传原始投递正文或其他事项。旧资料/历史不是模型指令，不声称重新核对原文。模型只能返回 reply 和白名单 patch，日期锚点须来自本轮指令，沿用共享日期/明确时刻校验；无其他事项修改、删除、文件执行或消息发送能力。

发布仅改目标事项，保留兄弟事项、稳定 ID、人工笔记、阅读覆盖及原件生命周期；按已有卡片规则维护 doneIds、completedAt、corrected 和历史。发布事务内先检查原上下文，成功时原子提交事项、发布凭据和任务终态；失败可明确继续恢复，历史不重复追加。

独立账本新增不可修改/删除的对话请求意图和付费结果 hash 凭据，租户库只保存有界用户指令及标识，不复制提取原文。付费信封可在块写入失败后恢复；跨修订普通整理块不能冒充对话结果。租户请求缺失、块内容被改或已付费块与信封同时丢失会关闭执行，不重新付费猜测。清除任务可移除指令正文，独立费用/安全凭据保留。这是该入口的防回退原语，不代表全域账号/删除/撤销安全迁移已经完成。

## 验证

源文件 hash、命令分组、Linux UID 与未验证边界见[结构化证据](evidence/chat-validation.json)。

- Windows 无窗口对话专项 17 项通过：双端签名 HTTP 一条链（各发起一次对话）、计费/目标隔离、发布失败后重启、非法修改、unknown、稳定编号、停止晚到、账号槽、上下文改变、三类租户回退、信封恢复、关闭超时、站点/并发预算及完成状态元数据。
- 直接相关任务/路由/供应商组 88 项通过；随后对话新增边界及发布包单独补验。供应商 chat.prepare 使用相同预留与不重试的响应读取器，模拟请求检查 JSON/工具禁用/usage；不将其称为真实模型质量验证。
- 核心 93 项、同步及小程序 125 项、桌面账号适配/账号 v4/调度/关闭 12 项、自包含发布包 2 项、PR/双端政策 8 项通过。独立发布包实际执行一次合成对话，不仅检查文件存在。
- `npm run build`、`mini:build`、`mini:check`、官方 `mini:compile` 通过；WXML/WXSS 及编译模板验证不是 IDE/真机测试。没有本机 UI 窗口。
- Linux `/opt/shixu-bcd-test-20261031-chat`，只读独立源树、普通 UID nobody，chat/chat-clients/deepseek 20 项通过，包括实际 AccountWorkspace 与 Page/Node wx 经签名 HTTP 的对话链。复用已有依赖，不安装宿主包、不碰生产库。此对话不解析附件，未伪称新增 broker 图像/附件隔离验证。

复现命令：

```sh
node --test server/reading/chat.test.mjs server/reading/chat-clients.test.mjs server/reading/deepseek.test.mjs
node --test deploy/sync/release.test.mjs
npm test
npm run test:sync
npm run build
npm run mini:check
npm run mini:compile
```

本增量没有新增真实 API 调用；此前 PNG/JPEG 两次合成调用及 ¥0.008794 估算保留，不能借作聊天提示词质量证据。原生微信/手机、安装版、真实模型对话质量、生产部署/真实迁移未验。全文跨块语义合并、关联 AI 共账、供应商账单与宿主终止证据、全域安全重放/正式迁移等仍见[当前实施清单](implementation-status.md)。最新提交的完整必需 CI 在远端正常执行，状态以 PR 评论为准，保持 Draft。
