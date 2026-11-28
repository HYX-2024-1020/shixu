# 静态16位PNG开发验证

2026-10-31，#73/#69，Draft #74；不是B/C/D最终整体验收。

## 实现与范围

支持灰度、RGB、灰度alpha、RGBA的16位非交错及Adam7编码。按[PNG第三版13.12](https://www.w3.org/TR/png-3/#13Sample-depth-rescaling)先以完整16位比较tRNS透明键，再按线性四舍五入降至8位，沿已有白底规范化模型图像通道；无OCR，无新模型输入协议。读取版本png-tiles/3、外归档archive/7防止旧结果误复用。高级色彩/方向与动画仍明确未读，不因16位支持忽略ICC等元数据。

## 证据

- PNG/image/archive专项47项通过，包含8种新16位颜色/交错组合×4尺寸，独立原生resvg oracle逐像素确认。规范16位复制采样用于native精确比对，额外任意低位golden验证舍入、完整透明键、灰/RGB透明和半透明alpha。畸形/截断/多余字节、非法编码、原限额失败关闭。
- 跨平台120固定样本全像素与规范化模型输入一致，fixtureSetHash `8015f3c69d1d6aa195ad51594df6521009b4dab94f32ed8fa5be7557b0482797`。其中旧88样本只作受影响解码回归，不重跑历史UI矩阵。
- Windows AccountWorkspace与实际小程序Page/Node wx签名HTTP，16位Adam7三瓦片顶层temporary及RAR4 deleted链通过，保留来源/尾部、停止迟到屏障、原件门禁与修订付费复用。
- [Linux证据](evidence/png-sixteen-linux.json)：独立只读目录 `/opt/shixu-bcd-test-20261031-png16`，普通UID像素120样本、受保护broker两条双端链通过。首次目录缺固定原生工具，RAR4进入模型前unsupported，补齐同版本hash校验工具后通过；没有改为调用系统7z。未安装宿主包、未改生产。
- 4096×2048、16位RGBA Adam7第8瓦片完整1024×1024像素一致：parse 3899ms，含传输核对4343ms，峰值246528KiB。仅固定单次测量，不是P95、32MP极限或容量验收。无新真实模型调用，模型通道沿用已核对PNG通道。

```sh
node --test server/reading/png-encoding.test.mjs server/reading/image.test.mjs server/reading/archive-images.test.mjs
node scripts/check-png-encodings.mjs
node scripts/reading-archive-windows-linux.mjs /opt/shixu-bcd-test-20261031-png16 --sixteen-png
```

双端说明、共享生成和官方编译已更新/检查。无本机窗口，原生微信/手机/安装版未验；扫描PDF、Office视觉、GIF/WebP、高级色彩等仍见[实施清单](implementation-status.md)。
