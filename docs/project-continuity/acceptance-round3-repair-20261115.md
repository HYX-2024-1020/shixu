# 第三轮集中整改实施记录

2026-11-15，跟踪 #125，需求见 [第三轮反馈](user-feedback-round3-20261115.md)。文档PR #124 的最终头1613d62、Verify43636150426六项必需检查成功，reviews/threads为空，squash合入4675a70；固定checkout从该主线建立fix/acceptance-round-three，workspace --start通过。

## 实施与交付边界

T01—T08全部属于本任务；当前正在诊断和实现，尚未交付。实际Windows/原管理台/原ECS仍0.3.28，包源08d38fa。保留#118/#107的用户集中验收；看板PR120/#117、官网、小程序发布及手机联验不进入。

必须保留0.3.27/0.3.28的普通卡手动编辑/删除恢复、失败材料三选一、停止及原任务主动续接、可信账本和迟到结果屏障、超限队列隔离、原件原子写入/下载续期、账号缓存隔离、共享原件引用保护、墓碑清字段；小组多归属/删组不删卡、DDL明确与推定时刻/日期区间、来源及重启持久化继续回归。图标接受现状，不继续改。

## 已取得的诊断证据

- T01：本地待传修改与云端版本并发时进入持久冲突队列，pending数不包括conflicts；保存被桌面适配器拒绝，卡片没有直达对应冲突入口。不能用盲目覆盖云端解决。
- T02：图片只有原图/适应窗口两档，PDF没有缩放；切换附件时预览状态也需隔离。
- T03：现有卡内AI只有当前卡patch、跨卡proposals及merge协议，缺少新建/拆分；不能仅删除范围控件。
- T04：新合并入口、选卡合并及AI merge关闭；历史主卡/子项、原件来源及必要撤销兼容保留，不批量重写资料。
- T05：只读核查本轮专用测试号：32次既有调用，31次settled、1次unknown；已消费88901微元，未知预留28172微元。该请求发送约1.077秒后停止，任务cancelled，无provider receipt。现有stop/pause会abort供应商请求，丢失后续费用证据。不得把停止等同未收费；本轮诊断未新增模型调用、未改账本。
- T06：用户确实执行了cleanup并成功，运维回执physicalBytesReclaimed=4214784；随后restart成功。界面不展示result，存储上方统计不随维护完成刷新。旧回收计数仅计算租户主库，遗漏WAL、备份及退役目录变化，应明确各口径，不把逻辑额度当物理回收。
- T07：原laugh.mp3经FFmpeg及Chromium完整解码12.48秒，绝对峰值0.164（约-15.73dBFS），无削波；隔离Electron全程播放无回零，不能因此否定用户听感。已复现shixu协议丢弃Range：bytes=100-199返回200/128345字节整文件，而非206/100字节。需修传输并补连续采样，实际安装版听感另验。

本机诊断只输出专用账号费用/任务元数据及维护回执，不读取业务正文；私有证据在外层outputs/acceptance-account-20261115。凭据、账号标识、用户截图及数据库不提交。

## 验证与交付

待实现后逐项记录；模拟、真实服务、源包、部署、用户原生安装及体验分别核对。未测不记通过，不能承诺零Bug。原生安装仍由用户本人运行，代理不操作桌面UI、不代跑安装器、不伪造回执。先自查和交付，再一次提供精简清单供用户自主统一反馈。


## 实现与验证进展

源码候选0.3.29，Draft PR126。T01直达单条冲突与独立计数，采用云端/另存副本/恢复草稿沿既有持久队列；不盲目覆盖。T02图片和PDF均有缩小/放大/适合窗口/原始比例及百分比，切附件复位、窗口变化保持适合窗口。T03默认账号范围与必要附件，协议3提供creations新建/拆分；全部目标先预览、服务端检查版本后同租户事务确认、持久操作处理丢回执，来源引用与状态保留，拆分原卡软删可恢复。协议1/2旧付费请求上下文和已认证输出保持兼容。T04生产包去掉新手动合并与AI合并，旧格式制造器移至test-fixtures，只保留历史读写/来源/撤销兼容；旧API明确410。

T05移除处置进展填写，处理按钮只按已有绑定供应商回执自动结算并重采告警；无凭据明确说明缺少什么、不关闭风险，不恢复人工暂停或主动继续旧任务。停止/暂停/清除任务不再中断已经发出的供应商请求，仍受原任务/240秒上限限制，迟到内容不发布。T06预演后明确确认释放、显示实际字节及零回收原因、任务完成刷新存储，并区分目录旧采样；计算包含WAL、备份轮换、退役目录，失败保留部分回执。T07正确媒体Range、单次播放/暂停续播与回零采样；T08在鲸鱼娘隔离全程通过后加入两款安静互动新皮肤。

本地核心120通过，读取627项中626通过1平台跳过，服务45项中44通过1平台跳过，同步126通过，桌面非UI40通过。专项真实签名HTTP：拆分陈旧版本拒绝、事务确认、响应丢失重试不重复增卡、原件哈希与费用不变；查询/创建/拆分与账号越界拒绝；直接告警只结算可信usage、无凭据风险保留；合成2MiB空闲页实际回收超过1MiB，第二次清理0，钱包未变。完整浏览器128初轮126通过：运行中修改源码触发HMR/夹具版本不一致，移动端两项失败；冻结后仅重跑这两项通过，最终完整同头结果仍以CI为准。初次误连5173外部看板预览的失败不计本轮回归，未改/停止原预览，后续使用5196独立端口。

曾误把隔离合成自动化边界解读为允许本机Electron界面回归，已停止此做法，后续原生UI仅交Windows CI。该次使用临时合成profile，没有个人数据或原安装窗口：完整鲸鱼12.48秒解码/播放、暂停续播及无回零通过；绯樱狐暂停位置断言一次时序失败，等待暂停落稳后复验通过，不冒充用户耳听或安装验收。后续交付核验只使用包内源码/资源哈希、无界面浏览器和用户原生回执。

## 新皮肤生成与资源

内置imagegen生成透明PNG，检查后机械缩放/编码为512×512透明WebP，分别25086与25792字节：`public/capybara.webp`、`public/owl.webp`；mini:build逐字节复制，原资源包2MiB门槛继续通过。素材来源/许可记入[说明](../../THIRD_PARTY_NOTICES.md)。原生成PNG仅本机留存，不依赖个人目录运行。

提示词一（慢慢）：Use case: stylized-concept. Asset type: production transparent PNG character for the Shixu productivity app skin market. Create one original compact capybara mascot, full body, upright relaxed seated pose, small ears and a recognizable long rounded snout, calm knowing expression and tiny natural eyes. Simple and cute with quiet adult taste, not babyish, not a toy, no giant sparkling eyes. Clean hand-inked dark charcoal contours, subtle cel shading, warm oatmeal brown fur and small cream accents. Elegant slightly irregular illustration with strong silhouette readable at 150px. Center the entire isolated animal on genuine transparent alpha, generous 10% padding all around, no props, no scene, no floor, no cast shadow outside the body, no text, logos or watermark. Single character and single pose only, square canvas. This is final usable app artwork, not a mockup.

提示词二（夜灯）：Use case: stylized-concept. Asset type: final transparent PNG skin mascot for the Shixu productivity app. Create one original little owl, full body perched sitting upright with two tiny visible feet and folded wings, rounded but natural silhouette, softly alert almond eyes with a calm thoughtful expression. Simple, cute, refined and quietly humorous for adults; not babyish, not a plastic toy, no huge sparkling eyes. Hand-inked dark charcoal outline with a little organic variation, restrained cel shading, slate blue-grey feathers, soft warm cream face and belly, tiny muted gold beak. Keep feather details minimal so it reads beautifully at 150px. Center entire isolated character on genuine transparent alpha, generous 10% padding, no props, perch, floor, external drop shadow, scene, text, logo or watermark. One character one pose, square canvas. Match the tasteful inked illustration feel of an oatmeal-brown capybara companion while keeping this a distinct owl. Deliver usable app artwork, not a UI mockup.

CI、源包密封、原ECS部署、用户本人运行联合更新器及独立物理回执尚待。测试号历史28172微元未知预留仍未解除，不能用程序升级冒称账单已核实；用户原账号冲突恢复及安装版声音听感尚未确认。
