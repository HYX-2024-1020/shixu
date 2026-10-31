# PDF页面视觉与扫描页开发验证

2026-10-31，实施#73/跟踪#69，Draft#74。B/C/D持续实施，本批不执行最终整体验收。

## 实施及启用边界

在既有文字层路径之外增加PDF页面视觉读取：每步一页中的一个1024区域，108dpi、白底，保留页码、旋转、CropBox、像素坐标和仅元数据游标。第一页区域仅一次附带该页文字层，按Unicode窗口分段；区域与文字层覆盖分开。顶层和ZIP/明确编码非solid RAR4/RAR5/7z包内共享停止generation、原件重新核验、付费结果、修订精确复用、账号/每日/在途预算、根1800秒/24调用及发布链。后续页/区域明确未读，损坏页不发送其像素，后续完整页可继续。没有本地OCR，不把提取文字层称为扫描页已读。

渲染器采用已在lockfile固定的PDF.js6.2.108与@napi-rs/canvas1.0.13，npm原包SHA-512校验，固定平台工具清单/全部运行文件SHA-256检查，无宿主canvas回退。禁用宿主/用户字体加载、URL图像加载、外部字体/CMap/资源获取、脚本/eval与Wasm；缺字形、批注/表单外观和渲染告警明确未完整读取，不把缺失对象的空白当成功。每个页面及中间画布累计32MP、16384边长、64区域，保留10MiB原件、隔离512MiB/30秒及既有输出/展开预算。像素上限不是所有对象同时解压的内存保证，超出cgroup资源仍失败关闭。

专用API/core仅局部兼容Node24缺少的Map getOrInsert及toHex，不修改全局原型或旧文字层bundle。全像素回归发现上游RGB→RGBA末批处理漏加srcPos，造成23×17样本尾部3像素明显色差；固定锚点补丁替换为有界、尊重TypedArray偏移的逐像素转换，损坏短样本也拒绝。不存在用隐藏告警或放宽像素阈值修复错误的处理。

受控启用必须同时配置`createBrokerService({...,pdfVisualWindows:true})`与`createBrokerClient(socket,{pdfVisualWindows:true})`（或broker CLI `--pdf-visual`），并声明模型图像输入。默认保留旧文字层读取；新协议6为顶层页面游标，归档协议4保留数字visual/tile字段，拒绝路径/额外字段。禁用或工具缺失不能绕过为“视觉已读”。新增能力通过capabilities.pdfPageVisual/pdfTextOnly声明。未启用生产，未操作真实资料迁移或客户端安装。

## 开发验证

```sh
npm run reading:pdf:visual:build
node --test server/reading/pdf-visual.test.mjs server/reading/pdf-visual-clients.test.mjs server/reading/windows.test.mjs deploy/sync/release.test.mjs
node scripts/reading-pdf-visual-linux.mjs /opt/shixu-bcd-test-20261031-pdf-visual
node scripts/reading-image-live.mjs --pdf-visual
```

[开发记录](evidence/pdf-visual-development.json)：像素/安全专项6项通过：0/90/180/270旋转与CropBox全部RGB像素；非4整除宽度/16行末批；多页/区域及ZIP尾件；损坏图像/缺字体明确未读并接续；画布像素门禁/零系统字体；固定工具缺失/hash错拒绝加载。渐进和restart JPEG的全部像素与独立Pillow/libjpeg golden比较，每通道最大差≤3、均值<0.5（IDCT差异）。最初96×60的另一JPEG生成样本自身未通过既有严格JPEG校验，保留拒绝，没有将它宣称为有效兼容证据。

Windows实际AccountWorkspace与实际Page/Node wx签名HTTP，顶层/ZIP/RAR4/RAR5/7z五条停止补传/原件墓碑/全部页面与区域/修订复用/发布链通过；这是Node适配证据，不是原生微信。相关内核/页窗/发布组92项通过，后续补工具缺失回归及真实发布包像素验证另通过；核心97、同步125、build、mini:build/check、官方WXML/WXSS编译及政策检查通过。未开本机窗口。发布包在独立子进程实际执行扫描页并核对全部像素，退出后再清理，避免Windows已加载.node的DLL文件锁；包含运行文件、SBOM、完整许可与MPL对应源码。

[Linux报告](evidence/pdf-visual-linux.json)：独立只读目录、nobody专项和五格式双端链通过；受保护socket/broker的顶层temporary、RAR4 deleted两条链通过，拒绝越权UID。各5/7模拟调用100/140微元，修订复用3/5块。第一轮协议6未接入流式时序帧时零模型调用且时间门禁阻止继续，随后修复并重验。仅在独立测试runtime补齐既有系统librt.so.1，无宿主包安装、无生产修改；原共享runtime保持原样。2048²单页4区域的尾部全像素hash相等，最终单次解析1564.50ms、含传输核对1898.20ms、Node进程峰值190712KiB（包含进程内Skia分配）；非P95、所有边界或生产容量验收。

## 真实模型与保留缺陷

[拒绝报告](evidence/pdf-visual-real-rejected.json)：1次真实调用2588微元，可信usage已结算，输出校验阶段暂停READING_TASK_FAILED，没有发布或自动重试。首次工具未保存原始模型结果，不能从现有证据还原更具体的校验原因；不补造原因，不清零账本。

[发布报告](evidence/pdf-visual-real-published.json)：另一次明确开发诊断调用1次1803微元，合成9537扫描通知经过真实页面渲染，完整像素hash与源通知相等，编号/PDF/学号_姓名/算法复杂度/2026-11-03 16:45及页码/108dpi来源保留。**模型把页尾编号推断成“需写在报告尾部”的硬要求与建议，原件未明确如此要求。** 关键字段字符串存在不代表语义准确性全部通过，该事实依据缺陷继续跟进，不能把本次结果称作完美识别或最终验收。此次补了仅合成开发工具的原始结构化模型结果保留，便于后续离线复现，不在产品中缓存全文或私人输入。

本批真实2次4391微元（¥0.004391），接续累计15次28579微元（¥0.028579），并非全部历史账单。已按同一冻结官方当日空闲价格预留/结算；无unknown、无自动重发或重置历史支出。独立合成账本保留outputs。源码Electron新可见窗口、原生微信/手机/安装版未验。

## 许可及剩余项

[Windows构建清单](evidence/pdf-visual-windows-build.json)记录固定npm包SRI、运行文件和source哈希。构建只使用既有锁定版本，不引入宿主字体或网络数据进PDF。`pdf-canvas-notices.LICENSE`保留发布SBOM中127份registry Rust组件及12份原生依赖的对应许可/版权；缺包级文件的组件补 exact Git notice，Skia源子模块版本固定，Freetype使用FTL选项。四份MPL源crate完整未修改随发布保留，详见[源材料说明](../../server/reading/pdf-canvas-sources/README.md)。第三方许可证不改称仓库MIT。

Office必要图像/对象、未支持PDF资源/字体/批注/高级编码、solid及真正大材料流式、图像事实依据质量、历史投递关联AI、安全回放/正式迁移与真实外部证据源仍有实施工作。继续#73/#69，不据本批宣布B/C/D全部完成，整体验收另行执行。

CI 后续修正：30b82e5 的 Windows/Browser/PR policy 通过；Core 的 WebP 无工具隔离测试遗漏新增 PDF 依赖（非产品解码失败），已补齐复制清单并本机通过。Secret scan 唯一命中为公开构建证据 `api.mjs` 的 SHA256，按历史提交/路径/规则/行号精确记录误报，不排除目录或规则；全历史扫描须在修正头重新通过。
