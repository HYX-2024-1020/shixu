# 邀请账号与服务端 AI（Issue #40）

本任务从 2026-10-25 最新 main `006a0c7` 开始。当前提交实现独立的 v3 服务端闭环；Windows 和微信客户端的激活界面、固定服务地址、Windows 云端 AI 队列仍待接入，不能开放朋友试用。旧 v2 启动入口、已安装客户端和服务器没有被自动切换。

## 数据和授权

`server/sync-multi-user.mjs` 是新入口，只接受 `/api/v3/`。未授权者只能访问状态与激活接口；账号授权后先定位账号专属数据库，再进入已有投递、事项、DDL、删除恢复、同步操作、附件和 AI 处理器。账号由服务端设备凭证决定，不接受 URL/body 中的 userId。每个账号有自己的 epoch、游标、冲突、操作幂等日志、附件去重空间、任务及结果；相同记录 ID 不会引用另一个账号。

集中 `accounts.sqlite` 保存账号、邀请码哈希、设备绑定、公钥、重放 nonce、限流和用量预留。`users/<服务端UUID>/workspace.sqlite` 保存该账号的资料。注册表与资料目录只能由服务账号/管理员访问，Linux 运行时 umask 0077；管理员通过本机受保护 CLI 操作，不提供公网管理接口。

一个邀请码创建一个账号，分别提供一个 Windows 槽位和一个微信身份槽位。Windows 激活和后续请求必须提供 Ed25519 签名，签名覆盖请求方法、路径（含查询）、原始正文 SHA-256、时间及 nonce；请求允许 60 秒偏差，nonce 防重放。公钥与私钥应在 Windows 主进程生成并由系统加密保存，不能放到渲染层。重试用同一密钥返回同一设备及凭证，换密钥须管理员先撤销旧槽位。

这是安装密钥的持有证明，不是硬件或操作系统证明；复制整个私钥仍可克隆身份。服务端不相信客户端自报平台。第一版不宣称 TPM 硬件不可导出绑定。微信槽位必须通过服务端向微信交换 wx.login 的 code 获得 openid，不接受客户端提供的 openid；AppSecret/session_key 不返回客户端。生产微信身份联调尚未完成。[微信登录协议参考](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)。

凭证有效期一年；撤销和停用立即影响后续读写/下载以及尚未调用模型的队列任务。已经发出的模型请求不能撤回供应商的费用；返回后撤销校验会阻止覆盖资料，保留冲突结果供账号核对。恢复原安装密钥可幂等激活；重装丢失密钥、换机或凭证到期先由管理员撤销槽位，再激活，不清除账号资料。邀请码应私下交付；泄露时联系管理员处理，不在日志或 Issue 粘贴。

## 保守配额与成本边界

初始配置每账号每日 10 个 AI 任务、每分钟 60 次授权 API 请求、32 MiB 逻辑存储（投递 UTF-8 JSON、附件字节、任务保留内容及操作日志估算）；每文件仍 10 MiB，每投递 20 个附件。不同账号不共享附件去重或配额。逻辑配额不是 SQLite 文件/索引/WAL 的精确磁盘容量，也不是机器容量保证；上线前还须监测磁盘、内存和出网。20 个邀请仅为内测人数目标。

每账号至多 1 个未结束的 AI 任务，全站最多同时调用 2 次模型、最多 20 个未结束任务。每日额度按 UTC 自然日重置，客户端应展示此口径。默认 AI 关闭、单任务和每日预算均为 0。任务输入材料默认 24,000 UTF-8 字节；实际模型请求（含系统提示）上限 64,000 字节，这是保守输入体积上限，不宣传精确 tokenizer 计数。输出请求上限 1,024 tokens、HTTP 输出上限 128,000 字节。超限保留原文，二进制附件仍不假装已读取。

每个稳定任务 ID 只预留一次额度与费用上界，不因响应丢失或重放重复扣减。可能已经计费的失败/中断不自动退款或重试；同一任务只允许一次模型 HTTP 调用，长文分块/模型修复需要额外调用时明确拒绝，防止单任务预算扩大。费用字段是 **预留上界**，不是供应商实际账单或 token 用量；管理员必须按所选服务端模型当前价格、64 KB 最大请求和输出上限确认单任务预留足够，再设置非零预算。没有真实模型计费测试。

模型 Key 仅由新入口的服务端环境读取；模型固定由服务端选择。AI 总开关可即时阻止新任务和等待中的调用，已经发出的请求不保证立即取消。用量和错误日志不记录原文、Key、邀请码、openid、微信 code 或会话密钥。资料同步会上传用户明确放入云空间的原文、事项及附件；AI 整理/对话会把相关文本（含支持读取的 UTF-8 原件）发给模型供应商。统一 Key 解决密钥管理与使用门槛，不消除资料经过服务器和供应商的隐私风险。

## 本机合成验证与管理员 CLI

先创建受保护的独立 `.env.sync`（已忽略），不要把真实配置写进版本库。新入口只绑定 loopback：

```text
SYNC_ACCOUNT_DIR=data/accounts-v3
SYNC_ACCOUNT_SECRET=<至少32字符的随机秘密，持久保存，勿更换>
SYNC_ORIGIN=http://127.0.0.1:8788
SYNC_PORT=8788
SYNC_AI_ENABLED=false
SYNC_AI_CONCURRENCY=2
SYNC_AI_QUEUE_LENGTH=20
SYNC_AI_MAX_INPUT_BYTES=24000
SYNC_AI_MAX_OUTPUT_TOKENS=1024
SYNC_AI_TASK_BUDGET_MICROS=0
SYNC_AI_DAILY_BUDGET_MICROS=0
```

预算单位为人民币的百万分之一，须与供应商计费币种一致。真实 Key、预算与微信 AppSecret 仅由管理员配置，不是默认步骤。注册表验证 secret 指纹，意外更换会拒绝启动，防止悄然签发不兼容凭证。备份必须保留原 secret（独立于代码库）。

```powershell
npm run sync:accounts
npm run sync:admin -- generate 20
npm run sync:admin -- disable USER_UUID
npm run sync:admin -- enable USER_UUID
npm run sync:admin -- revoke USER_UUID windows
npm run sync:admin -- revoke USER_UUID wechat
npm run sync:admin -- limit USER_UUID dailyJobs 10
npm run sync:admin -- limit USER_UUID storageBytes 33554432
npm run sync:admin -- usage USER_UUID
npm run sync:admin -- ai-pause
npm run sync:admin -- ai-resume
npm run test:sync
npm run test:sync:release
```

CLI 的 generate 只显示一次邀请码，数据库只存其哈希；输出应存放到受保护位置并私下交付，不进入终端共享记录。CLI 应与服务使用相同服务用户、目录和秘密；生产环境用 node 的 `--env-file=/etc/shixu-sync/service.env`，不要在命令参数中传凭据。管理员开 CLI 不会重置运行中任务的费用预留。

## 旧空间迁移与发布门槛

不自动打开、迁移或认领旧 `workspace.sqlite`，新账号默认空资料。旧个人 profile、模型 Key、客户端草稿不被读取或上传。部署包包含两种入口，但安装脚本/systemd 仍启动旧 v2；没有因此部署 v3。

正式切换前：完成双端 v3 激活和统一 AI 接入；备份环境、注册表及所有用户数据库；合成资料验证；停止服务取得一致性快照，再把 systemd 启动入口改为 v3，确认旧 v2 接口不可访问。不同时间分别在线备份注册表和资料库不能称为跨库一致性备份。初始现有单用户空间继续封存，不能把它作为所有邀请码的初始资料。

如维护者将来明确要求认领旧空间：先备份并在隔离副本验证；显式指定唯一目标账号且目标为空；仅复制审核后的完整旧资料库副本至该账号目录，撤销副本全部旧设备、清除旧设备幂等/任务授权、生成新 epoch，再由两端在保留离线队列的前提下重新核对。原文件保留。当前没有执行此流程，也尚未提供自动认领命令，禁止手工直接覆盖正在使用的新账号数据库。

回滚：停新服务，保存完整新数据与环境，恢复旧服务入口且继续使用原 v2 路径；新账号数据不会出现在旧服务。已激活 v3 客户端应显示服务不可用并保留本地队列。不能让旧代码指向新注册表或混合不同时间的账号快照。

后续仍须完成双端激活界面、凭证系统保存、按账号区分本地缓存/草稿/任务、Windows 服务端 AI、离线状态、适用 UI 回归及真实微信联调。公网 HTTPS、DNS、微信服务器域名与手机验收独立跟踪；备案尚在初审不能写成已完成。此阶段不部署、不安装、不发布客户端，不做计费压测。
