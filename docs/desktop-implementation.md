# 桌面实现入口

2026-11-21，桌面看板试用继续使用 [Draft PR #129](https://github.com/HYX-2024-1020/shixu/pull/129)。主程序「看板」选择视图，右上打开对应浮窗，侧栏管理规划和浮窗设置。拾序原有亮黄、紫色、描边和贴纸感继续用于试用布局。小条以单行收纳和勾选为主，窄栏提供短期、长期和子事项编辑。浮窗标题条可自由拖动，拖边或角调整尺寸，设置里可分别调整缩放和字号。资料卡可拖动与改显示名，原件由 Windows 默认应用打开，浏览器可下载。收到用户明确认可后再收尾合并。

看板外观反馈迭代将浮窗的描边及四角放进独立的不缩放外框，标题栏和内容继续随界面缩放。紧凑卡片采用「世界」现有的粗黑边、硬阴影、黄色事项、紫色计划和粉色逾期标签。


看板试用第三轮统一小条完成勾选、独立删除与恢复，为完成、编辑、切换、收起、资料排序等操作配套动画。主窗可设置卡面颜色，透明度作用于彩色标题面及内容面。重新打开现有浮窗会将其带到前台并沿用置顶设置；DDL 卡片按同一网格等宽等高。


2026-11-15管理台/云端新增平台承担未知费用结案，#127 / PR128。原ECS与原控制台0.3.30已部署及用户本人原生更新，无包身份物理核验45文件/原入口/运行指纹通过；专用账号28172微元用户风险释放、已消费不变、告警实际结案，原unknown及独立审计保留。Windows用户客户端0.3.29/d4365e4 EXE/ASAR和快捷方式未变。[分角色来源、验证与实际交付](project-continuity/platform-cost-resolution-20261115.md)。下文第三轮0.3.29部署为上一阶段历史。

2026-11-15源码、原ECS及实际Windows/原管理台0.3.29，#125 / PR126。卡片冲突直达、原件缩放、账号内AI新建/拆分及服务端一次确认、移除新合并、告警直接处理、存储真实回执、媒体Range和两款新皮肤已实现。产品源d4365e4，前一验证/文档头六项CI成功，真实合成拆卡通过。用户完成联合更新及原两入口打开；无包身份物理核验真实EXE/ASAR、44文件、原入口和运行指纹通过。[实施与限制](project-continuity/acceptance-round3-repair-20261115.md)。功能集中体验待反馈，下文0.3.28是上一已安装基线。

2026-11-14源码及原云端升级0.3.28/08d38fa，六项必需CI成功，合成服务闭环无新增模型调用。用户已运行Windows/原管理台联合更新器，无包身份只读核验44文件、真实EXE/ASAR、原入口和运行指纹通过，功能体验仍待。[稳定性记录](project-continuity/acceptance-stability-20261114.md)分别记录源码、包来源、验证、部署与用户体验。

上次已交付源码版本 **0.3.28**，Electron 45 + React/TypeScript，复用 `shared/` 的整理、关联和用量逻辑。Windows/原管理台的既有原入口和物理核验保留，功能集中复验已暂停。公开Release仍为0.3.8，上一轮记录见[0.3.27整改](project-continuity/acceptance-round2-repair-20261113.md)；本轮按上方稳定性记录接续。下方历史入口继续保留，不能用源码版本替代物理安装证据。

- 入口与生命周期：`desktop/main.cjs`，独立窗口、托盘、退出前草稿保存。
- 安全边界：sandbox/contextIsolation、受限 IPC、静态协议路径校验、外部网页交给系统浏览器。
- 数据、原件与备份：`desktop/storage.cjs`、`backup.cjs`，专属 profile、原件去重、最近删除与一致性保护。
- 文件处理：`archive.cjs`、`office.cjs`、`src/bucket/ingest.ts`；明确返回覆盖说明，代码只作文本，不执行宏或脚本。
- 当前 UI 与皮肤：`src/bucket/`，卡片原位开合、长按排序、本次投喂与皮肤共用当前桌面基线。
- 绯樱狐使用同一时间轴的30fps透明视频与Opus原声，不另开音频播放器；`shixu:`本地资源协议启用`stream`，媒体通过既有路径校验后由`desktop/media-response.cjs`按实际字节响应GET/HEAD和Range，其他静态资源仍用`net.fetch(file:)`；未增加外部网络能力。协议标志含义见[Electron官方文档](https://www.electronjs.org/docs/latest/api/protocol)。
- 验证：`test:desktop` 与 `test:desktop:ui`（当前套件以package.json和CI为准）；`SHIXU_PACKAGED_EXE` 可指向实际 exe，使用隔离 profile。

详细目录见 [架构](architecture.md)，操作命令见 [开发指南](guides/development.md)。[历史日志](archive/desktop-implementation-2026-10.md)仅供追溯，实际发行验证见 [0.3.8](releases/windows-0.3.8.md)和对应 Release 报告。

- DDL：`src/bucket/DDL.tsx` 与 `shared/deadlines.mjs`，小程序共用解析/分区函数；见 [DDL 实现记录](ddl.md)。

  0.3.9本机安装与微信工程的早期记录见[交付记录](releases/windows-0.3.9.md)；后续版本见[当前入口](current-baseline.md)，旧机器状态不作为继续开发依据。
