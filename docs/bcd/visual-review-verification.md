# 图像事实依据核对开发验证

2026-10-31，#73/#69，继续 `feat/bcd-attachment-loop`、Draft #74。不包含整个B/C/D最终联合验收。

## 缺陷与实现

前一真实扫描PDF输出把“尾部核对9537”推断为“需写在报告尾部”，也生成了相应建议。现以该真实结构化输出固定回归；原始证据保留，不将原调用改记为通过。

`visual-grounding/1` 在每个图像识别块后，使用原安全PNG瓦片与少量已付费主张，按最多16条/56000字节独立核对。每批是单独的内核步骤和调用，使用同一价格快照、账号钱包/槽位、根累计、24调用检查点、停止generation、unknown及关闭屏障；没有在一个预留中隐藏第二次API调用。核对只能返回原ID的supported/unsupported/uncertain/suggestion，不允许遗漏、重复、发明ID或改写内容；suggestion仅限下一步建议。模型核对仍可能误判。

原始付费块保持不变。服务端按核对结论确定性生成发布投影：无依据事实/步骤移入明确标注“不作为原文要求”的待确认区；无依据引用清空文本但保留来源定位；无依据日期转待确认；不静默删除待确认内容，容量超限暂停。未经核对的图像块不能发布或借部分收下直接接受。部分收下仅标记实际已核对块为processed。

独立账本先绑定图像输入hash，再绑定主张/依赖/分批hash与不可改删付费凭据。租户改范围类型、改判断、丢记录均不能变成可信结果或再次盲付费。信封恢复不重复付费；停止后的迟到usage正常结算，但不发布。跨修订复用要求原件、录入日、模型、上游结果、来源与所有核对依赖完全一致；后续语义合并版本升至`paid-semantic-pairs/3`，只使用核对投影并绑定其凭据hash。

读取版本追加`visual-review/1`，旧未完成任务输入版本变化须重新发起；不清费用、根累计或门禁。已发布历史结果不自动改写、不自动发起收费核对；没有新独立凭据时失败关闭，不把租户记录自动补签。真实维护/迁移链仍有剩余实现。

## 开发检查与边界

- Windows相关任务/窗口/检查点/关闭/核对/合并120项通过，新增供应商图像核对专项通过；核心97、同步125、独立发布包与政策10项通过。发布包实际执行识别→核对→确定性发布及两笔账本调用，不只检查文件存在。
- 新核对内核11项：真实缺陷投影、分别计费、部分发布门禁、篡改类型/判断、停止迟到、付费信封恢复、unknown/无效响应、同依赖复用与日期失效、进程内重建、容量拒绝、预检耗尽时间不预留、核对投影与语义合并依赖。双端2项实际AccountWorkspace与Page/Node wx签名HTTP，temporary/deleted补传、三瓦片来源/覆盖/尾部、共同费用/批数通过。
- 独立Linux只读测试树`/opt/shixu-bcd-test-20261031-visual-review`，普通UID nobody：内核、双端、供应商、语义30项通过；新增预检耗时门禁后内核/双端12项再次通过；继承固定原生工具，不安装宿主包、不修改生产。此次改动是模型/任务及发布链，不重跑未变的历史全部像素矩阵；PDF隔离渲染证据见[前批](pdf-visual-verification.md)。
- build、mini:build/check通过；小程序官方无窗口编译通过；前批修正b074caa六项必需CI全部成功（41204629736）；本批完整必需CI按最终头核实后记录。不以Node、源码或CI冒称原生微信/手机/安装版通过。无本机窗口。

复现：`node --test server/reading/visual-review.test.mjs server/reading/visual-review-clients.test.mjs server/reading/deepseek.test.mjs server/reading/merge.test.mjs`；发布包：`node --test deploy/sync/release.test.mjs`。安全配置真实工具沿用`node scripts/reading-image-live.mjs --pdf-visual`；`--review-fixture`只模拟上游旧缺陷识别，实际核对API单独计数，不能声称其上游也是本次真实识别。

## 真实调用

重新核对[官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，冻结2026-10-31周六空闲快照，沿用已有safeStorage、无BrowserWindow，合成扫描图像无私人材料。

1. [完整PDF链](evidence/visual-review-real-pipeline.json)：真实识别1次＋核对2次，usage估算5510微元，全部已结算。PDF格式、学号_姓名、算法思路/时间复杂度、2026-11-03 16:45、页码/108dpi/覆盖保留；此时识别本身未产生旧的报告尾部要求，不能据此证明剔除能力。
2. [固定缺陷输出核对](evidence/visual-review-real-replay.json)：1次真实核对2388微元，1次模拟上游识别单列（开发账本另含50微元模拟费用，不是实际API费用）。真实核对将旧事实与建议判为unsupported，报告尾部要求从事实/步骤移除并完整留在待确认，真实关键要求/日期/引用定位保留。

新增4次共7898微元；本接续累计19次、usage估算36477微元（¥0.036477），不是全部历史账单或供应商最终对账。两个独立账本及全部此前失败/unknown记录保留于工作区outputs，不回写或删除历史。

Office视觉、未支持PDF资源/字体/批注/编码、PNG高级色彩/动画、JPEG剩余特性、solid/大材料流式、历史投递关联AI、真实证据源与完整安全重放/正式迁移仍待实施。模型核对成本随主张批数增加；未做P95、容量或普遍语义准确率验收，保持Draft。
