# B/C/D 第一增量验证

2026-10-28（北京时间），Issue [#73](https://github.com/HYX-2024-1020/shixu/issues/73)，分支 feat/bcd-attachment-loop，起点aad1903。

**交付的是TXT/CSV读取与任务内核、双端覆盖展示；B/C/D整体未完成。新内核没有接入生产v3路由，没有开启AI或执行生产迁移。**

本文保留第一增量历史。后续受控 v4、实际 Windows SSH/Electron 任务操作、长结果分页、24 调用检查点及费用核对的最新状态见 [后续增量验证](v4-verification.md)，不能以本页旧待办覆盖后续代码，也不能以新测试宣称整体完成。

## 实现与实际边界

server/reading包含原字节/hash校验、UTF-8/CSV四态、连续Unicode范围和CSV行列、分块、Linux隔离、独立累计账本、轮转、输入写锁、停止generation屏障、已结算块复用、结果信封恢复和原子发布。每步最多一次模型调用后让出；正文只在内存，步间缓存最多30秒，停止/暂停/结束清理。没有新增第三方包，样本全部合成。

Windows材料面板和小程序事项详情共用shared/reading-view.mjs，显示四态、缺失范围、来源位置；服务端覆盖字段禁止设备篡改，相同字段可随旧快照同步。组件显示不代表新账号或任务操作已经接线。

独立Linux测试目录/opt/shixu-bcd-test-20261028，短期输入/run/shixu-bcd-test-20261028，合成库/账号/动态回环端口。Node24.20.0、systemd255、内核6.8、1740MiB/无swap。未读取生产账号、原件、数据库或备份，未改8788服务、release指针、配置或AI开关。

[隔离报告](evidence/isolation.json)：动态非root UID、空有效capabilities、NoNewPrivileges、仅PATH/LANG环境；联网、宿主/其他任务/符号链接逃逸、输入/代码写入均失败。scratch写至268435456字节后ENOSPC，内存超限约1.00秒终止，2秒墙钟探针约2.12秒终止，58次EAGAIN。broker被SIGKILL后systemd仍清除输入。CPUQuota=50%已由单元接受，但尚未独立测配额误差或穷举syscall攻击。

最小RootDirectory只复制Node/env及ldd动态库；无/etc、服务配置或模型key。依据[systemd执行环境](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)及[资源控制](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)，以本机255实测为准。生产普通账号到受保护broker的权限代理尚未部署，不能赋予主应用任意sudo/systemd-run权限；生产必须单broker全局串行解析。

复现：把本分支源码放入新独立目录，创建root所有0700的同名/run目录，运行scripts/reading-prepare-runtime.py（仅首次建立新runtime），再运行reading-linux-check.mjs、reading-benchmark.mjs、reading-loop-linux.mjs，参数均为/opt/shixu-bcd-test-YYYYMMDD。测试启动单元需要root，worker非root；不安装宿主软件包。

## 性能与质量

固定6份样本各5次，P95用最近秩法，仅用于定位/回归，不是容量SLO。[初版](evidence/baseline.json)、[首次优化](evidence/optimized-initial.json)、[最终测量](evidence/performance-final.json)。计时同时检查独立原文golden、连续范围、CSV末行及单元格/列关系。

| 样本/字节      | 初版隔离P50/P95 ms | 最终P50/P95 ms | 最终峰值RSS KiB |
| -------------- | -----------------: | -------------: | --------------: |
| 小文/6800      |            172/189 |        190/259 |           52804 |
| 中文/294000    |            185/228 |        166/181 |           61904 |
| 长文/7980021   |            749/782 |        678/746 |          103108 |
| 多行CSV/270021 |            486/542 |        286/358 |           65652 |
| 密集CSV/100000 |          2323/2388 |        394/417 |           66692 |
| 损坏尾部/15    |            154/188 |        155/187 |           49352 |

瓶颈是每行独立来源导致对象/JSON/传输膨胀。改为最多128连续行分组，保留完整CSV原文、行范围和列数游程，来源数10001→79、100000→782；覆盖字符及行列关系不变。新增2048行交替列数/引号内换行回归。没有降低隔离或漏读换速度。

小文P95升到259ms，仍有启动/调度波动，未宣称全面提速。最终RSS在序列化/管道传输后采样，早期仅在解析后采样，不能直接比较成内存优化比例。最终另列解析、传输、输入临时字节；TXT/CSV scratch=0，安全探针写满256MiB另计。长文吞吐约11.11MiB/s，密集CSV约0.249MiB/s。以后以小文P95<300ms、约8MB长文<1秒、两种CSV<500ms作为观测回归起点，不伪称事先承诺或B整体验收SLO。

[Linux联合内核](evidence/loop.json)：1,060,033字节，上传50.94ms、隔离249.86ms（解析86.01、序列化/传输15.72）；5次模拟模型、原子发布、两个逻辑HTTP客户端同步一致，总计606.44ms。只解析一次，尾部唯一标记进入批次；26次并行查询P95=45.90ms。模拟账本100微元不是供应商费用，这不证明模型语义或双端实际UI联调完成。

## 实际检查

新内核24项通过，Linux前一版21项通过；新增空白材料、显式授权配置和畸形覆盖降级回归在Windows通过，最终CI另核对。覆盖原件/四态/长文/CSV、累计/在途/跨日unknown、两连接预留、幂等、轮转、停止迟到、输入变化、空白、发布回滚、信封恢复、伪造来源。

提交后复核补强：构造任务内核必须提供显式设备授权回调；未知/损坏覆盖及prototype名称不导致双端崩溃或假成功；同一执行窗口复用已适配模型片段，避免每块重复切分全文。相关内核/小程序28项、TypeScript/构建及Windows覆盖专项通过，最终远端CI按最新提交重新执行。

核心93、原同步/小程序122、个人服务1、桌面数据18、浏览器全套92通过；新增小程序详情投影回归另通过，14生成文件一致，TypeScript/网页/桌面构建通过。17套Electron源码UI通过，新desktop-reading-smoke.mjs另实际验证隔离profile的IPC保存、重载及覆盖显示。官方wcc/wcsc编译/模板渲染通过；首次缺WECHAT_COMPILER_DIR，定位已安装官方编译器后通过，未改IDE设置/活动工程，不等于模拟器完整操作或真机。门禁8项通过，新模块与新Windows专项加入CI。最终文档/diff/远端结果在PR记录。

## 未完成，不能勾选B/C/D

- B：图片、DOCX/XLSX、PDF/扫描长PDF、ZIP/RAR/7z尚未接入本隔离内核。旧客户端解析不是服务端支持。需受限转换、混合失败/恶意/极端边界、来源分页及全局容量验证。
- C：生产迁移/v4兼容、所有AI共账、供应商适配、完整24调用检查点/root关联、安全重试、accept-partial/purge、跨块语义合并去重、多账号接线尚未完成。长结果/覆盖超旧800KB同步包须分页，不能剪掉；完整关闭排空/账本核对待补。
- D：一次性注册/密码、3+1设备及旧账号claim、500MiB逻辑空间、整次temporary、30+7续存/清理、7天投递回收站、本地副本、任务操作/额度及离线锁交互尚未接线。
- 生产启用前核对删除/到期/停止/异常/备份全部路径；短期正文不能长期留存。已完成块引用每项500/每附件累计2000字符后保留定位；真实语义和跨块依据待验证。
- 本任务真实新增费用0元，不等于本轮累计0元。跨任务10元批次既往支出待可靠核对；调用前须查官方能力/人民币价格/请求上界并冻结快照，不能用合成费率启用。未发供应商请求。
- 无生产升级、私人资料迁移、安装版/手机/公网发布。E/F独立跟踪，#69 B/C/D未勾选。撤销本分支回退源码，不把合成fixture回退用于真实消费/删除/撤销后的资料。

宿主权限复核：/run staging仅root可遍历（0700），单次输入目录0700、文件0400，由systemd交给动态worker身份；实测inputUid与worker UID同为63350，宿主nobody UID65534无法遍历staging。权限收紧后四份读取、边界/内存/进程/超时及broker被杀清理重新通过；现有服务未改。
