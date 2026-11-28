# PDF文字专用批注读取收尾

2026-11-02，#73 / Draft PR #74。按用户最新要求，仅完成暂停前手头这批改动，提交后暂停扩展B/C/D；整体仍未完成。

文字专用读取现在包含批注正文、字段保存值和完整选项，保留页码、编号、矩形和独立来源ID；不要求图像模型，也不把元数据冒充外观已读。密码值不追加文字，视觉/批注外观仍明确未读。正文与批注共同预检后才提交整页，归一化换行也计入资源预算；120k码点分片、8页游标和累计偏移保持。正文与批注来源ID区分，避免同页冲突。

读取器升级`pdf-text/5;annotations/1`；文字/视觉构建共享已有的局部Node24 Map/toHex/求和兼容处理，不改全局原型。文字路径此前未覆盖Widget所需Map方法，专项暴露后修复。内核新增文字片段长度、来源ID唯一性、覆盖/片段一致性和批注字段验证；归档内PDF在校验原始一致性后共同换算相对偏移。自包含包携带对应补丁源。

已执行：

- Windows完整reading551项：550通过、1既有symlink权限跳过；同步125、自包含发布2、文字bundle重建/核对通过。
- 专项覆盖九页四类批注/字段、8+1页接续、正文和批注同页来源、精确资源边界无半页前缀、150k+Unicode完整分片、密码保护、重复/超限及伪造来源；归档前置成员的绝对偏移正确。Map全局原型保持。
- Windows AccountWorkspace和实际Page/Node wx签名HTTP，PDF/ZIP两链的停止/迟到丢弃/到期或删除补传、九页来源/矩形和未读状态、付费复用通过。每链4次模拟调用/80微元，修订新增1次且复用2块；不是原生微信/手机或安装版验收。
- 复用自有Linux只读测试树，nobody39项、受保护broker两链/未授权UID拒绝及四类实际隔离文字样本通过；见[证据](evidence/pdf-text-annotation-linux.json)。Linux工具沿固定SRI包交叉构建后实际执行，无新测试树/runtime、宿主包或生产改动。
- 本批没有新本机UI窗口、部署或真实API调用。接续既有33次usage估算¥0.060148保持，非最终供应商账单，也非开发总成本。

复现：`node --test server/reading/pdf-text-annotations.test.mjs server/reading/pdf-text-annotation-clients.test.mjs server/reading/pdf.test.mjs server/reading/windows.test.mjs server/reading/archive-windows.test.mjs deploy/sync/release.test.mjs`。前批`341f5b3`的run41329508042六项全绿；本次提交CI另行核对，不能用前批结果替代。

更多格式、流式、运维与安全重放缺口保留在原计划，当前不自动继续。[范围与资源审视](scope-review-20261102.md)是收敛建议，未擅自宣布B/C/D完成或改写既有验收契约。
