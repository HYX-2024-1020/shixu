# RAR4/RAR5 solid共享字典开发验证

2026-11-01，#73 / Draft PR #74。本批实现真实RAR solid共享链读取；B/C/D仍继续，非最终独立整体验收。

## 实现

- 固定7-Zip26.05源码、原路径协议v3；RAR4文件头允许已定义solid位，主头允许solid，结束头仅额外接纳已定义skip-if-unknown位。分卷、加密、链接、版本、服务记录、未知标志及原路径保护保持拒绝。
- RAR的每成员Packed Size是实际物理压缩长度，Solid标记代表延续前一成员字典。按连续reset/continuation分组，不套用7z首成员独占块大小、不伪造未知长度。第一成员不能依赖不存在的块，原生Blocks须等于完整分组数；每组及全包100:1、总展开64MiB、1000成员、单次读取10MiB、原包10MiB边界保持。空组仅可零展开，不用零压缩承接正展开。
- RAR5新增全原始头预检：逐头CRC、受限vint/边界、唯一首主头/显式末结束、原生列表成员数和物理压缩总量相符；隐藏service、加密、文件版本/重定向extra、未知头、未知展开长度及分卷在读取前拒绝，不把可见列表当成全包。RAR4继续全头预检。校验失败不部分增加展开预算。
- 共享摘要沿现有archiveCompression/窗口/双端来源展示与复用契约，reader archive版本13。原生stdout仍逐次检查实际字节数、CRC、退出码；读取末件时解码器必须处理前置依赖。包内展开仅预检一次，Office内层预算继续共享。

依据：[RAR5官方格式](https://www.rarlab.com/technote.htm)及[固定7-Zip源](https://github.com/ip7z/7zip/releases/tag/26.05)中的RarHandler/Rar5Handler属性和解码行为。样本[来源与完整许可](../../THIRD_PARTY_NOTICES.md)保留；uu SHA-256：RAR4 `afce8cdb5fd80f8c74225f9141976a86ecf7bc7421e8c9d186eae698a21c3f02`，RAR5 `804caecaf59adf3ea7f2cd8b3f2bdfb92e5658598b730cc1cfc9b5d38ce3ff44`。均是原压缩流，不是修改非solid标志冒充。

## 已执行

- Windows最终完整reading 526项，525通过、1既有symlink权限跳过；相关26项及随后opaque/双端8项、最后多块/损坏依赖专项8项通过；自包含发布与双端联合4项通过。完整reading在最后RAR5原始头保护修改后运行。
- 两原包均9成员/54字节全文精确相等，末件独立读取和entry=8接续逐字相等；两版本前置压缩流损坏时末件拒绝；保留真实压缩链、仅重命名第二链元数据及更新头CRC的双块派生包18成员/108字节逐字一致。伪元数据覆盖缺块、首件continuation、块级超限但全包合格、缺Packed Size、split、非法7z块字段和零展开组。RAR5隐藏服务、加密头、分卷、未知长度、截断/重复主头/尾随及坏CRC均无可读前缀。
- Windows AccountWorkspace与实际Page生命周期/Node wx签名HTTP，两种RAR的跨端停止/继续、迟到丢弃、原件到期或删除后补传、9条包内路径/尾件和摘要一致；修订仅新增1次模拟调用，9个付费块复用。每链11次**模拟**调用/220微元，非真实支出。无新UI窗口；不是安装版、原生微信或手机验证。
- Linux自有只读树`/opt/shixu-bcd-test-20261101-rar-solid`，nobody联合29项（含真实双端与自包含发布）通过，最后双块/损坏依赖及opaque专项8项通过。独立受保护broker两链通过，未授权daemon UID拒绝；实际systemd隔离末件读取的两包全文/摘要正确。[机器证据](evidence/rar-solid-linux.json)。只有464/423字节小包，此处约221/219ms和RSS约59MiB是单次样本，不能作大包/P95/cgroup峰值证明。
- 首轮Windows在原生重建尚未结束时启动，命中旧协议失败；等重建完成后重跑通过。Linux首轮发布测试因root构建源码tar为0600不能由nobody读取失败，对自有生成目录补可读/遍历权限后最终29项通过。记录保留于测试树，未改宿主包、生产服务或真实资料。

复现：`node --test server/reading/rar-solid.test.mjs server/reading/rar-solid-clients.test.mjs server/reading/solid.test.mjs server/reading/native-archive.test.mjs server/reading/rar4.test.mjs deploy/sync/release.test.mjs`；先`npm run reading:archive:build`。Linux隔离脚本`scripts/reading-rar-solid-linux.mjs`仅指向全新自有合成树及最小runtime。

新增真实API 0；接续既有33次usage估算¥0.060148保持，非供应商最终账单。真正大成员流式、更多PDF/Office/图像特性、完整独立安全重放、逐步骤宿主/最终账单证据等继续实施；不开放生产、不迁移真实库、不做E/F或安装/发布。
