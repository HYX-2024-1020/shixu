# 整次原件与生命周期增量

2026-10-28，承接9f75a27，Issue [#73](https://github.com/HYX-2024-1020/shixu/issues/73)、总跟踪 [#69](https://github.com/HYX-2024-1020/shixu/issues/69)，仍使用 Draft PR #74。只在显式启用reading的受控v4实例接线；生产v3未升级，B/C/D均未验收。

## 决策与实现

- 整次manifest → 上传 → commit：最多20件、每件10MiB、整次20MiB，原字节长度及SHA-256逐件核对。BEGIN IMMEDIATE预留整个提交，引用、原件与提交回执在同一SQLite事务提交；丢失确认可用同一提交/操作编号重试，改清单或修订则拒绝。预留15分钟到期释放，同编号同清单可重新预留。
- 每账号独立500MiB逻辑原件空间。同哈希的两个逻辑附件各计一次；物理blob可去重。v4不再把blob纳入原有记录/任务的128MiB保护；该记录保护仍保留，不能宣称已完成全站磁盘容量管理。
- 空间不足则整次temporary，不混合保存模式。未commit原件和temporary仅存进程内存，不序列化到租户库、任务库或日志；全站共享64MiB、每账号40MiB，原件HTTP请求体同时最多2路。忙碌请求拒绝，客户端保留队列重试。上传RAM空闲15分钟清理，读取后30分钟空闲上限；停止/暂停/结束/关闭释放投递窗口，继续及部分收下先补传相同原件。重启丢失RAM，保留元数据供核对。Linux解析继续使用受保护broker与受限tmpfs，正文缓存沿用短期清理。
- 新retained原件保存30天，提前7天提醒，再留7天待清理。续期从操作日再计30+7天，满额也可续已有原件；操作编号幂等、逐件比较版本，冲突不误续/误删。分钟/访问扫描更新到期状态；37天后拒绝读取，物理清理遇活动锁暂缓至释放。删除处理中原件须明确同意停止；过期版本删除不会停止任务。共享blob在最后引用删除后移除。
- 新投递删除创建7天回收期限，过期转不可恢复tombstone并进入同步序列。单项最近删除30天沿用旧规则；启用前已有投递回收站不猜原删除时间。原有原件仅建立legacy_pending_notice元数据，不擅自开始30天倒计时，须明确续期。此兼容路径用合成库验证，不是正式迁移器。
- metadata每页100件，明确hasMore/游标，两端可继续加载；补传按当前投递附件查询，不把已移除旧附件当当前输入。清除原件保留描述和已发布事项；编辑事项不重新上传或复活已删除原件。
- 受控实例拒绝旧逐件上传旁路（426），保存schema标记。当前v3入口遇升级库拒绝启动；更早二进制不识别标记，不能直接降级启动真实库。

Windows与小程序共同显示模式、空间、到期/提醒、续期、下载和明确删除，离线禁止服务端写操作。Windows下载写入当前账号本地原件库，小程序保存到当前微信文件库，校验SHA-256/长度。云端清理不会远程擦除本机副本。

Windows原件写盘失败可用限额RAM继续，明确显示失败；小程序复制或索引失败也保留限额会话RAM，不落虚假索引。本机保存失败且云端只能temporary时，两端弹出明确选择、默认取消，说明关闭会话后的丢失风险。普通离线本机库保持原落盘失败处理。

## 检查及证据口径

`server/reading/originals.test.mjs`覆盖原字节SHA边界/完整10MiB、完整性/回滚、两SQLite连接不超卖、同hash逻辑计额、RAM重启/补传/清理、幂等/版本冲突、30+7/提醒/满额续期/共享blob、7天投递与30天单项、锁内续期/明确停止删除、101件分页及旧入口拒绝。双端Page/签名HTTP覆盖retained、temporary及Windows本地写盘失败，核对全文尾部、结果/覆盖一致、迟到屏障及删除后编辑同步。

固定样本700018原字节、中文/emoji/尾部唯一标记，每轮4次模拟调用、80微元合成费用。每模式5份独立合成账号/profile，P95最近秩法即最大值。[Windows证据](evidence/originals-windows.json)、[Linux证据](evidence/originals-linux.json)含全部样本和进程累计maxRSS。计时包括Page清单/上传/commit、Windows任务、停止/补传/继续、发布/双端一致、续期/下载/删除及fixture清理，含轮询与模拟供应商等待；解析器为进程内确定性TXT读取，不是隔离读取P95或真实模型速度，没有据此声明容量SLO或全面提速。

| 环境 | retained P50/P95 ms | temporary P50/P95 ms | 累计进程峰值RSS KiB |
| --- | ---: | ---: | ---: |
| Windows Node24.20.0 | 2137 / 2223 | 2025 / 2063 | 185596 |
| Linux Node24.20.0普通UID | 1682 / 1922 | 1488 / 1520 | 198364 |

另在 `/opt/shixu-bcd-test-20261028-originals` 使用既有Node24.20.0，普通UID经受保护socket执行真实Linux隔离联合闭环。temporary由小程序Page/Node wx适配器上传、Windows签名HTTP发任务，2次隔离解析、4次模拟调用，停止补传后尾部/结果/覆盖一致；非法UID与probe注入拒绝，退出清理输入/socket。这是一次观察，不报P95。生产shixu-sync.service只读确认active，未读生产库/原件/备份，未改配置、发布指针或8788服务。

最终隔离联合链路单次2541ms，[联合与本地检查证据](evidence/originals-validation.json)保留JSON。再次解压Windows tar后源文件模式不满足broker保护，首次复核被UNTRUSTED_BROKER_PATH拒绝；在同一独立目录恢复root所有、目录0755/文件0644后完整重跑通过，未放松broker校验。

本地检查：读取内核88、同步/小程序124、核心93、个人服务1、桌面数据18、浏览器92、独立release4、门禁8；17套既有Electron与2条新增原件UI通过。构建、15生成文件一致、67文档入口、官方小程序编译通过。最终小改动后仅复跑受影响专项，不用重复无关绿灯补样本。

复现命令：

```sh
node --test server/reading/*.test.mjs
node scripts/reading-originals-benchmark.mjs /absolute/path/originals.json
node scripts/desktop-reading-tasks-smoke.mjs --originals
node scripts/desktop-reading-tasks-smoke.mjs --temporary
# 仅独立Linux目录；root启动既有受限broker，worker为动态低权限身份
node scripts/reading-broker-linux.mjs /opt/shixu-bcd-test-YYYYMMDD-originals --originals
```

新增两条源码Electron UI检查已接Windows CI，官方WXML/WXSS编译及模板渲染单独执行。Node Page、官方编译、源码Electron和Linux隔离分别记证，不替代原生微信develop/真实微信身份/手机/安装版或公网验收。最终检查数量与远端CI见PR最新提交。

## 未完成及回滚

未新增图片/PDF/归档支持。失败/中止读取的排队时间回传、剩余活跃时间约束读取仍待补齐，根累计不等于完整计时。跨修订复用、语义合并去重、所有AI共账、真实供应商/usage与维护审计入口、安全水位、正式多库迁移/恢复防回退、多账号容量压测继续由#73/#69跟踪。

retained删除是在线SQLite引用/blob逻辑删除；WAL、空闲页、备份的物理擦除/过期与正式迁移备份策略未交付，不能称全部历史介质抹除。temporary不进入这些持久层，测试核对blob与同步正文不含临时原件全文。没有安装、发布、真实迁移或部署。跨任务10元既往费用未核清，真实新增调用0次，不能写累计支出为0。

合成目录可销毁重建，源码可revert。真实删除、消费、设备撤销后只允许前向修复，禁止恢复旧库回滚。生产启用须独立可核对迁移、备份生命周期与防回退屏障；不得拿合成fixture当生产迁移工具。
