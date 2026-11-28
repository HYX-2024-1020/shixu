# JPEG、方向校正及严格解码开发验证

2026-10-30，#73/#69，Draft PR #74。B/C/D 仍有实现缺口，此为开发证据，不是最终联合验收。

## 实施及安全边界

- 顶层及 ZIP/明确编码非 solid RAR4/RAR5/7z 内的 JPG/JPEG，支持 8 位 Huffman 顺序/渐进式灰度或已明确解释的 JFIF YCbCr、Adobe RGB 变换声明。ICC、CMYK/YCCK、多图 MPF、XMP、歧义色彩/非方形像素及其他未实现编码明确失败关闭，不能声称所有 JPEG 都支持。
- EXIF 的 II/MM 字节序与 8 种旋转/镜像，校验 IFD 类型/数量/边界/重复/循环及相关 sRGB 声明。只在当前瓦片映射方向，不再分配第二张全帧。模型获得规范化 PNG；Exif/GPS/注释等原始元数据不发送、不持久保存于任务块。
- 来源像素坐标属于按方向校正后的显示图；保留 orientation、encodedWidth/Height，可逆对应原编码像素。双端显示方向校正提示、包内路径、逐图进度及识别核对提醒。
- 保持 10MiB 原件、32MP、16384 边长、64瓦片及外层累计展开/压缩比边界。编解码器另限约 256MiB 分配量，进程仍限 512MiB/30s；部分虽然低于32MP、但系数展开较大的文件会报 `JPEG_RESOURCE_LIMIT`，不暗中缩小图片或截断。
- 固定 `jpeg-js@0.4.4`，lockfile 校验完整性；解码器自包含构建入 `/reader`，不把宿主 node_modules 加进隔离根，不依赖任意系统解码器。生产包明确携带 reader/许可，测试编码器排除于发布。许可和本项目修改见 [第三方说明](../../THIRD_PARTY_NOTICES.md)。

原始标记链在解码分配前完整预检：单帧、长度/表/采样/扫描范围、准确 EOI、拒绝尾部或第二图，重启标记数量及顺序绑定当前扫描。审查复现上游即使 `tolerantDecoding:false` 仍会跳过扫描尾部多余字节：改前 `read/1 segment`，改后 `failed/0 segment/JPEG_MALFORMED`。固定构建器精确锚定补丁，验证填充位、EOB 终态及无多余扫描字节，修正最后不足整重启间隔的循环；锚点不符即构建失败。版本 `jpeg-js/0.4.4;strict-jpeg/2`、归档 `archive/6` 防止旧依赖误复用。

## 定向验证

最终 `jpeg.test` 25 项通过：8 方向 × 2 字节序与独立 resvg 原生渲染比对；固定 3×2 像素索引验证方向；顶层及四种归档逐瓦片核对全部解码像素、顺序/路径/来源/坐标及尾件；截断、ICC/MPF/XMP、歧义 EXIF、超限、填充与扫描尾部、重启顺序等拒绝；双端真实签名 HTTP 的停止晚到、temporary/deleted 补传及修订付费块复用通过。

两张渐进/重启样本由项目自构 RGB 像素，使用已有 Pillow 12.3.0/libjpeg 生成，无外部照片。生成脚本 `scripts/build-jpeg-progressive-fixture.py` 与编码字节/独立像素 golden 同库。逐像素最大差2，平均约0.383/0.401（JPEG IDCT 差异）；验证的是解码后的完整瓦片，不把有损 JPEG 当压缩前 RGB 无损保存。原生方向样本限其明确测试的采样与色彩范围，不能推广为所有照片的精确色彩证明。

直接相关内核/窗口/任务/自包含发布组124项通过后，最终扫描补丁又通过JPEG25项、发布/政策10项和解析构建校验。源码构建/类型检查、mini:build/check、官方WXML/WXSS编译通过；没有本机窗口验证。完整必需CI仍在新头远端执行。

## Linux 独立环境

目录 `/opt/shixu-bcd-test-20261030-jpeg`，复用本任务最小 runtime/固定归档工具，未安装宿主软件包。

```sh
node scripts/reading-archive-windows-linux.mjs /opt/shixu-bcd-test-20261030-jpeg --jpeg
runuser -u nobody -- node scripts/check-jpeg-encodings.mjs
node scripts/reading-jpeg-strict-linux.mjs /opt/shixu-bcd-test-20261030-jpeg
```

[双端/资源报告](evidence/jpeg-linux.json)：受保护 broker 普通 UID，顶层 temporary / RAR4 deleted 各5/7次模拟调用、100/140微元，修订复用3/5块，原件/额度/墓碑不复活，无权UID及路径注入拒绝。4MP方向6第4瓦片的完整1024²像素等于预期，峰值281212KiB、parse约3480ms、含传输与本地预期核对约4946ms。单次、非P95；该资源测量早于最终扫描补丁，不冒称最后头的最大容量证明。

最终补丁的[实际隔离补验](evidence/jpeg-strict-linux.json)只跑新边界：旋转图末瓦片、渐进式不完整末重启间隔、扫描多余字节；全部与宿主可信预期一致，损坏材料零图片。未重复历史双端链或压力测量。[普通UID像素证据](evidence/jpeg-pixels-linux.json)含16方向/字节序和两个独立golden，集合hash `92ec699893ebc5a85d92d3f67ac95288dfa2dedbc565b58b1099537782f8f0e8`，与Windows同脚本一致。原生resvg oracle仅在Windows执行；Linux隔离和独立golden另记，不能互代。

## 必要真实模型调用及费用

[计划](evidence/jpeg-live-plan.json)后执行1次合成通知照片：编码600×900、方向6、JPEG质量85，显示900×600。核对当天官方[价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)及[政府节假日安排](https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html)，按2026-10-30北京16:00高峰冻结价格；未充值/改额度/发私人材料/使用本地OCR。

[真实报告](evidence/jpeg-live.json)：prompt1493、cached896、completion656，预留52052微元，结算6478微元（¥0.006478），约4525ms，1次且无自动重试。方向、编号8642、2026-11-02 17:30、PDF/学号_姓名、算法/复杂度与尾编号均保留。模型同时产出task和notice重复项，并把尾部核对延伸为报告操作建议，语义合并和人工核对仍有缺口；不能写成完美转写或质量全部通过。

真实调用发生于扫描补丁前。补丁后0调用准备核对同一输入hash `4ce8a3f06f61a99253e48a10b8fc7844cd7f9e5fbdcd79ab9f2b72468a35dafd`、规范化模型图hash `bc2a8d48737c3a206f09a399cf01f58cfc20c7d5d532265b5f2af541e7270b74` 均不变，因此复用该有效质量证据，不重复花费。

最初两次本地准备因脚本按不存在的period字段选价而失败，尚未发送请求；已以只读独立账本核实均0调用，修正后准备通过，记录未清除。成功调用账本保留在工作区 outputs；SHA、调用和源文件hash见[结构化总证据](evidence/jpeg-validation.json)。整个本轮新增真实调用合计2次、8794微元（¥0.008794），含此前PNG1次2316微元；各账本/unknown/水位保持。

## 剩余项

GIF/WebP、16位/高级色彩PNG、扫描PDF、Office图像、跨区域和跨修订语义合并、solid、大材料流式、其他AI共账与完整安全恢复/迁移仍待实施。真实账单与宿主终止证据集成尚有门禁；原生微信/手机/安装版和本增量可见窗口未验。详见[当前清单](implementation-status.md)，保持Draft，不合并、不关闭跟踪。
