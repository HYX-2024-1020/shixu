# 读取窗口独立凭据与回退审计

2026-11-01，Refs #73/#69；固定方案 da28c1f、A aad1903。本增量是开发实现验证，B/C/D仍有实施缺口，完整独立整体验收另行执行。

## 已复现与修复

19页合成PDF仅读取前8页后，把租户游标改为结束且移除pending，旧实现错误发布done；普通文字付费块篡改、部分收下时任务覆盖摘要篡改也曾被接受。新增测试分别先观察到错误done/未抛错，再修复。

独立账本现在保存账号/根/任务/修订/附件hash锚点、游标前后hash、覆盖摘要前后hash及提交确认，全部追加且禁止改删。消费前检查整个根的历史任务；发布及事务提交前再次核对。诊断性readRetries不参与hash，其他来源/覆盖/进度不得篡改。读取失败后未提交观察允许由实际解析器结果显式追加supersedes，已确认进度回退不允许重放。

租户写入与独立凭据采用先意图、再投影、再确认；跨库崩溃可重放尚未确认的精确状态，不重复收费。所有普通付费块发布/复用也必须匹配独立结果凭据；缺失已认证块不得重新付费。费用、水位、累计调用和时间不清零，清除或新taskId不能清除已观察到的窗口门禁。

## 维护与迁移边界

宿主内部ReadingWindowMaintenance需要独立authorize与同步最终verify，没有公开HTTP覆盖接口。只能恢复与独立hash精确一致的游标/覆盖；有锚点但从未提交游标的情况只能回到空状态。purged任务不能恢复游标或原件。维护收据、投影和最终解锁分阶段幂等，校验generation/账本序列/水位/完整快照，账号内任何sent/unknown或运行中任务阻止核对；修复了时间维护quiescent查询遗漏account绑定的问题。

维护仅清理本窗口门禁，不能清unknown/时间等其他门禁。成功后仍暂停，旧创建/继续收据失效，双端刷新后用户主动继续。外部真实维护证据源仍需接线，合成最终验证器不代表生产运维能力。

新增schema.mjs提供独立账本组件版本迁移：连续版本、精确SQL SHA256、事务DDL和不可改删历史，未知未来/历史SQL改变/缺失保护触发器/窗口表结构变更失败关闭。本批只迁移window-safety组件1，绝非全服务/多库正式迁移完成；不对真实资料操作。reader版本追加window-state/1，旧未完成输入不得自动补签可信记录，显式重新发起仍保留同根累计。

## 开发验证

- Windows Node读取全回归403项通过；随后新增首窗空状态恢复与迁移触发器专项15项通过。核心97、同步125、桌面无窗口18、独立发布包/PR策略10项通过；build、mini:check及官方WXML/WXSS无窗口编译通过。
- 实际AccountWorkspace与实际Page生命周期/Node wx签名HTTP两条19页PDF链：temporary与deleted核验、停止/迟到响应丢弃、游标回退双端同提示且禁止继续/部分收下、受信精确恢复、旧继续拒绝、新主动继续、原3个付费窗口全部复用，无额外费用。
- 独立Linux只读树`/opt/shixu-bcd-test-20261101-window-state`，nobody内核/双端16项通过；随后新增迁移/空状态检查15项也通过。受保护broker以nobody实际执行两链，daemon UID被拒。详见[机器证据](evidence/window-safety-linux.json)。两链各4次模拟调用80微元，真实API零次；schema checksum、窗口收据6/观察6/最终审计1均独立读取核验。
- 独立发布包实际读取19页、消费、篡改旧任务游标、创建新任务被拦截、精确恢复与审计后保持暂停；没有从源checkout补加载实现模块。

本增量无真实API、无重复本机UI、无生产/真实迁移/安装。费用历史仍为接续累计24次usage估算¥0.045774，非供应商最终账单。原生微信/手机/安装版、全域账号/删除/撤销回放、完整安全状态及所有库迁移、真实账单/宿主证据均未据此宣称通过。CI以本批最终头PR评论为准。

复现：`node --test server/reading/window-safety.test.mjs server/reading/window-safety-clients.test.mjs`；`node --test deploy/sync/release.test.mjs`；Linux受保护联调`node scripts/reading-window-safety-linux.mjs /opt/shixu-bcd-test-20261101-window-state`仅适用预备好的自有合成树/runtime，不能指向生产。
