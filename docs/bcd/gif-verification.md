# GIF逐帧合成与模型读取开发验证

2026-10-31，#73/#69，Draft #74。B/C/D继续实施中，本增量不组织最终联合验收。

## 实施

项目按[GIF89a规范](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)自行实现纯JS读取器：GIF87a/89a、全局/局部调色板、透明索引、交错、可变宽LZW及满字典/clear/结束、帧矩形、0/1/2/3帧处置（保留/背景/恢复前帧），按显示顺序合成完整画布，再经既有白底PNG瓦片输入模型。覆盖保留帧序、帧起始/持续毫秒、画布坐标、瓦片和包内原路径，循环只展开一遍，0延迟按原值保留，不按浏览器播放策略改写。

首区域发送前预检并实际解码全部帧，包括尾部；强制精确像素数、压缩结束及无多余压缩/文件字节。无外链、宿主解码器或OCR，注释/应用元数据不发模型。不使用第一帧冒充整图，非方形像素、纯文本/交互/未知扩展和未定义处置明确unsupported。10MiB原件、16384边长、32MP、64区域及Linux512MiB/30s边界不放宽；动画另按画布像素×帧数累计32MP，不保留所有帧像素缓存。归档版本archive/8，读取版本gif-composited-tiles/1，沿原停止/原件补传/付费/语义合并/发布链。

## 定向验证

```sh
node --test server/reading/gif.test.mjs server/reading/image.test.mjs server/reading/merge.test.mjs deploy/sync/release.test.mjs
node scripts/reading-image-live.mjs --gif
node scripts/reading-archive-windows-linux.mjs /opt/shixu-bcd-test-20261031-gif --gif
```

Windows上述相关组26项、受影响JPEG/PNG59项及同步125项通过，GIF专项4项包括：独立Pillow12.3.0固定LZW字典宽度/交错/局部调色板/帧处置的全像素hash、KwKwK、损坏/尾部/透明度/资源、三帧九区域顶层与ZIP全量还原，以及真实AccountWorkspace/Page Node签名HTTP动画停止/临时补传/双方来源与语义合并。独立发布包实际读取GIF第二帧并逐像素核对。build、mini:build/check、官方编译通过，无本机UI窗口；完整必需CI按新头远端执行。

[Linux报告](evidence/gif-linux.json)：独立只读`/opt/shixu-bcd-test-20261031-gif`，可遍历cwd、普通UID nobody的GIF4项通过；受保护broker顶层temporary/RAR4 deleted两条双端链保留3区域、5/7次模拟调用、100/140微元、修订复用3/5块、迟到结果拒绝与墓碑不复活；越权UID、路径注入拒绝。双帧2048×1024（累计4MP）第4区域完整像素相等，单次parse1363ms、含传输核对2298ms、峰值108876KiB。不是P95、全边界内存证明或生产容量验收。新增透明索引与背景索引不同的Pillow样本先复现错误背景，再修复白底规范化，Windows/Linux普通UID专项重验通过。未安装宿主软件、未改生产。

[真实GIF报告](evidence/gif-real-quality.json)：900×600两帧合成通知，经实际GIF解码/逐帧规范化、两次图像模型及一次语义合并发布。编号7319、PDF、学号_姓名、算法与复杂度、明确2026-10-30 18:00和尾部核对通过；第二帧UTF-8源代码要求进入同一事项。3次usage估算4898微元（¥0.004898），小样本不代表任意动画理解/转写正确。沿当天已复核官方Flash-1017周六空闲价格，同快照预留结算，无自动重试。

本接续累计：图像旧2次8794微元、事项对话3次1770微元、语义1次1110微元、GIF3次4898微元，共9次16572微元（¥0.016572）。不是全部历史账单/供应商对账。独立合成账本保留outputs，不删改历史账本或unknown。开发运行曾因main新功能导致PR冲突，bc10443已合入最新main并保留双方功能；核心97项、管理员浏览器2项通过，必需CI以精确头记录。

## 保留边界

WebP、扫描PDF/Office必要视觉、PNG高级色彩/动画、未实现JPEG特性、solid/真正流式、历史投递关联AI、可信外部证据源与全域安全迁移仍有实施缺口。GIF未实现扩展逐项明确unsupported。源码Electron新增可见窗口、原生微信/手机/安装版未验，Node适配与Linux隔离不能替代这些证据。
