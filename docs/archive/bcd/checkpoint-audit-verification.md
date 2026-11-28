# 根调用检查点审计恢复开发验证

2026-10-31，实施#73/跟踪#69，Draft#74。持续补齐C及双端恢复，不是最终B/C/D整体验收。

## 行为

新增受信宿主`checkpointMaintenanceReview` / `reconcileRootCheckpoint`原语，处理历史`CHECKPOINT_RECONCILIATION`和24调用无进度`CHECKPOINT_NO_PROGRESS`。必须同时具备操作鉴权和独立最终证据验证器；没有公共HTTP维护路由，客户端传actor/evidence不能自授权限。证据绑定账号、根、generation、水位、账本序列、原始任务/检查点/进度hash快照、原因及唯一reference，并明确准许`resume-next-checkpoint`。这是一项需核对的人工维护决定，不伪造成功块或宣称历史每个区间正常。

独立账本只追加不可改删审计收据、目标投影及最终完成记录；先保存收据，再精确投影租户原因，最后追加安全水位解除。中断只能用相同操作和精确前后快照接续，未最终完成不解锁。保留全部调用、消费、时间、有效块和历史检查点；以审计时调用数/有效块数作为下一24调用区间的独立基线，无进度再次暂停。已结算消费不返还，不清零计数。未知费用、未终止executor、未知时间、回退/缺失安全记录及其他门禁不能用本操作解除。

两端刷新看到“调用检查点已核对…请主动继续”；已有继续intent及新建任务请求分别绑定维护收据/账号恢复nonce，旧请求不能借核对自动消费。审核本身零模型调用，刷新不排队；手动新动作重新校验原件/修订/账号槽/费用/时限，temporary和deleted墓碑不复活。新的维护入口只供受控宿主集成，E管理界面与真实维护证据源仍未接线。

## 开发验证

```sh
node --test server/reading/checkpoint-maintenance.test.mjs server/reading/checkpoint-clients.test.mjs
node --test server/reading/tasks.test.mjs server/reading/ledger.test.mjs server/reading/maintenance.test.mjs server/reading/cost-maintenance.test.mjs deploy/sync/release.test.mjs
npm run test:sync
```

审计专项8项：两种原因、历史和累计保留、旧继续/新建请求拒绝、48次重新暂停、历史已有进度不能被误算为新进度、鉴权/坏证据/异步证据/过期水位/账本变化、未知费用、收据后中断/改变投影、orphan执行和回退拒绝。双端2项经实际Windows AccountWorkspace与实际Page/Node wx签名HTTP，19页PDF的temporary和deleted链验证无自动调用、旧intent双端拒绝、主动继续、来源/尾部/结果一致。为避免重复23次供应商模拟执行，显式注入23条合成sent/settled账本记录；与实际模拟provider调用数分开，不当作真实API证据。

[开发证据](evidence/checkpoint-audit.json)：Windows相关83项通过，新增历史进度基线回归后根任务/审计80项通过；核心97项、同步125项、build、mini:check和PR策略检查通过。自包含发布包包含新模块并独立启动。Linux独立只读`/opt/shixu-bcd-test-20261031-webp`、普通UID nobody专项8+双端2项通过；未安装宿主包或改生产。官方小程序编译沿未变界面上一批结果，无新增本机UI窗口；原生微信/手机/安装版未验。新头必需CI另核对。

同时修复WebP首次CI构建的AVX2分派链接错误：构建器显式固定`-march=x86-64 -mtune=generic`通用基线，不依赖构建宿主扩展。Windows/Linux重建及像素专项通过，原生二进制hash与原测量相同；[新Windows构建清单](evidence/webp-portable-windows-build.json)。74b07e6的Core checks失败记录保留，不能使用该头的其他绿灯宣称全通过。

本批真实API零调用，接续累计仍13次、usage估算¥0.024188。回滚可停AI/停受控入口，必须保留独立审计/水位/账本及墓碑；退回不识别新收据的软件不具有安全恢复许可。扫描PDF、Office视觉、solid/大材料流式、历史投递关联AI、真实外部证据/全域安全回放与正式迁移等继续实施，B/C/D仍未全部完成。
