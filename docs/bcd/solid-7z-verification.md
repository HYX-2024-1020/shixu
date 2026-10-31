# 7z solid共享块预算与窗口开发证据

2026-11-01，Refs #73/#69。固定方案da28c1f与A aad1903；B/C/D仍有缺口，不是独立最终联合验收。

## 实际实现

原生7-Zip26.05既有官方源构建/协议shixu-raw-path/2/hash保持不变。核对随包固定源码`CPP/7zip/Archive/7z/7zHandler.cpp`的kpidBlock、FolderStartFileIndex、GetFolderFullPackSize和NumFolders：Block是folder编号，整个块的Packed Size只在首成员报告，其余成员空白，不是0字节压缩。[上游实现](https://github.com/ip7z/7zip/blob/main/CPP/7zip/Archive/7z/7zHandler.cpp)、[7z格式](https://www.7-zip.org/7z.html)仅作结构背景，实际依赖随包已固定源码hash。

现在只开放能证明完整块集合的7z solid：块编号/数量、唯一首成员压缩量、其他成员空值、全体展开量、Headers Size+压缩块总和=原包实际字节全部核对。每块的全部成员合计展开量≤该块压缩量×100，全包同样≤100且共享展开量≤64MiB；任意成员是该已限块的子集，因此不能利用别的块低比例来掩盖某块超限。成员compressed保留null，不伪造单条压缩量或按成员重复计同一块。非solid沿单条真实压缩量的100:1检查，1,000条目、单原件10MiB、单成员10MiB读取上限和路径/CRC/终态/加密/链接/嵌套拒绝全部保留。

所有成员包括未支持类型都进入完整预检；只有选中成员从原生进程stdout输出，长度/CRC/退出状态验后才使用。外层块按其完整展开总量计一次，Office内部展开沿旧64MiB共享预算；跨页/瓦片/重开包不重复累计外层，也不重置已经累计的内层。覆盖metadata含archiveCompression及各块展开/压缩量、成员数，双端同源接收；这是块摘要，不含原件或全文。reader归档版本12，旧未完成任务需显式重新发起，同根累计保留。

不支持RAR4/RAR5 solid；缺块边界/压缩量或未实现标志仍拒绝。超大共享块会拒绝或受512MiB/30秒cgroup限制，逐成员可能重解前缀，尚不是共享解码器缓存或大成员真正流式。空成员仍按现有ARCHIVE_EMPTY_ENTRY明确未读；直接底层读取无CRC的空成员不冒称已验证。

## 开发验证

- Windows全读取421项通过；随后比例/边界/警告保护与原生相关11项通过。真实7z单共享块与两个共享块全文、emoji文件名顺序、末件逐字一致。
- 固定元数据攻击：一个块1001/10超100而全包平均合格时拒绝；重复/缺失Packed Size、缺失块/越界编号、错误头部物理总量、warning flags均拒绝，预算失败不部分增加；64MiB恰好/超1字节验证。任务内核再校验worker返回块摘要的比例、块编号、数量与总量，协议/窗口/发布包28项及Linux最终专项5项通过。solid Office 3瓦片全像素匹配B3锚点，内层展开只累计一次。
- 实际Windows AccountWorkspace及Page/Node wx签名HTTP，temporary/deleted两链：共享块内19页PDF、两份完整文字及尾件，停止/迟到结果丢弃/核验补传/覆盖和费用一致；修订仅新增文本1次，原6付费块精确复用。不是原生微信/手机/安装版证据。
- 自包含发布包实际读取两solid成员、末件与共享块成员计数，发布包相关5项通过。
- Linux独立只读测试树`/opt/shixu-bcd-test-20261101-solid`，普通UID nobody13项（solid/双端/原生）通过；受保护broker temporary/deleted两条签名HTTP链和未授权daemon UID拒绝通过。详见[机器证据](evidence/solid-7z-linux.json)。
- 资源样本6×4MiB合成文字及尾件，共一块展开25165853字节，实际压缩3577639、原包3577818字节。隔离读取第7成员时尾部hash完全匹配；单次解析604.03ms、端到端802.74ms、RSS62808KiB。非P95/cgroup峰值/容量验收；没有开放生产或安装宿主包。

本批无真实API；历史接续累计31次usage估算¥0.057858保持，实际账本、APNG完整链拆项失败与随后仅语义回放记录均保留。没有重复本机UI。完整必需CI按本批最终头评论记录。

复现：`node --test server/reading/solid.test.mjs server/reading/solid-clients.test.mjs server/reading/native-archive.test.mjs`；发布`node --test deploy/sync/release.test.mjs`；Linux脚本`scripts/reading-solid-linux.mjs`仅可针对已有自有合成树和最小runtime，不得指向生产目录。

尚未完成：RAR solid、更多格式视觉/色彩、真实大成员流式、历史投递关联AI、完整独立安全/多库迁移及真实账单/宿主证据源。BCD继续实施，E/F/生产/真实迁移/安装及最终整体验收不在本批。
