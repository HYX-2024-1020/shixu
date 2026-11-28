# 宿主写入登记恢复与资料副本到期清理

2026-11-01，#73 / #69，Draft PR #74。B/C/D继续实施，未组织最终独立联合验收。

## 运行底层

新增server/data-control.mjs，根目录独立.data-control.sqlite使用正式data-control组件1、FULL同步、短BEGIN IMMEDIATE事务和不可改删记录，串行协调登记文件、恢复意图/完成、激活和清理。进程退出由SQLite释放互斥锁，不依赖抢占年龄。租约能力对象冻结，不能修改writer模式或资料根来伪造维护权限。accounts-core最低写入版本4阻止旧连接绕过新的恢复屏障；缺失控制结构/保护不在启动时补建掩盖损坏。

每个新登记绑定主机、随机token和真实进程身份。Linux保存boot ID、PID namespace、PID及/proc启动代次；只在同一主机/命名空间解释PID，旧boot或原进程代次已不存在才证明终止。Windows记录实际Process.StartTime的UTC ticks，使用隐藏、无profile的系统元数据辅助进程，普通存在性查询仅发送signal 0，不终止进程。依据[Linux proc文档](https://www.kernel.org/doc/html/latest/filesystems/proc.html)、[Node signal 0语义](https://nodejs.org/download/release/v24.20.0/docs/api/process.html#processkillpid-signal)及[Process.StartTime](https://learn.microsoft.com/dotnet/api/system.diagnostics.process.starttime)。权限不足、跨宿主/namespace或旧登记缺乏身份凭据均失败关闭，不接受请求中的terminated/final布尔值作为证据。

reviewDataWriters/recoverDataWriters仅供独立授权宿主，绑定完整登记快照hash和operation。先证明所有登记进程已终止，再持久写恢复意图，随后核对/移除相同登记并追加证据hash与完成。未完成意图即使登记文件已消失仍禁止新writer/runtime/maintenance；同一操作可继续，其他操作不能覆盖，最终重放不删除后来新进程的登记。预检提供待恢复操作摘要，不暴露资料正文。

这里的真实内核证据仅用于写入登记恢复，**不能**充作某个读取步骤/cgroup已终止、精确活跃时间或供应商未计费证明。独立费用、unknown、额度、根累计及旧动作门禁不变；没有自动继续工作或清除其他审计原因。

新指针格式2额外绑定独立data_activations记录；文件激活收据与控制记录之间中断时不能启动，宿主重新核对完整未打开基线后完成。旧格式1仍按原完整清单/激活链读取，当前schema继续验证；新格式被旧程序拒绝。控制记录中的后继关系也阻止退回旧指针。

## 七天副本清理

- 成功切换会登记被替代的旧根/历史版本全部数据库及hash，七天到期后由排他维护、独立授权宿主调用purgeRetiredData。全部预检后才清理，改写/链接/未关闭WAL拒绝；不删除当前集合、独立账本/安全或指针与审计元数据。
- 旧根注册表原子替换为空的受保护封锁库，清除旧身份、凭据/消费副本而保留最小写入门禁；不能简单删掉accounts.sqlite让旧程序重新创建空账号根。历史版本按精确路径逐文件清除，无递归删除。清理意图在删文件前落盘，部分失败可继续，不复活旧资料。
- 影子开始复制前登记全部计划数据库和manifest路径，准备完成或中途失败均最多保留七天；expired shadow不能激活。purgeAbandonedShadows只处理未提交、未被指针选择的登记影子，清理它自己的数据库、WAL/SHM/journal及manifest；未知额外文件、链接和错误布局拒绝，不能冒称全部清除。
- 首次激活未提交且没有任何独立激活历史时，允许显式recoverInitial从仍保留的封锁源重新建立新影子；只在影子副本移除根封锁标记，不改原根或费用。存在已激活历史时拒绝此路径，不能拿旧根重置新资料。
- 已有停止备份入口始终排除非当前data-versions目录，包括首次激活之前的失败影子。没有新增定时任务、提醒、生产清理或E备份轮换/管理端；这里只提供BCD所需运行原语和合成演练。

文件释放不等于法证擦除。旧页/WAL、操作系统及历史备份残留按原隐私告知和E的最长七天备份规则处理；本批未声称完成备份轮换或整个主机恢复。未被本协议登记的历史目录、缺失可信身份的旧登记仍须受信宿主核对，不按mtime/PID猜测删除或解锁。

## 开发验证与边界

- Windows最终相关联合70项通过，之后仅收紧dangling入口检查和子进程失败等待、增加一项Linux文件symlink检查，最后控制专项35项中34通过，能力对象冻结后17项通过、1项文件symlink测试因Windows权限边界明确跳过。恢复专项7项实际成功：活进程拒绝、真实子进程退出、快照冲突、两阶段中断/重放、旧连接写拒绝和结构损坏不自愈。
- 七天清理8项涵盖边界前后、当前资料/付费结果/1000微元unknown保持、空封锁库、文件改写拒绝、部分清理重放、未提交版本不删当前源、失败影子/sidecar清理、过期拒激活、首次失败后重建和未知额外文件拒绝。时钟及材料均为合成夹具。
- 实际AccountWorkspace与Page/Node wx两条retained/temporary版本切换链通过，协议与身份/发件箱保持；不是原生微信、手机或安装版验证。没有额外本机产品窗口；元数据辅助进程隐藏执行。
- 自包含发布包2项通过，真正加载新控制/迁移模块并执行全集切换和七天旧根清理，旧未核对账号钱包仍为0条；原有读取/对话/语义/关联及备份链保持。同步125项通过。
- Windows阅读全套514项在最后Win32出生时间、dangling symlink和新增三项保护测试之前通过；后续相关结果如上。没有把较早全套结果写成最终全部源码已全套通过。提交自身完整CI另核对。
- Linux普通UID先联合63项、后更新进程身份/保护测试联合66项通过；最后源码35项均通过，暂存扫描将未提交的合成口令判为疑似密钥后改成明显重复fixture文本，两平台对应8项再次通过，[证据](evidence/data-control-linux.json)；只使用独立测试树，不安装宿主包或操作生产/真实资料。
- 开发中最小封锁库最初未声明历史可选索引兼容项，导致实际AccountRegistry拒绝schema；补齐相同版本契约后通过。静态审查补了首次激活失败与死维护登记形成锁循环的回归，以及文件收据/独立激活记录间的故障点。保留旧失败，不关闭保护或自动修补坏结构；合成夹具误报在提交前改值解决，没有新增扫描豁免。

复现：`node --test server/reading/data-recovery.test.mjs server/reading/data-retirement.test.mjs server/reading/data-versions.test.mjs server/reading/data-versions-clients.test.mjs`，再执行适用schema/关闭/发布包/同步检查。

新增真实API为0；接续累计33次usage估算60148微元（¥0.060148），不是全部历史或最终账单。没有新提示词或真实质量/性能结论；实际PID复用、跨boot和物理断电未演练。完整账号/删除/撤销独立安全重放、真实最终账单、逐步骤宿主终止/活跃时间及其余格式/流式能力仍需实施。生产部署、真实资料迁移、安装、E/F与最终独立整体验收未执行。
