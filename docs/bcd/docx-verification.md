# B/C/D DOCX 联合增量

2026-10-28，继续 [#73](https://github.com/HYX-2024-1020/shixu/issues/73)、Draft [#74](https://github.com/HYX-2024-1020/shixu/pull/74)，起点7d658ab。账号增量的[必需CI](https://github.com/HYX-2024-1020/shixu/actions/runs/40632470213)与本地92项浏览器已通过；新增格式须以自己的提交核对CI。B/C/D整体保持未完成。

## 已接入闭环与质量边界

服务端校验DOCX原字节、哈希、大小，在原有受限Linux worker内读取，无网络、凭据或Word自动化。正文按XML逻辑顺序保留段落/run空白、Unicode、tab/换行、表格行列及合并跨度；相关页眉/页脚/脚注/尾注/评论保留part与段落/注释坐标，作为独立story追加，不冒充版面页序。长段落、很多段落继续进入120000窗口与模型批次，不剪尾部；任务数据库不存提取全文。

尚非完整Word版面还原。主正文仅支持标准`word/document.xml`；非标准主part、ZIP64及加密容器明确拒绝。图片、公式、嵌入对象、文本框、AlternateContent和未关联story列未处理；外链不访问、动态域不执行，列表编号未还原时保留文字并标部分，修订明确待核对。不会把外部或未关联XML当正文。损坏尾部前的完整段落仍可处理，完全不可读不调用模型、不扣费。

复用v4任务、预算、停止恢复、原子发布与分页。双端共用四态、遗漏原因和来源坐标。Windows源码Electron实际按钮完成上传→停止→继续→发布→重载→材料面板提示，`--docx`专项加入CI。小程序实际Page/HTTP与Windows签名客户端完成跨设备操作、结果/覆盖一致及详情来源/遗漏断言；官方wcc/wcsc与模板渲染通过。原生微信IDE、真实微信身份、手机、安装版未验证。

## 依赖、权限与安全

直接固定`sax@1.6.1`（此前已是构建工具传递依赖），BlueOak-1.0.0；原许可随`docx-reader.LICENSE`分发。候选saxes上游已归档，未引入为新依赖；旧Office模块自身的saxes传递依赖仍存在。依据[sax官方说明](https://github.com/isaacs/sax-js)启用strict/xmlns/strictEntities，禁DOCTYPE/ENTITY、不获取DTD，深度128。npm审计当次无已知漏洞，不代替边界验证。

结构依据[Microsoft WordprocessingML说明](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document)。Node24内置zlib/CRC32处理ZIP：预检中央/本地头、重复名、重叠输入范围、路径/链接属性、方法/加密；最多1000条、总展开64MiB、单条/累计压缩比100:1，实际inflate输出仍限量，校验长度/CRC。内存解包，不写条目路径；高压缩正常文件也可能受安全上限拒绝，明确报告而非截断。

DOCX源码与sax打成约31KiB独立CJS，CI核对生成结果及许可，release自包含，不需新原生库/运行时npm安装。TXT/CSV按需路径不加载DOCX bundle。broker新增CJS代码的root所有/不可写权限检查，仍不授应用sudo/systemd-run或任意worker参数。覆盖穿越/链接属性、加密标志、宏、DTD、炸弹、伪造长度/CRC、实际展开超限、错误XML根、孤立story、长材料/部分失败；Office宏/域不执行。DOC/XLS和嵌套包继续unsupported。

## 实测

[结构化测量](evidence/docx-benchmark.json)：独立Linux/Node24.20.0、同一只读最小runtime、CPU50%/512MiB；6份TXT/CSV基线与当前各5次，加3份DOCX各5次，共75次。最近秩P95在5次时即最大值，不是稳定容量估计；每次比对独立完整文字hash及全部来源/结构golden。

| 样本 | 基线隔离P95 ms | 当前隔离P95 ms | 当前worker峰值RSS KiB |
| --- | ---: | ---: | ---: |
| 小TXT | 196.9 | 179.1 | 53,056 |
| 中TXT | 188.8 | 262.8 | 61,964 |
| 长TXT 7,980,021字节 | 794.7 | 724.0 | 102,988 |
| 多行CSV | 295.0 | 303.6 | 64,488 |
| 密集CSV | 441.1 | 375.9 | 64,784 |
| 损坏CSV | 181.8 | 187.0 | 50,500 |
| 小DOCX | — | 212.1 | 54,344 |
| 长DOCX/1504片 | — | 548.5 | 79,768 |
| 损坏DOCX | — | 212.9 | 52,036 |

首轮观察多行CSV约791ms，定位格式模块提前加载后改为按需bundle；调度、冷启动/配额与5样本极值仍有波动，不能把791→304当作精确因果或全面提速。中TXT反而慢约74ms，保留退化。最终测量在关系校验修正后采集，之后只补连字符/加密识别等不涉及这些样本的分支。

[Linux联合链路](evidence/docx-loop.json)：普通UID65534经受保护socket上传701,350字节DOCX→真实隔离→模拟模型→跨设备停止/继续→原子发布→Windows签名HTTP/小程序Page一致。4次模拟调用、80微元合成费用、2次解析（停止清全文后重读），尾部进入批次；约2.22秒是一次观察，不是P95。非法UID和probe注入仍拒绝，临时输入/socket退出清理，生产未改。

新内核/账号/格式51项、同步/小程序124项、核心93项、release4项通过；Windows读取/任务/账号及新增DOCX源码专项通过。DOCX专项初次误用无附件卡片按钮名，后又匹配重复说明，改用实际材料入口与精确遗漏行后通过。官方编译不等于原生微信操作。固定样本均合成，无私人原件或真实供应商语义验收。

## 继续未完成

图片识别、XLSX、PDF/扫描长PDF、ZIP/RAR/7z待各自C/D闭环。真实模型既往预算未核实，本批调用0次，不能称跨任务累计0元。正式多库迁移/独立安全水位、500MiB逻辑配额/整次temporary/30+7、投递7天与单项30天、跨块语义合并/root、安全重试/维护超时排空仍待交付。reader版本变化使旧输入修订不能直接复用，生产启用仍需迁移/核对；E/F与正式开放独立跟踪。
