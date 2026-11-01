# 运行核心组件正式版本迁移底层

2026-11-01，实施#73 / 总跟踪#69，PR #74保持Draft。本增量接入9个核心组件，B/C/D完整实施和独立整体验收仍未完成。

## 结构与行为

新增server/database-schema.mjs事务迁移/只读预检与database-schemas.mjs声明式历史DDL。每个组件版本必须从1连续推进，service_schema_versions追加保存SQL/写入门禁/兼容对象checksum、是否精确接纳历史结构和时间。未知未来版本、历史SQL不符、缺失表/索引/触发器、额外未声明触发器和外键损坏均拒绝，不在启动时修补结构后冒充完整。

| 数据域 | 本次组件与版本 |
| --- | --- |
| 租户 | tenant-sync 1、tenant-attachments 1、tenant-originals 1 |
| 账号 | accounts-core 1、accounts-auth 1 |
| 独立账本 | ledger-core 2、ledger-cost 1、ledger-time 1、ledger-checkpoint 1 |

ledger-core版本1精确接纳旧基础结构，版本2显式接管reading_calls_account_task索引；旧存在/不存在该索引两种情况都有声明规则。账号旧active_slot索引作为精确校验的可选兼容对象，由现有V4原子槽位迁移删除；不会在重启后重新补出单设备限制。索引/兼容对象也绑定版本checksum，不放开任意额外DDL。

reviewDatabaseSchema只读检查结构/版本/外键，返回action、当前/目标版本、schema/history/migration摘要及planHash；可把expectedPlanHash交给事务执行拒绝过期预检。摘要绑定结构和版本，不代表冻结全部用户资料；全库停写与切换另有工作。新建、精确历史接纳、显式升级和重复启动分别处理；部分旧结构不视为新库。BEGIN IMMEDIATE和嵌套SAVEPOINT配合，失败回滚DDL、数据及版本记录。内层释放仍随外层账号迁移一起回滚，依据[SQLite savepoint语义](https://www.sqlite.org/lang_savepoint.html)。

已验证组件注册连接内service_schema_writer能力；核心表INSERT/UPDATE/DELETE触发器要求匹配版本。旧程序没有此函数或只支持旧版本时拒绝写入；仅做只读review不会启用写能力。参见[Node 24.20 SQLite函数API](https://nodejs.org/download/release/v24.20.0/docs/api/sqlite.html#databasefunctionname-options-fn)与[SQLite连接级函数](https://www.sqlite.org/appfunc.html)。这用于防止旧二进制误写，不是抵抗数据库文件所有者的绝对防篡改能力。

缺失旧epoch/sequence、账号secret校验、原件版本标记或账本控制行时明确停止，不生成新默认值来抹平问题。既有未知费用、初始额度事件、原件墓碑、撤销和30+7规则不变。本次没有转换旧sync_jobs为可运行新任务，没有重复发放额度，也未操作真实用户资料。

## 开发验证

- 先复现：已有租户库缺sync_records_version索引时旧构造器静默补建；本实现拒绝并不修补。16项新专项覆盖只读预检/接纳/幂等、显式版本2/未来版本/过期预检、DDL中断、嵌套事务、缺失保护/额外触发器、外键与游标/标记丢失、冻结源hash、实际旧构造器写入拒绝；SQL比较保留引号内空格和非SQL Unicode空白，阅读组件共用该严格规则。
- 使用阶段A提交aad190373781a52454a6875426d46b2cf0c8fcd5的三份实际历史模块生成旧账号/租户/附件库，来源与SHA256见[固定夹具](../../scripts/stage-a/legacy/README.md)。新服务构造器不能再被当成旧库生成器；未给生产代码增加跳过门禁开关。
- 合成跨库演练先只读预检9组件；账号、租户、账本三个阶段分别注入中断并重复启动恢复。保留账号/绑定/撤销、两个有效槽、原件字节/记录/epoch/操作去重、legacy_pending_notice、14微元已消费、1000微元unknown风险与20000000微元初始额度，确认不会再领一次。[Windows报告](evidence/runtime-schema-windows.json)与[Linux报告](evidence/runtime-schema-linux.json)含4种演练和实际结构摘要，不含账号凭据或资料正文。
- 阅读全套451项（最后SQL比较收紧前）、同步125项、服务及新迁移专项14项（最后两个专项加入前）、最终专项16项、迁移/窗口/历史/调用关联联合54项及策略8项通过；独立发布包4项实际加载新模块与账号/任务/重启/备份恢复。前端/编译未受影响的本地矩阵未重复，远端必需CI全部照常。
- 阶段A固定草案20项及rehearse通过（旧7任务/unknown/回滚/幂等/完整性、0提供方调用）。初次跟随新模块生成的夹具导致2项旧写入测试被门禁拒绝，已冻结实际历史模块，未关闭运行保护。首轮阅读447/451：一个旧凭据错误码及账本跨模块索引归属导致4项失败；保持原凭据错误码并显式版本化索引后451通过。
- Linux独立只读源树`/opt/shixu-bcd-test-20261101-runtime-schema`，nobody UID65534，迁移/账号/账本/费用维护及实际AccountWorkspace与Page/Node wx临时/删除双链40项通过；最终共享SQL比较收紧后54项联合及最后16项专项通过，两个平台全部9个计划摘要一致。无宿主包安装/生产写入/额外窗口或真实模型调用。

提交自身六项必需CI以后续PR评论为准；旧头绿灯不代替本头检查。原生微信/手机/安装版与全BCD最终联合验收未执行。

## 仍需实施

这不是全部迁移完成：剩余任务/发布/根/复用/语义/视觉等旧表仍需正式组件化，旧ai_usage到独立账本的核对转换仍待实施；已有window/history/receipt组件版本机制保留。旧任务完整状态转换、全文副本清理、独立安全事件及账号/删除/撤销全域重放还没有完成。多WAL库不冒充整体原子事务；本次只证明核心组件事务与逐库中断后幂等恢复，未实现影子租户全集manifest、停写锁与原子版本指针切换，也没有执行10租户E/F恢复验收或生产迁移。真实最终账单与宿主证据源、其他读取/色彩/流式缺口继续。
