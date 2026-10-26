# 第三方代码、素材与样本

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
