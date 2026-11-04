# WebP及通知语义去重开发验证

2026-10-31，实施#73/跟踪#69，Draft PR#74。本批属于B/C/D持续实施，不是最终整体验收。

## 实施与边界

固定libwebp1.6.0源包（SHA-256 `e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564`），项目stdin-only适配器和精确源码补丁构建工具协议`shixu-webp/3`。支持静态VP8/VP8L/ALPH及动画逐帧合成，帧序/时间/坐标沿顶层和ZIP/RAR4/RAR5/7z同一任务、费用、停止补传、修订复用及双端来源链。完整预检及实际解码所有帧后才返回请求区域，原生子进程只返回最多1024×1024 RGBA，不向Node复制所有画布。循环一次，透明白底规范化，元数据不进入模型。

JS严格校验RIFF长度、填充、块顺序/标志/帧矩形；固定原生源码补丁拒绝压缩流内部尾随字节，覆盖VP8各布尔编码分区、VP8L及压缩alpha。损坏尾帧不能变成首帧成功。**此为严格规范子集**：VP8分区要求按上游布尔编码器重编码完全一致，其他编码器的非规范终止/填充可能被拒绝；ICC/EXIF、未知块及未实现特性明确unsupported，不声称所有WebP编码兼容。XMP不发模型。保持10MiB原件、16384边长、画布×帧累计32MP、64区域与Linux512MiB/30s；工具20秒独立超时、无环境凭据、仅固定路径/版本/平台/源hash/二进制hash匹配可用。无系统解码器回退、无本地OCR。读取版本archive/9，图像解码版本`webp-composited-tiles/3;libwebp/1.6.0-strict`。

同时修复真实样本暴露的notice重复任务：语义协议`paid-semantic-pairs/2`仅允许同一行动的notice并入task或event，行动类型/标题优先，事实、摘要和全部来源并集保留；task与event/idea冲突和日期冲突仍拒绝，独立通知保留。上游及合并prompt/version进入付费依赖复用键。图像提示词加强事实依据与建议约束。

## 可复现验证

```sh
npm run reading:webp:build
node --test server/reading/webp.test.mjs server/reading/gif.test.mjs
node scripts/reading-image-live.mjs --webp
node scripts/reading-image-live.mjs --merge
node scripts/reading-archive-windows-linux.mjs /opt/shixu-bcd-test-20261031-webp --webp
```

普通测试使用固定项目合成WebP和Pillow12.3.0独立全像素golden，无Python运行依赖。6项WebP覆盖有损/无损/透明、全部帧/瓦片、包内尾件、压缩尾随、元数据与资源拒绝、缺工具/协议/hash失败关闭及真实AccountWorkspace/Page Node签名HTTP动画停止、补传、语义合并、发布；GIF新增一字节注释子块避免海量Buffer视图的回归，共11项通过。最终相关组113项、核心97项、发布/策略10项通过；同步125项、build、mini:build/check、官方小程序编译另通过。自包含发布包实际读取WebP、核对像素并携带源码和许可。未开本机UI窗口，原生微信/手机/安装版仍未验；完整必需CI按新提交远端执行。

[Linux报告](evidence/webp-linux.json)：独立只读目录、nobody测试，受保护broker顶层temporary及RAR4 deleted双端链通过，越权UID/路径注入拒绝，5/7模拟调用、100/140模拟微元，修订复用3/5块，墓碑不复活。2048²双帧累计8MP最后区域完整像素hash相等：解析392.71ms、含传输核对729.49ms；Node峰值82760KiB，原生进程峰值54992KiB，两者峰值相加保守上界137752KiB。该上界不是同时峰值或整个cgroup峰值，也不是P95/所有边界容量验收。原生RSS只作运行测量，不进入任务覆盖或模型正文。没有安装宿主包或改生产。

## 真实模型与质量

同一项目合成9537通知，实际WebP解码后调用Flash，编号/PDF/学号_姓名/算法复杂度/2026-11-03 16:45及尾部字段均保留。首次[报告](evidence/webp-real-initial.json)为1次图像+1次合并共4156微元，出现task/notice重复与页尾建议延伸；修复后[报告](evidence/webp-real-recheck.json)1次2447微元，单任务且关键事实保留，但仍把页尾9537解释为提交前核对文末的建议。该推断不是原件明确要求，保持质量限制，不能宣称识别/建议完美。

[notice→action真实语义报告](evidence/notice-merge-v2-real.json)：上游2次为明确标记的模拟结果，仅合并1次真实调用1013微元；相同任务保留task、2处引用及全部事实，另外任务不误合。缺陷先由回归复现，再修复并做真实小样本验证。

本批4次真实调用usage估算7616微元；接续累计13次24188微元（¥0.024188），非全部历史账单。价格使用已核对官方当日Flash-1017周六空闲快照，同快照预留结算，不自动重试；独立合成账本保留，不清理旧支出/unknown。构建[Windows清单](evidence/webp-windows-build.json)，Linux工具SHA-256 `694695a8b528f7e1da7e0ae8d634e5736b35da74890cb568db2d3ef32d698ea9`。

扫描PDF、Office必要视觉、solid/真正流式、历史投递关联AI、安全事件/正式迁移及外部可信证据接线等仍有实施缺口，继续在#73/#69推进。最终整体验收独立执行。
