# 第三方代码、素材与样本

## 绯樱狐素材（2026-10-27，Issue #65）

`public/bunny.png`、`public/bunny-motion.webm`、`public/fox-atlas.webp` 和 `public/bunny-voice.mp3` 来自用户在本次对话提供的 `10月26日.mp4`。用户明确要求在 Windows 与小程序皮肤市场使用。原视频 SHA-256：`0625640e95b9f5773a8a2de5247d2ea2e62f8e1911185c3a17b858356e1748d3`，原视频本身不入库。原作者及开放许可未提供；这些角色和音频不按项目 MIT 重新授权，不授权其他用途再分发。

使用 BiRefNet Full 本地去背景，原视频横向裁剪 x=802..1758；不生成画面外内容。桌面视频为480×694、220帧/30fps、VP9 CRF18透明WebM，0.3.23起将原MP3解码后以96kbps Opus合入同一WebM时间轴，画面编码直接复制，透明alpha元数据保留；小程序继续使用独立MP3。待机图恢复原抠图480px RGBA PNG，不使用索引色。手机图集取偶数源帧得到110帧/15fps，单帧240×348，10列×11行，真彩WebP质量85；alpha<=16置0、>=240置255，去除极低透明背景与接近不透明内部的轻微alpha波动，保留其余边缘过渡，不绘制或改造人物。替换原128色/160px六图集以减少色块和换图闪烁。音轨保留整段原声并提升10dB，不变调；不含模型、工具代码或运行时。`miniprogram/assets/bunny*`及`assets/fox/atlas.webp`是同源逐字节副本；手机图集放入fox-skin资源分包。

项目原创代码采用根目录 [MIT License](LICENSE)。第三方依赖、字体和样本保留其各自许可；MIT 不替代它们的授权条件。

| 材料                         | 来源与许可记录                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm 依赖及打包工具           | 精确版本和来源见 `package-lock.json`；使用或再分发时保留依赖包的 LICENSE/NOTICE。`private: true` 不限制源码开源。                                                                                                                          |
| Noto Sans SC                 | `public/fonts/NotoSansSC.ttf`，随附 [OFL](public/fonts/NotoSansSC-OFL.txt)，SIL Open Font License 1.1。                                                                                                                                    |
| Space Grotesk                | `public/fonts/SpaceGrotesk.ttf`，随附 [OFL](public/fonts/SpaceGrotesk-OFL.txt)，SIL Open Font License 1.1。                                                                                                                                |
| 旧 Office 测试文件           | Apache Tika 测试样本，Apache-2.0；来源与使用说明见 [fixtures](desktop/fixtures/README.md)。再分发请同时保留上游许可和适用 NOTICE。                                                                                                         |
| RAR 测试样本                 | libarchive 测试套件，保留 uuencoded 原文件；来源见 [fixtures](desktop/fixtures/README.md)。须遵守上游文件的许可及版权声明。                                                                                                                |
| 中文手写识别样本             | 仅供可选真实验收；下载位置、固定版本和校验值见 fixtures 说明，仓库不分发照片。公开可访问不等于任意使用授权。                                                                                                                               |
| 鲸鱼图像、笑声音频及视觉参考 | 由项目发起者提供，使用位置为 `public/mascot.png`、`public/laugh.mp3` 及小程序的同源副本；早期静态参考页已从当前树移除，Git 历史保留。现有记录未提供原作者/具体许可，来源和再分发授权仍需维护者补录；不要据此宣称第三方素材已完成许可审计。 |

提交新素材时附上原始来源、版本/校验值及许可文本。无法确认再分发权利的新增材料不应进入仓库或安装包；优先使用自行制作或明确授权的替代物。发现已有材料的权利问题，请向维护者提交不含个人资料的说明，以便核查、替换或移除。

文档截图位于 docs/assets/，来自实际应用在隔离 profile 中的自动化测试，仅含合成资料。截图中的既有角色素材仍适用上表授权待补记录。

小程序 `assets/skins/` 的 7 张 PNG 由本项目 `src/bucket/SkinArt.tsx` 中的 SVG 原画在构建时生成，预设与台词来自 `src/bucket/skins.ts`，不引入新外部角色素材。既有 `mascot.png` 仍适用上表的授权待补记录。生成工具 esbuild（MIT）和 resvg-js（MIT）精确版本见 lockfile；后端同源业务模块由 esbuild 生成，不包含新增第三方运行库。

DDL 界面依据项目发起者于 2026-10-24 提供的 `ddl.html` 适配为 React 与原生小程序界面；不引入参考页的外部 Google Fonts 请求或演示数据，字体及角色继续使用项目现有资源。参考稿未附单独的原作者或许可说明，沿用上表用户提供视觉参考的来源记录。


## 冰冰冰皮肤素材（2026-10-26，Issue #59）

- `public/ice.png`：用户在本次对话提供的三块冰图片，经内置 imagegen 去除深色背景，输出真实透明 alpha。提示词要求保留三块冰的形状、排列、冰纹和颜色，不加文字、物体或外部阴影（background-extraction）。原图未入库。交付 PNG 为 FFmpeg 等比缩至 480px 宽的 RGBA 版本，以降低小程序包体积，保留透明通道。
- `public/ice-voice-1.mp3`：用户提供录屏 `屏幕录制 2026-10-26 232625.mp4`，取音轨 2.55–3.55 秒。
- `public/ice-voice-2.mp3`：用户提供录屏 `屏幕录制 2026-10-26 232702.mp4`，取音轨 0.92–1.65 秒。
- 音频用 FFmpeg 转为单声道 44.1 kHz / 128 kbps MP3，仅在边缘做 8ms 淡入、20ms 淡出；保留原有声调，未合成或变调。每份是一声「冰冰冰」，录屏视频与其他音频未入库。
- `miniprogram/assets/ice*` 是上述桌面资源逐字节生成的副本。用户授权在本项目中处理和使用；未提供原始作者和开放许可，不主张这些素材适用仓库 MIT，也不授予其他用途的再分发许可。


### 0.3.20 音频截取修正

沿用上述两份用户录屏与截取区间。旧版处理在截取前按录屏时间执行淡出，导致生成片段完全静音；本次先重置时间戳、atrim 截取，再 asetpts 重置片段时间戳，最后执行 8ms 淡入与20ms淡出。保留原始声调与来源使用范围。修正版解码 RMS：声音一约0.05496、声音二约0.05221；长度仍为1.00/0.73秒。不再以文件存在、可解码或时长正确代替有声验证。

## 服务端DOCX读取依赖（2026-10-28，Issue #73）

`sax@1.6.1` 来自 https://github.com/isaacs/sax-js ，BlueOak-1.0.0，精确包和校验见lockfile。`server/reading/docx-reader.cjs`由本项目读取源码及sax打包，保留随附的 `server/reading/docx-reader.LICENSE`；不能将其依赖许可改称MIT。候选saxes上游已归档，未引入为新的读取依赖。包容器使用Node24内置zlib/CRC32；测试DOCX由项目自己的合成文字、XML与既有fflate生成，没有第三方文档样本或私人原件。
