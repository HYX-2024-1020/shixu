# 阶段 A1：任务与接口契约 v1

依据与范围见 [阶段 A 入口](README.md)。下列 v4 路由是待 B/C/D 实现的契约，不表示当前 v3 服务已接受。所有 ID 由服务端验证、账号来自凭证，不接受客户端指定租户目录。相同账号双端共用投递、额度和任务；每个查询/下载/修改都校验归属与设备授权。

## 实体与一致性

- 一次用户明确提交是一个投递 `packetId`。每次明确再投递产生新 `submissionId` 和新 `packetId`；网络重试重用原编号，不能仅以文件哈希合并用户主动提交。
- 投递有不可变输入修订 `inputRevision`，包含规范化正文、附件清单及服务端核实的字节哈希；规范化版本、读取器版本也是指纹组成。CRLF转LF，保留段落/表格结构，不折叠有意义空白；完整性哈希针对原始字节，不能用规范化哈希替代。
- 整理任务 `taskId` 引用该修订。调用、处理块、草稿和发布独立建模；`generation` 是单调运行代号，每次停止/恢复/重建增加，用于拒绝迟到写入，不是租约。
- 处理块键包含输入哈希、来源范围、解析/提示/结构/模型版本；只有已校验完成的付费结果可复用。保留少量结果与来源引用，不借此保留完整提取正文。合并块还必须绑定上游块哈希集合。
- 每账号一个未完成任务：queued/running/applying/paused/interrupted/error/conflict 占账号槽；cancelled/done/partial/purged 释放。用户可先放弃旧任务再开新任务。输入写锁仅由 queued/running/applying 占用；暂停后编辑使原任务修订失效，继续须建立新任务并核对可复用块。
- 排队、停止、发布均在相应数据库事务中检查 taskId/generation/inputRevision/删除水位；调用完成后的费用结算独立于内容发布，不因停止免除已发生供应商费用。

## 完整状态机

状态机未列出的转换返回409 `INVALID_TASK_TRANSITION`。重复同一操作编号返回第一次结果。终态不得被迟到响应转换回运行；purged 只保留最小去重/安全元数据。

| 当前状态 | 允许下一状态 | 触发与保留规则 |
| --- | --- | --- |
| queued | running / paused / cancelled / interrupted / conflict / purged | 调度/维护暂停/停止；恢复前重新验权和验修订 |
| running | applying / paused / cancelled / interrupted / error / conflict / purged | 全部块完成后发布；额度/资源不足暂停；故障保留有效块 |
| applying | done / partial / conflict / interrupted / cancelled / purged | 原子发布提交前可停止；提交已完成则返回已发布，不伪称取消成功 |
| paused | queued / applying / cancelled / conflict / purged | 主动继续；或收下有效部分；不得预算恢复后自动消费 |
| interrupted | queued / applying / cancelled / conflict / purged | 重启/未知费用核对后用户继续；禁止自动重发不明调用 |
| error | queued / applying / cancelled / conflict / purged | 可恢复错误手动继续，修订不变；否则新任务 |
| conflict | applying / cancelled / purged | 仅在原输入修订与目标当前版本重新核对一致后收下，否则先放弃再新建 |
| cancelled | queued / purged | 材料未变可手动继续、原子重获账号槽；展示草稿重建，复用有效付费块 |
| done | purged | 已完整发布，不重新生成或删除已收下结果 |
| partial | purged | 已收下部分；剩余范围用关联新任务，不重复发布已收下事项 |
| purged | 无 | 永不因旧客户端、备份或迟到响应复活 |

`pauseReason` 与状态分开：personal_budget/site_budget/unknown_cost/resource/maintenance/execution_limit/provider。保留机器码和不含原文的原因。partial 是“用户收下有效部分”的终态，`partial` 读取状态本身不自动表示已收下。

运行时子阶段 `reading/recognizing/organizing/merging/publishing` 仅影响展示，不新增隐式任务状态。处理块 `pending/running/completed/failed/discarded`，与读取四态、调用费用状态分离。停止时未完成块变 discarded，未发布展示草稿清除；completed 仅在结果/来源校验成功后落盘。已经提交的发布按 publicationId 幂等保留。

### 旧状态迁移和重启

| 旧 sync_jobs.state | 新状态 | 迁移处理 |
| --- | --- | --- |
| queued | interrupted | 无新用户确认不在迁移后发费用；解除输入占位 |
| running | interrupted | 旧费用视为未知，不自动重发 |
| applying | conflict | 保留旧付费输出作为待核对结果，不自动二次发布 |
| done | done | 保留已有事项、排序、发布归属；不从缺失output重新生成 |
| error | error | 原文保留，手动核对后继续 |
| conflict | conflict | 保留已有输出与原因 |
| interrupted | interrupted | 保留人工恢复语义 |

未知旧状态阻止迁移。正常新版本重启时 queued 可继续排队（输入未变且预算许可）；running→interrupted，applying 先查 publicationId：已提交→done/partial，未提交→interrupted。增加generation，清理运行占位，不自动消费 interrupted。

### 停止、恢复、发布

1. 停止事务先增加generation、记录cancelled、释放输入/账号占位、移除未发布草稿；调度不再领后续块，尽力 abort 在途请求。响应只有运行代号匹配且状态running/applying时能保存新块/发布；不匹配仅允许幂等费用结算。
2. 继续重新校验账号/设备、原件哈希、保留期限、块依赖和余额。缺原件返回 `REUPLOAD_REQUIRED`，重传后逐件核对；禁止从日志或任务正文找回完整提取材料。
3. 没改材料则复用已完成有效块；改了材料则新taskId，只复用核对仍有效的块。新任务不重置累计预算、安全检查点或未知费用风险。
4. 正常完成在一次租户事务中插入publication和事项、记录覆盖并改变任务终态；异常的“收下部分”也使用相同流程，记录未处理范围。发布唯一键 `(taskId, blockId, itemKey)` 防重。新任务完成剩余范围时显式排除已发布键。
5. 只读预览不会进入世界/DDL。停止不删除之前已经收下的事项；删除原件与删除投递是不同操作。删除正在处理原件须请求带 `stopTask=true`，否则409确认所需，不能静默删除。

## 读取覆盖与模型输出

每个附件返回 `{attachmentId, contentHash, state, covered, uncovered, reasons}`。每段范围含 `sourceId`、文件名、页码/工作表/表格行列/压缩内部路径、区间坐标。范围应能核对覆盖，不能仅写“已处理”。

| state | 定义 | 模型处理 |
| --- | --- | --- |
| read | 支持且所有范围已读取 | 正常分块 |
| partial | 部分已读，剩余范围/原因明确 | 自动整理可读部分；最终完整性提示 |
| unsupported | DOC/XLS、音视频、加密、嵌套压缩等未支持 | 允许按原件模式保存，不伪造来源 |
| failed | 支持格式读取失败或安全隔离 | 隔离该文件，其他文件继续 |

全部附件和正文均无可读内容时422 `NO_READABLE_MATERIAL`，不得调用模型。空白文件与文件损坏区别列出；扫描页逐批读取，不设总页数硬顶；120,000字符是窗口，超出继续分段。模型仅接收材料与范围，不允许工具/外链执行；返回JSON结构、字段/数量/字节上限及sourceId/范围均验证。不存在的来源导致块失败，不直接写事项。引用每项最多500字符、每附件累计最多2,000字符，不能用很多小引用拼回全文；引用不足以承载全文时缩短为定位符。

## 接口表

路径前缀 `/api/v4`；JSON `contractVersion:1`。以下是最小必要字段，编号最长120字符，路径名不能映射文件系统；请求/响应均限制大小。普通用户接口不接受userId。路由权限在解析/排队之前校验。

| 方法与路径 | 请求 / 返回 | 幂等与条件 |
| --- | --- | --- |
| GET /capabilities | contractVersion、features、limits、authRequired、serverTime、timezone | 不泄露其他租户数据 |
| POST /auth/register | invite、username、password、platform、deviceName，以及Windows公钥或微信一次性code → account/binding/session | operationId；邀请码只成功消费一次；事务内10账号上限；微信code由服务端验证，不信客户端openid |
| POST /auth/login | username、password、platform，以及Windows公钥或微信绑定code → session或设备列表 | 已验密码才展示本账号槽位；不得自动替换；已绑定微信可走下行身份恢复 |
| POST /auth/replace-device | 短期登录凭证、replaceBindingId、新公钥、operationId | 同账号事务撤旧绑新，满3槽下并发仅一次成功 |
| POST /auth/wechat | 一次性wx.login code、已有绑定/账号绑定短期凭证 | 服务端验证openid；不同微信不替换；重装恢复同一身份 |
| POST /auth/claim-legacy | 旧有效设备签名/微信凭证、username、password | 只补凭据，不重建账号/租户/额度；无人可登录走审计恢复 |
| POST /auth/password | oldPassword、newPassword、revokeAll、operationId | 改密、撤销和安全事件一致；不把密码写日志 |
| GET /devices；POST /devices/:id/revoke | 名称/类型/活跃时间；operationId | 用户只撤本账号；撤销会话立即失效，保留本地副本 |
| POST /submissions | submissionId、inputRevision、text、manifest、storageIntent | 原子决定整次retained/temporary；相同编号不同正文409 |
| PUT /submissions/:id/files/:fileId | 原始字节、完整性哈希 | 流式10MiB、总20MiB、20件；重试不重复占额；临时目录隔离 |
| POST /submissions/:id/commit | operationId、manifestHash、baseVersion | 全部文件完整/归属正确才排队；未上传完只留本机与上传状态 |
| GET /tasks/:id | 状态、阶段、generation、覆盖/未处理清单、可执行动作、费用摘要 | 长轮询/重试无模型费用；查询不进AI队列 |
| POST /tasks/:id/stop；/continue；/accept-partial | operationId、expectedGeneration、expectedRevision | 重验状态与归属；继续需用户主动，发布事务CAS |
| GET /storage；GET /originals/:id | 占用/状态/期限列表；下载原件 | 读取/下载逐个验权，不返回宿主路径 |
| POST /originals/renew；/delete | ids、operationId、expectedVersions、stopTask | 批量结果逐项；满额可续已有文件；清除全文/转图/未发布缓存 |
| POST /packets/:id/trash；/restore；/purge | operationId、expectedVersion、stopTask | 回收7天；删除优先，purge写安全水位 |
| GET /wallet | granted/spent/available、lowBalance、pausedReason | 人民币整数微元，用户主要显示已消费；不暴露别的账号 |

管理路由另有回环监听 `/admin/v1`，不挂在上述公网router。独立会话、HttpOnly/SameSite、CSRF/来源、过期和敏感确认；金额追加/暂停/设备重置/任务动作以operationId幂等并审计。只提供统计、元数据及错误码；**不提供用户正文、原件下载或导出接口**；安全审计不提供删除API。CLI保留同样验权/审计。E 实现。

### 错误及双端降级

错误 `{error, code, retryable, action, operationId}`；error为安全文案，不含正文/凭证/上游原始错误。401统一认证失败（不存在/密码错不区分）；403无权；409 INPUT_LOCKED / TASK_SLOT_FULL / INPUT_CHANGED / IDEMPOTENCY_CONFLICT / DEVICE_SLOTS_FULL / CONFIRM_STOP_REQUIRED；413 UPLOAD_LIMIT；422 NO_READABLE_MATERIAL / INVALID_MODEL_OUTPUT；426 CLIENT_UPGRADE_REQUIRED；429 QUEUE_FULL / LOGIN_RATE_LIMIT；503 PERSONAL_BUDGET / SITE_BUDGET / UNKNOWN_COST / MAINTENANCE。

Windows与小程序先读capabilities。新服务对旧v3的新增整理/账号变更写入返回426，原有同步/下载保持兼容但所有入口统一执行输入锁、删除水位和字段白名单，不能留v3旁路。旧客户端不能理解partial/cancelled时提供安全error兼容投影及明确升级文案，绝不能投影为done。保留未知字段，不允许整份旧快照擦除新覆盖/期限字段。D 必须更新旧客户端错误显示，否则保持新功能关闭。

离线编辑保留本地未同步队列；收到INPUT_LOCKED不能丢弃。锁释放后先同步新版本、核对冲突，再提交修改。同字段按服务器抵达序列决定，不采用设备时钟；不同字段合并，保留覆盖历史；删除/清除水位优先。用户切账号不把旧离线队列送入新账号。

受控开发入口已核实：Windows `desktop/main.cjs` 仅在 `!app.isPackaged` 且同时设置绝对隔离 `SHIXU_DATA_DIR` / `SHIXU_TEST_SERVICE_ORIGIN` 时覆盖正式地址；小程序 `lib/transport.js` 仅develop允许回环HTTP。D 增加打包/非develop拒绝绕过的回归。备案前仅这些入口加SSH隧道，模拟器不代替手机/安装版公网验收。
