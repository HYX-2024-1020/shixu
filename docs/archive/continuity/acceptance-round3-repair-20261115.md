# 第三轮集中整改实施记录

2026-11-15，跟踪 #125，需求见 [第三轮反馈](user-feedback-round3-20261115.md)。文档PR #124 的最终头1613d62、Verify43636150426六项必需检查成功，reviews/threads为空，squash合入4675a70；固定checkout从该主线建立fix/acceptance-round-three，workspace --start通过。

## 实施与交付边界

T01—T08全部属于本任务，源码、原ECS及用户实际Windows/原本地管理台已升级0.3.29，用户原生安装及独立物理核验通过。保留#118/#107的用户集中功能验收；看板PR120/#117、官网、小程序发布及手机联验不进入。

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

模拟、真实服务、源包、部署、用户原生安装及体验分别核对。未测不记通过，不能承诺零Bug。原生安装仍由用户本人运行，代理不操作桌面UI、不代跑安装器、不伪造回执。完成自查后提供[精简自主集中复验清单](../acceptance/product-acceptance-0.3.29.md)，不恢复分步带验。


## 实现与验证进展

源码候选0.3.29，Draft PR126。T01直达单条冲突与独立计数，采用云端/另存副本/恢复草稿沿既有持久队列；不盲目覆盖。T02图片和PDF均有缩小/放大/适合窗口/原始比例及百分比，切附件复位、窗口变化保持适合窗口。T03默认账号范围与必要附件，协议3提供creations新建/拆分；全部目标先预览、服务端检查版本后同租户事务确认、持久操作处理丢回执，来源引用与状态保留，拆分原卡软删可恢复。协议1/2旧付费请求上下文和已认证输出保持兼容。T04生产包去掉新手动合并与AI合并，旧格式制造器移至test-fixtures，只保留历史读写/来源/撤销兼容；旧API明确410。

T05移除处置进展填写，处理按钮只按已有绑定供应商回执自动结算并重采告警；无凭据明确说明缺少什么、不关闭风险，不恢复人工暂停或主动继续旧任务。停止/暂停/清除任务不再中断已经发出的供应商请求，仍受原任务/240秒上限限制，迟到内容不发布。T06预演后明确确认释放、显示实际字节及零回收原因、任务完成刷新存储，并区分目录旧采样；计算包含WAL、备份轮换、退役目录，失败保留部分回执。T07正确媒体Range、单次播放/暂停续播与回零采样；T08在鲸鱼娘隔离全程通过后加入两款安静互动新皮肤。

本地核心120通过，读取627项中626通过1平台跳过，服务45项中44通过1平台跳过，同步126通过，桌面非UI40通过。专项真实签名HTTP：拆分陈旧版本拒绝、事务确认、响应丢失重试不重复增卡、原件哈希与费用不变；查询/创建/拆分与账号越界拒绝；直接告警只结算可信usage、无凭据风险保留；合成2MiB空闲页实际回收超过1MiB，第二次清理0，钱包未变。完整浏览器128初轮126通过：运行中修改源码触发HMR/夹具版本不一致，移动端两项失败；冻结后仅重跑这两项通过，最终完整同头结果仍以CI为准。初次误连5173外部看板预览的失败不计本轮回归，未改/停止原预览，后续使用5196独立端口。

曾误把隔离合成自动化边界解读为允许本机Electron界面回归，已停止此做法，后续原生UI仅交Windows CI。该次使用临时合成profile，没有个人数据或原安装窗口：完整鲸鱼12.48秒解码/播放、暂停续播及无回零通过；绯樱狐暂停位置断言一次时序失败，等待暂停落稳后复验通过，不冒充用户耳听或安装验收。后续交付核验只使用包内源码/资源哈希、无界面浏览器和用户原生回执。

## 新皮肤生成与资源

内置imagegen生成透明PNG，检查后机械缩放/编码为512×512透明WebP，分别25086与25792字节：`public/capybara.webp`、`public/owl.webp`；mini:build逐字节复制，原资源包2MiB门槛继续通过。素材来源/许可记入[说明](../../../THIRD_PARTY_NOTICES.md)。原生成PNG仅本机留存，不依赖个人目录运行。

提示词一（慢慢）：Use case: stylized-concept. Asset type: production transparent PNG character for the Shixu productivity app skin market. Create one original compact capybara mascot, full body, upright relaxed seated pose, small ears and a recognizable long rounded snout, calm knowing expression and tiny natural eyes. Simple and cute with quiet adult taste, not babyish, not a toy, no giant sparkling eyes. Clean hand-inked dark charcoal contours, subtle cel shading, warm oatmeal brown fur and small cream accents. Elegant slightly irregular illustration with strong silhouette readable at 150px. Center the entire isolated animal on genuine transparent alpha, generous 10% padding all around, no props, no scene, no floor, no cast shadow outside the body, no text, logos or watermark. Single character and single pose only, square canvas. This is final usable app artwork, not a mockup.

提示词二（夜灯）：Use case: stylized-concept. Asset type: final transparent PNG skin mascot for the Shixu productivity app. Create one original little owl, full body perched sitting upright with two tiny visible feet and folded wings, rounded but natural silhouette, softly alert almond eyes with a calm thoughtful expression. Simple, cute, refined and quietly humorous for adults; not babyish, not a plastic toy, no huge sparkling eyes. Hand-inked dark charcoal outline with a little organic variation, restrained cel shading, slate blue-grey feathers, soft warm cream face and belly, tiny muted gold beak. Keep feather details minimal so it reads beautifully at 150px. Center entire isolated character on genuine transparent alpha, generous 10% padding, no props, perch, floor, external drop shadow, scene, text, logo or watermark. One character one pose, square canvas. Match the tasteful inked illustration feel of an oatmeal-brown capybara companion while keeping this a distinct owl. Deliver usable app artwork, not a UI mockup.

## 同头CI、成品和实际云端交付

产品包来源固定为d4365e4a1bce0aecaddb228e066e25e772fd36f9。Verify43643481245核心/浏览器通过，Windows旧停止夹具等候abort，因新停止语义不再中断已发请求而超时；没有放大等待或回退费用修复。88522ea3bf1b62908196c1a5f01368b53927fa8b仅将测试供应商改为停止后显式返回凭据，停止/暂停/清除三项专项通过；相对包源只改该测试脚本，生产代码和资源相同。该头Verify43644588507六项必需检查全部成功，完整浏览器和Windows UI/读取各格式/账号等回归通过，reviews/threads为空。后续文档提交仍独立核对检查，不能借此绿灯。

已封装Windows安装包0.3.29（SHA256 700fc642a46eeba3cd6eaadd9719b870227144beab5d53282f0256a93cee42cc），ASAR fab8896434de08e58a5b8951199628d8ed0e5348e2b7248ff542cf17a26028a2。原管理台不可变资源cloud-3f6fac29f98e9739efb65d49c38e24ab319b81ba，32项资源逐个核验。私有联合更新器SHA256 8fca7483a3e53db2b43c5a8fcc90441bbd27459b9a87dee8a3f730a7b40eea3c，含44个受管文件及原受保护连接，不公开上传。无界面成品桥接检查包内源码/真实资源、原样材料、登录、新皮肤选择与重载保留，以及真实云端匿名会话查询通过；这是临时合成浏览器桥接，不是运行原生客户端或用户安装。

2026-11-15 05:59 CST，原ECS完成六库一致备份snapshot-fc43040f-7fdd-4c9e-b28a-a4f0c2d65df5后，原位切换至releases/deploy-d4365e4a1bce0aecaddb228e066e25e772fd36f9。切换前后钱包及全部调用摘要、消费/额度、历史任务状态摘要完全一致；无在途任务或reserved/sent调用，唯一历史unknown原样保留。云服务、读取broker和运维定时器健康；原同步服务/nginx进程与启动时间、官网三页哈希未变。启动探针首次连接失败后重试达到cloud-ready，最终保护断言全部通过；不能把启动期间一次重试写成持续故障。

部署后在本轮专用测试号、独立临时设备上只发送新建的合成卡（scope packet、不读其他卡正文及附件），真实模型1次，花费1373微元（约0.001373元）。提出拆分、签名事务确认后得到两张独立卡，要求甲/乙及共同截止日期、进行中状态、星标、小组均保留；原卡软删除可恢复，相同确认操作重放未增加记录版本或卡数。旧28172微元unknown完全未变，未重试模型。临时校验设备已在finally撤销，不撤销用户设备。私有回执在外层outputs/acceptance-account-20261115，不进Git。

## 用户原生安装及独立物理核验

2026-11-15 16:44 CST用户本人完成联合更新器，明确回复“已更新，两个原入口均打开”。16:49 CST独立隐藏只读校验进程确认无包身份（GetCurrentPackageFullName返回15700），通过卷GUID路径读取真实安装文件及回执，未操作桌面UI或读取业务profile。客户端物理位置沿用AppData/Local/Programs/shixu，控制台沿用AppData/Local/Shixu/AdminConsole；0.3.29、产品源d4365e4、EXE及ASAR哈希、44个受管文件、原两快捷方式、实际客户端进程及控制台网关进程/运行指纹全部匹配。私有证据为外层outputs/acceptance-account-20261115/user-native-install-verified-d4365e4.json、user-native-verifier-context-round3.json及安装回执，不进Git。

前一文档头fa34ff0的Verify43646220025六项全部成功；本次只补实际安装记录，提交后仍按新头完成必需CI和审查再合并，不复用旧绿灯。安装本身和本次只读校验新增模型0次。测试号历史28172微元未知预留仍需可信供应商账单，用户原账号冲突恢复及安装版声音听感尚未确认；安装与打开入口不等于功能验收。#118/#107保持开放。
