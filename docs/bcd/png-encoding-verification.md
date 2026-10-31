# PNG 低位深与 Adam7 开发验证

2026-10-30，关联 #73/#69，Draft PR #74。接续顶层及归档 PNG，不组织 B/C/D 最终联合验收。

## 新增实施

按 [W3C PNG 第三版规范](https://www.w3.org/TR/2025/REC-png-3-20250624/) 的像素打包、逐 pass 与字节滤波定义，新增 1/2/4 位灰度、调色板及所有已有 8 位颜色类型的 Adam7 交错解码。空 pass 没有滤波字节，各非空 pass 的 previous row 独立归零；低位深左高位排列，行尾填充位不成为像素；透明键先按原采样位深比较，再缩放/铺白。调色板大小不得超过位深可表达范围，越界像素失败关闭。

不使用本地 OCR、不引入生产解码依赖，不改变 32MP、16384 边长、64 瓦片、512MiB/30s 隔离上限和费用规则。模型仍接收既有规范化 8 位 RGBA PNG；读取器升为 `png-tiles/2`，归档版本升为 `archive/5`，复用不能跨旧读取版本误认依赖。双端说明同步，保留像素来源与核对提示。

## 定向证据

`node --test server/reading/png-encoding.test.mjs server/reading/image.test.mjs server/reading/archive-images.test.mjs` 37 项通过；图像任务停止/重建/无供应商能力定向组 4 项通过。

编码矩阵 22 组合 × 4 尺寸（1×1、1×9、9×1、19×11），包含所有 pass、窄图/空 pass、5 种滤波、透明键/alpha 与非零填充位。项目自编编码样本使用规范的 8×8 pass 所属矩阵，读取器用独立 start/step 表；先通过现有开发依赖 `@resvg/resvg-js` 的独立原生解码逐像素确认样本，再核对自己的解码和规范化模型图片。损坏/截断/多余 pass 字节、非法过滤、位深、调色板和 16 位输入均失败关闭。

归档三瓦片逐像素还原完整输入，保留 path、坐标和尾部；顶层 Page/Node wx 与 Windows AccountWorkspace 的真实签名 HTTP 验证停止晚到、temporary 补传、付费块及修订复用。构建/类型检查、核心 93 项、mini:build/check、官方 WXML/WXSS 编译、政策 8 项通过。未启动本机 UI 窗口，完整必需 CI 远端执行。

## Linux

独立目录 `/opt/shixu-bcd-test-20261030-png-encoding`，只复用本任务既有工具与 runtime，不安装宿主包。

```sh
node scripts/reading-archive-windows-linux.mjs /opt/shixu-bcd-test-20261030-png-encoding --packed-png
runuser -u nobody -- node scripts/check-png-encodings.mjs
```

[隔离报告](evidence/png-encoding-linux.json)：受保护 broker、普通 UID 下，2 位调色板 Adam7 顶层 temporary / RAR4 deleted 双端链通过，分别 5/7 次模拟调用、100/140 微元，修订复用 3/5 块；晚到结果丢弃、原件不复活、越权 UID/路径注入拒绝。

单次 4096×2048 RGBA Adam7 第 8 瓦片，完整 1024×1024 像素与独立预期相同，hash `6ca8498ec189e72ad2f967f298674aaad3c750523737418fa054f61055bf1774`；峰值 165632 KiB，parse 约 1436ms、含传输核对约 1782ms。仅固定开发测量，非 P95 或最大容量声明；未重跑历史 32MP 压测。

[普通 UID 像素报告](evidence/png-encoding-pixels-linux.json)：88 样本和规范化输入全像素相等，fixtureSetHash `76513a3ba86cba4c1975b67e585cc0919f4205c54391680465818cc4889217b0`，与 Windows 同脚本一致。Linux 既有合成测试依赖目录不含 resvg，原生 oracle 测试在那里未执行（明确报缺包）；没有为此安装软件，独立原生 oracle 由 Windows 测试证明，不能混写为 Linux 原生 oracle 通过。Linux 实际隔离解码、普通 UID 和内存测量另有上述直接证据。

## 未完成边界

16 位 PNG、高级色彩/方向、动画、JPEG/GIF/WebP、扫描 PDF、Office 图像与跨区域语义合并仍未实现，详见[当前清单](implementation-status.md)。原生微信、手机、安装版与新增可见窗口尚未验证。

没有新增模型/提示词/规范化输入协议，复用[已执行 PNG 真实 API 验证](image-verification.md)的同一规范化图像通道；新编码只在隔离解码阶段变化。此增量零真实调用，整个本轮新增仍为 1 次、usage 估算 ¥0.002316。模拟测试不充当模型识别质量证据。
