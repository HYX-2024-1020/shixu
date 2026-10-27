# 阶段 A2：结构、迁移与恢复设计

依据 [阶段 A](README.md) 和 [契约](contracts.md)。金额统一整数微元（1元=1,000,000微元），使用安全整数/SQLite INTEGER，禁止浮点余额。时间为UTC毫秒；日预算键由 Asia/Shanghai 的日期生成，不用UTC日期截取。

## 结构与不变量

| 数据库 | 表/字段 | 约束与用途 |
| --- | --- | --- |
| accounts.sqlite | 原accounts/bindings、account_credentials | 保留accountId、invite_hash和旧bindingId；username_key只对ASCII英文小写化，trim后3–20字符；唯一。password_hash包含成熟scrypt算法参数/随机独立盐/散列，不存明文或可逆密码；claim_required明确旧账号未设密码 |
| accounts.sqlite | device_slots(binding_id,user_id,kind,slot,name,last_seen_at) | Windows slot=1..3，微信slot=1；有效slot唯一；历史revoked行不占槽，身份唯一索引保留。BEGIN IMMEDIATE事务验密码、分配/替换、更新binding与slot，不用先数后异步插入 |
| accounts.sqlite | migration_versions、registration_operations、login_attempts | 迁移版本/校验；一次性邀请码和注册编号；账号/IP滑动60秒各5次；连续10失败锁15分钟 |
| ledger.sqlite | wallets(user_id,granted_micros,spent_micros,reconciled) | 累计20元初始额度只以 `initial-grant:<accountId>` 事件发一次；旧账号核对前不发新额度。加额追加不清消费 |
| ledger.sqlite | calls(id,user_id,root_task_id,task_id,block_id,generation,price_snapshot,usage,reserved_micros,settled_micros,state,day) | planned/reserved/sent/settled/unknown/released；唯一callId；识别/整理/合并/重试同样记账；安全重试也新callId、关联前次 |
| ledger.sqlite | ledger_events(seq,operation_key,kind,user_id,call_id,amount,payload_hash) | 只追加、唯一操作键、单调seq；wallet/call是事务内投影，恢复可核对。已结算call重复返回不重复扣费 |
| safety.sqlite | safety_events(seq,operation_key,kind,account_id,object_id,revision,at) | 删除/到期/撤销/改密/注册/迁移切换等最小事件，不含原文；不随资料回滚；单调水位与清单哈希 |
| tenant.sqlite | 原sync_records/blobs/attachments、task_v4 | 保留资料和去重；task含submissionId、inputRevision、generation、state、pauseReason、activeMs、rootTaskId。每账号槽由账号调度器原子占用；租户内任务发布原子 |
| tenant.sqlite | blocks、publications、coverage | block指纹、范围、少量有效结果与校验状态；publication唯一发布项；coverage保留已处理/未处理清单，不存完整提取材料 |
| tenant.sqlite | original_retention、submission_storage | expires_at、cleanup_at、state、renewal_version、logical_bytes、storage_mode；quota预留按整次manifest决定，不按blob物理去重减少用户逻辑占用 |

A 的 `scripts/stage-a/` SQL是上述关键约束的**可执行草案子集**，包含钱包、不可变价格、calls、只追加事件与槽位约束，验证迁移可行性；login_attempts、实际调用结算、用户路由、调度、解析与清理执行器在C/D/E落地。禁止把草案导入运行服务即声称完成这些功能。所有迁移来的历史任务 `eligible=0`，旧账号可能同时有多个历史中断/错误任务；C/D必须先核对归档、用户选择继续其中一个并原子获槽，不能把这些历史记录都当并行未完成任务启动。

密码散列起步配置为[Node内置scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)（N=32768、r=8、p=1、随机16字节盐、64字节输出、maxmem=64MiB），保存算法与参数用于未来升级；密码按原值校验不trim/大小写折叠，8–128个Unicode码点、UTF-8不超过1,024字节，防散列输入滥用。账号名只trim和ASCII英文字母大小写折叠，不对中文等做隐式兼容归一；拒绝控制字符，长度按码点计算。D必须实测散列耗时、同值不同盐与统一错误时序，不通过则降低登录并发而不静默降低散列强度。

登录限流采取双计数：所有登录尝试计账号规范键和可信来源IP滑动窗口，只有实际校验失败计连续失败；成功清本账号连续失败，不清IP窗口。账号键在不存在时同样记录/返回统一错误；IP仅接受受信反代传递，不能信任任意X-Forwarded-For。锁定不会因锁定期间请求持续延长，15分钟后允许重试；避免攻击者不断延长他人锁。未知账号采用等成本假散列校验；不记录密码或原始code。D对恶意锁定和并发登录验证，A不冒称已有防护。

## 账本流程

1. 请求前，单ledger事务检查账户可用额、当日站点额度、全站未知风险、该任务在途预留（≤2元）及验证批次额度，插入call和reserve事件。账号每日不重置；换设备/重装/新任务不发新额度。新日只恢复全站当日额度。
2. 预留按冻结价格快照的请求最坏token/图像上界核算；价格、计费模型、币种及人民币来源/汇率版本、峰谷规则和取整规则随call保存。每类token分开整数向上取整。使用最坏非缓存/峰值价预留，实际usage含缓存命中时退差额；响应缺必要usage字段不得猜测为0。价格不可靠则不发请求。
3. 当前官方图像输入为 [Flash](https://api-docs.deepseek.com/guides/vision/)，[价格页](https://api-docs.deepseek.com/quick_start/pricing/)以每百万token列价、含峰谷和版本差异。此处不把美元数值伪装成人民币费率；B/C再核对中文人民币账单/换算依据与实际模型，冻结可审计快照后才启用。
4. 有有效usage：callId原子settle，退预留差额、增加用户实际估算消费。实际>预留视为计价/上限故障，记录真实估算和风险差额，暂停新增AI以核对，不舍弃费用或让余额无声超卖。
5. 已发出却无usage/网络状态未知：用户不扣余额，撤销其用户预留投影，站点保留unknown风险；该账号对应任务暂停核对，不自动重发。跨日仍将所有未核对旧unknown从新日可用容量扣除，不能在零点释放风险。确认未计费才release，有可信usage再settle；管理员核对留依据摘要/审计，不填个人原文。
6. 每24次供应商调用检查累计计数/费用、已覆盖新增范围、重复失败和资源；正常继续，不是总24次硬顶。计数绑定rootTaskId，停止/恢复不清零。安全短暂故障最多重试2次；unknown不走重试。单次输入/输出上限不冒充整份材料大小限制。
7. 个人余额<3元提醒；个人额度不足与站点日额度不足分开提示。预计不足先解释可部分处理，用户继续才按可负担范围运行。耗尽保留进度，管理员加额或零点后须用户继续，不自动消费。全部AI功能共用该账本。
8. 测试批次 `stage-a-to-f-2026-10-28` 单独累计10元，跨任务累计spent+reserved+unknown，不随本地干跑重置；开始真实调用前核对旧任务消费。A不调用真实模型。

运行时不以跨WAL库事务协调任务与账本。C使用唯一callId及持久意图记录：ledger预留→tenant记录对应块→ledger标sent并落盘→发请求；只有同时存在匹配generation/修订的块与预留才能发送。各步幂等，服务重启按记录核对，不靠内存锁推断是否计费。

| 中断位置 | 恢复规则 |
| --- | --- |
| reserved，尚未sent | 先核对tenant意图；确定从未发出才释放或重新排队，不丢预留 |
| sent之后，无可信usage | unknown风险保留，任务interrupted，不自动重发 |
| usage已结算，块未保存 | 消费不回滚，保留callId与可恢复响应；若响应不可恢复则列失败，不假装有结果 |
| 有校验块，未发布 | 用户可继续或收下部分；核对费用状态，不再次收费生成同块 |
| 发布事务已提交，客户端未收到 | publicationId查询返回同一事项，不重新发布 |

为了降低“已结算但块丢失”，将校验后的最小结构化结果先持久保存在独立结果信封（含callId/哈希/来源坐标、无完整输入），再幂等结算及提交块，确认后回收信封；原件清除要同步清理其中过量引用。信封不保存供应商完整原始响应或完整提取正文。C需故障注入逐步验证，本阶段仅定契约。

## 迁移次序与兼容

1. 新服务初始AI关闭，拒绝新上传/账号变更/任务，保存进度；30秒有限等待在途步骤，超时标unknown/interrupted，禁止重复调用。停止所有写者与旧进程，核对schema、完整性、外键、磁盘/备份空间与版本清单。
2. 同一维护窗口备份注册表、所有租户、旧ai_usage和安全/账本；关闭连接/检查点后复制一致文件集合，记录hash、水位、schema、版本与账号映射。不得只复制活跃WAL主文件。临时原件空间不在备份根，不纳入任何持久数据库正文。
3. 合成演练使用当前 `AccountRegistry`/`SyncStore`/附件/任务模块生成旧结构；复制后附加tenant、独立ledger/safety库，离线切换DELETE journal、FULL同步，单事务执行草案DDL/投影。SQLite [ATTACH原子性](https://www.sqlite.org/lang_attach.html)及[WAL限制](https://www.sqlite.org/wal.html)说明多WAL库不能当整体原子提交；生产迁移需同样停写并有切换清单，不能照抄在线ATTACH。
4. 账号凭据新增claim_required，不造默认密码。旧有效bindings顺序映射slot1，保持id、公钥、撤销状态和身份唯一性。消费无法从旧预留推导，原样导入 legacy_unknown；reconciled=false，额度不重复发。旧generate会预建accounts，20个邀请记录不等于20个已注册用户；用已使用邀请/历史绑定/核实记录分类。未消费旧邀请也不得被直接当新账号再次领取，注册须合并到原accountId并检查10个实际注册账号上限；若已有实际用户超限，停止新增注册并记管理员核对，不擅自停用或删去原账号。
5. 旧任务映射按契约；旧输出保留在旧库只作迁移期间核对，不能当作已验证v4块。旧库隔离只读、跟随备份7天期限；迁移上线前扫描/删除已到期原件和全提取正文，尤其sync_records.sources、sync_jobs.request/output历史副本。不能把旧副本变永久备份。
6. 本次迁移不新增删除时限：旧原件没有可信创建时间时标 `legacy_pending_notice`，不猜成已过期立即删。D首次告知/激活新原件期限后设置30+7，记录起点和依据；当前投递/单项原有30天删除规则保留至D明确启用7天投递规则，避免升级日突删旧资料。
7. dry-run逐项比对账号/binding/记录/附件哈希、游标/epoch/操作去重、全部旧任务状态和未知消费。故障注入后应无半套DDL；重复运行不重复账户、任务、额度或unknown。仅在完整性检查和适用验证成功后切换版本指针；旧二进制不能连接新写入库。
8. C/D接入时增加schema双向门禁、capabilities和旧路由写保护；A草案使用独立表，不更改旧schema标记，因此不能用于线上迁移。迁移后真实新写入前可从整个检查点回退；有新消费/删除/撤销后，只允许保持安全水位的前向修复或经验证的兼容读取版本，不把旧库全量覆盖新账本/安全库。

10租户全量迁移不能假设所有库能同时ATTACH：A脚本仅演练一份有资料租户及注册表中两个合成账号（另一账号无租户资料），没有声称10租户整体原子性。正式迁移采用停写后的新版本影子目录，每租户逐一验证并关闭；全部完成后将账号映射、每库hash/版本、水位和租户集合写完整manifest、fsync，再在同一文件系统原子替换数据版本指针。崩溃前后仅允许指向完整旧/新集合，不从混合文件启动；manifest不全则保持维护。账本/safety的权威路径独立于可回滚资料版本目录，后续不随资料指针回退。E验证10库集合中途失败和指针切换故障，不能把A的4库回滚测试代替该验收。

## 原件、删除与容量

- 原件逻辑500MiB；原件回收站/待清理仍占额。每次manifest总20MiB、20件，单件10MiB；并发上传先原子预留整次容量。容量不足则**整次**temporary，先展示且记住本次选择；不能一部分长期保存。hash相同的多个逻辑附件分别计额，物理blob可去重。
- retained保存30天，提前7天提醒；expire进入7天待清理，用户可续30天且不增加占用，满额仍允许。实际清理时间=min(原件cleanup_at, 投递永久删除时间)。投递回收7天、单项最近删除30天不同。
- temporary原件/完整提取正文/转图/完整模型输入仅在短期隔离空间，任务结束、失败、停止或暂停退出执行窗口就清理；保留有效块结果/少量引用/定位和费用。继续必须重传核对。租户task表、日志、备份、API错误均不能带这些正文；parser进程退出清理需由外部管理器保证，不依赖JS finally。
- retained清除时也清全文/转换缓存/未发布展示草稿，保留结果与少量引用。若共享blob仍有其他有效逻辑引用，仅清本投递关系；同账号已删除材料不得从另一投递自动恢复引用。云删除不删设备副本；只在本地和云端都不留原件时合并确认一次。
- 删除行/释放逻辑配额、freelist页复用、磁盘文件缩小是三件事。SQLite原件BLOB删除后空闲页可复用；D迁移在副本设置[auto_vacuum=INCREMENTAL](https://www.sqlite.org/pragma.html#pragma_auto_vacuum)后用VACUUM重建，核对最低2倍数据库额外空间，维护时小批incremental_vacuum、监测page_count/freelist_count/WAL/db体积与真实磁盘；空间不足不强行VACUUM。未启用时只能计划停写重建，不谎称DELETE已缩库。
- 临时材料从不进入持久库；retained删除后的数据库旧页/WAL/历史备份可能仍有残留，因此隐私告知包含备份最多7天剩余留存，不声称法证擦除。E应用层清理、页回收、备份轮换与恢复过滤分别验证。

## 备份与恢复屏障

每天北京时间04:00：维护状态→拒新任务/上传→保存块与队列→等待在途最多30秒→超时unknown并停写→一致快照→完整性/哈希/水位校验→原子发布备份清单→新成功后才轮换。目标2–5分钟，快照总维护上限5分钟；超时/失败继续保留旧成功且未过期副本，服务恢复只读/手动管理，新增上传/AI保持暂停，显示原因。不可因备份失败无限停掉所有基本功能。

只保留最近2份成功备份，每份从创建起最长7天，包括失败后剩下的最后一份也到期清理。工作副本临时目录超时清理。磁盘80%禁止新上传，日志/结果/数据库/WAL/备份/temp各统计；不得提前删未过期原件。只存服务器，不下载维护者电脑；同机毁损和约一天新增资料损失风险沿用方案。

账本和安全事件在各自独立库，除同机备份还保留受保护的单调水位清单（非绝对防篡改声明）。恢复先停服务：

1. 核对选定资料快照hash、tenant集合、注册表和旧设备映射；当前账本/safety完整性、水位不低于最新可信运行清单。可信清单缺失/回退/事件不连续、账本无法核对：AI与上传继续关闭，不用旧快照冒充完整恢复。
2. 不覆盖当前账本/safety。按快照水位后的事件重放删除/到期/撤销/改密/账号注册，过滤过期原件、撤销凭据和已清投递；新旧data epoch不同，客户端先完整重同步，旧离线写入不能复活。账号创建在快照后而资料缺失时保留其身份/消费，租户标需恢复，不重新发额度。
3. 核对publication键防二次发布，任务running/applying按重启规则转态；所有sent且无usage标unknown。确认跨库一致及余额不回退后恢复基本读写；用户主动继续AI。
4. 演练验证“较老资料+最新消费/删除/撤销”恢复不退消费、不复活；A有屏障和过滤原型测试，E仍必须运行实际服务恢复/中途失败/回退演练，F补部署环境证据。

管理台不能删除审计、安全事件或账本，不提供用户正文读取；运维每天人工检查，不创建通知渠道或提醒自动化。
