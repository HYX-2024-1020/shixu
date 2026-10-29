# RAR/7z安全元数据与联合读取

2026-10-29，基线fbae6b4，Refs #73/#69，Draft #74。本批为非solid RAR5/7z的联合增量，整个归档及BCD仍未验收。

已有7zip-bin-full26.4.1实际携带7-Zip26.04。官方[26.05发布](https://github.com/ip7z/7zip/releases/tag/26.05)已存在并说明修复问题；本轮核实后固定当前版本，不自动安装宿主软件包。已有Windows MinGW g++/mingw32-make及隔离ECS g++可用，编译仅在独立开发目录，不改生产或既有runtime。

已复现：项目合成ZIP同时有`a\nb.txt`与`a_b.txt`，官方普通`l -slt -sccUTF-8`把两项均显示为`Path = a_b.txt`。因此不能把CLI文本列举直接当原路径，更不能将旧桌面parseListing搬到服务作为安全预检。[独立证据](evidence/native-cli-names.json)。官方[StdOutStream.cpp](https://github.com/ip7z/7zip/blob/26.04/CPP/Common/StdOutStream.cpp)的Normalize_UString会把LF替换下划线，技术列表也调用该函数，见[List.cpp](https://github.com/ip7z/7zip/blob/26.04/CPP/7zip/UI/Console/List.cpp)。

已从官方26.05完整源构建独立reader工具：新增仅供技术列表的原路径属性，绕过系统分隔符转换，逐原始宽字符固定宽度十六进制编码；解压本身保留上游实现。适配器严格解码及预检全部条目，然后仅stdout读取允许条目，不落成员文件。源tar.xz固定SHA-256 `0b6080b8c3e7a579161d2d495224c0e51c467576cb4c7048b0ab485ef44cc22e`，保留可复核修改与完整源码/许可，生成物不提交Git。不接受系统工具/环境路径/调用者命令回退。缺少匹配平台、协议、源或工具hash时明确失败关闭。

保持既有1000条/UTF-8路径512字节/深度16/单条与累计100:1/总64MiB展开/嵌套0层，以及worker无网络无凭据、512MiB/CPU50%/30秒/受限tmpfs。拒绝加密、链接/设备/重解析、多卷等不能证明安全的特性；实际stdout字节数/hash/CRC终态核对，不信宣称长度。归档本身及Office内部共享展开额度。PDF等子材料保留原读取限制及明确未读范围，不冒称任意大归档或ZIP内PDF窗口已完成。

服务reader继续只在broker隔离中运行；Windows源码Electron、Node Page、普通UID、真实隔离各自验证。通过同一材料/任务/账本/同hash恢复/双端来源管线接入，不另起平行实现，不用本地OCR或真实模型。7-Zip源/二进制许可证包含LGPL及unRAR限制，不因npm包装MIT而称全部MIT。模型历史10元余量未知，新增真实调用保持0。

另用合成RAR5 NUL原名复现：上游`SetFrom_CalcLen`会在展示之前截断，因此只修显示层不足以可信。构建补丁在该入口拒绝原始NUL；工具非零退出时整个列表无效，不接受已列举安全前缀。LF/穿越/反斜线/重复名/1001条目录同样整包拒绝；CRC损坏的成员不接受stdout前缀，后续安全成员仍可继续。目录、emoji、`@`/通配符/前导短横线名用literal include核对，成员名从不成为裸命令参数或listfile。

## 质量、恢复与平台证据

独立规格合成的TXT/CSV/DOCX/XLSX/PDF/未读图像/尾部混合材料核对全部正文、顺序、Unicode范围、唯一来源、坐标与遗漏，不只验非空。另读取libarchive固定压缩RAR5二进制样本，按上游公式逐字节核对1200字节；包内.bin仍不作为文本模型材料。许可与固定hash见[第三方说明](../../THIRD_PARTY_NOTICES.md)。

Windows完整读取165项通过；最后收紧未知solid/加密门禁及固定7z时间元数据后仅补受影响10项，不重跑无关绿灯。核心93、同步/小程序125、桌面数据18、release4、个人服务1、门禁8、网页与桌面构建、15生成文件、92浏览器及官方WXML/WXSS编译通过。17套源码UI分批完成：首次皮肤视频自然结束事件超时，其余首批通过；空闲后仅补皮肤及未运行的后五套，全部通过，未改产品代码。该瞬时超时不声称不存在，也不跳过CI。

源码Electron两个新增专项各3次模拟模型调用，实际上传/停止继续/temporary清理补传/发布/重载路径和遗漏/离线锁通过；Page/签名HTTP跨修订恢复复用通过。[Windows分层证据](evidence/native-clients-windows.json)。Linux普通UID显式可遍历cwd运行10项；真实broker分别验证temporary过期RAR5和deleted墓碑7z，同hash核验、停止/重启/复用/发布/两端结果与来源一致，每链4次模拟调用、80微元合成消费，跨修订复用2块且只新增1次调用。[Linux联合证据](evidence/native-clients-linux.json)。墓碑/期限/额度/下载权限不复活，累计账本及根水位不重置。

固定约565KiB长混合材料每格式5次最近秩测量，最终RAR5 P50/P95 775/792ms，7z 738/847ms。每次比对完整material和独立全文SHA-256/尾部；7z写入器关闭时间元数据，重生成字节一致。最终证据Node worker最大RSS85508KiB，**不含原生子进程单独RSS**；二者仍共享原有512MiB cgroup，未宣称这是总进程峰值或生产/模型SLO。[最终隔离质量/性能](evidence/native-isolation-final.json)。[早期基线](evidence/native-isolation-baseline.json)来自NUL修正前工具，仅记录演进，不混算或当最终安全证据。[双方构建hash/编译器](evidence/native-builds.json)保留差异。Windows GCC16上游array-bounds诊断仅保留为警告，其他警告仍为错误；Linux静态NSS链接警告保留，最小根执行已实证。

## 剩余边界与回滚

旧RAR4原路径/编码、solid逐成员压缩比与共享块预算、多卷、加密、缺少可信CRC/压缩大小的特性明确unsupported；不降安全限制来“全格式支持”。图片模型/扫描PDF、归档内PDF页窗口、更大归档流式及原生微信/手机/安装版仍未完成。正式迁移/备份介质擦除/生产启用与E/F另验。代码可revert；已消费、删除和撤销只能前向修复，不能用旧资料回退安全账本。自身必需CI最终状态用PR评论补充，整体保持Draft。
