# 独立同步后端：私有测试部署

本分支服务归档读取先在对应平台的独立构建目录运行 `npm run reading:archive:build`，再运行发布包构建。需要已有GCC/g++、make（Windows为MinGW g++/mingw32-make）及tar；脚本不安装宿主软件包，下载并核对固定官方源，生成静态x64工具、源码及许可。Windows生成物不能复制冒充Linux工具；缺少匹配工具时服务归档失败关闭，不调用系统7z。发布包按显式清单包含工具和完整修改源，Linux可执行位保留。此步骤不部署、安装或迁移生产，隔离broker仍是必需条件。边界见[归档验证](../../docs/bcd/native-archive-verification.md)。

## 邀请账号版 v3

Issue #40 的账号版必须使用 `install-accounts.sh`，不能用下方旧 v2 安装器冒充账号部署。新安装器会保存原服务 unit、配置和旧单用户数据库备份，停服后备份账号注册表与所有用户数据库，再切换同一个 shixu-sync.service 的入口；失败恢复旧代码与 unit，不删除新旧资料。旧 workspace.sqlite 保持封存，不复制给新账号。

```sh
sudo bash deploy/sync/install-accounts.sh /absolute/path/to/release
curl --fail http://127.0.0.1:8788/api/v3/status
sudo env SYNC_ACCOUNT_DIR=/var/lib/shixu-sync/accounts-v3 node \
  --env-file=/etc/shixu-sync/service.env \
  /opt/shixu-sync/current/deploy/sync/verify-accounts.mjs \
  http://127.0.0.1:8788 --restart-service
```

默认验收不创建 AI 任务，使用两个合成账号验证激活重试、越权隔离、附件下载、幂等、删除恢复、真实重启和撤销；清除测试原文/原件并停用测试账号。微信配置检查可显式增加 `--wechat-config`，只输出是否有效或错误码，不输出 access_token 或 AppSecret；这不等于 wx.login 的真实身份已验收。

`--real-ai` 仅在已经说明用途与预算并配置额度后使用：至多创建一次整理和一次事项对话，每个任务仅一次上游调用，重复提交不会再计费；失败不会自动重发。2026-10-25 本轮预算预留总上限 0.50 元（每任务0.25元），只用合成文本，验证后关闭 AI。token/字节限额仍按配置生效；费用预留不等于供应商账单。服务端明确关闭供应商默认思考模式，避免小输出额度被推理占用，见 [官方参数](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。

后续账号一致性备份先停止服务，再运行 `backup-accounts.mjs DATA_DIRECTORY BACKUP_DIRECTORY --service-stopped`，备份中央注册表与每个用户库并执行 quick_check；环境秘密单独以0600权限备份。不得把正在运行时逐个复制数据库称为跨库一致快照。安装器只绑定loopback，不修改域名、HTTPS、微信域名或防火墙；部署记录见 [本轮验收](../../docs/accounts-deployment-2026-10-25.md)。

此目录由服务器部署工作维护，与桌面、小程序界面分开。当前云端旧固定快照仅验证文字资料同步。云端尚未包含本分支的附件/AI 后台任务、微信登录和正式公网接入；不能用于迁移现有个人资料。

Issue #17 开发分支新增可选文字 AI 队列（`/api/v2/jobs`）；云端旧快照没有该能力。新固定包包含同源生成的 `server/generated/ai-core.mjs` 和任务调度模块，仍然不需要 npm 安装。服务端同时设置 `SYNC_AI_ENABLED=true` 与 `DEEPSEEK_API_KEY` 才启用；默认关闭。调用按配置的模型计费，测试使用模拟模型。重启中断不自动重发计费请求；处理中发生修改的结果保留为冲突。本分支还加入原件上传/下载、去重、校验和数据库原件备份，UTF-8 文字可读取；二进制原件的模型读取和桌面接入仍待完成。详见 [附件说明](../../docs/miniprogram-attachments.md)，完整能力边界见 [双端说明](../../docs/client-parity.md)。

## 构建固定快照

在开发机运行 `node scripts/build-sync-release.mjs`。脚本只复制明确列出的运行文件，不收集 `.env`、个人数据、SSH 密钥、桌面或小程序构建。`release.json` 记录工作区快照指纹及 Git 基准；指纹对应实际文件，不能将 Git 基准误认为全部文件已提交。`SHA256SUMS` 包含文件与清单校验值。不要直接上传整个工作区。

运行 `node --test deploy/sync/release.test.mjs` 验证可启动的发布包、双设备同步、在线备份和恢复。

## Ubuntu 24.04 安装

先检查已有服务、磁盘、内存和端口。安装经过 SHA256 核验的官方 Node.js 24 二进制，并确保 `/usr/local/bin/node` 在系统服务 PATH 中。本服务不需要 npm 安装、Electron、GPU、Redis 或数据库守护进程。

传输并解压发布包到全新目录；先用 `sha256sum --strict -c SHA256SUMS` 验证，再运行：

```sh
sudo bash deploy/sync/install.sh /absolute/path/to/extracted-release
sudo systemctl status shixu-sync --no-pager
sudo journalctl -u shixu-sync -n 40 --no-pager
curl --fail http://127.0.0.1:8788/api/v2/status
```

安装器创建普通系统用户 `shixu-sync`，以 systemd 托管服务并设置 512MiB 内存上限。代码版本保存在 `/opt/shixu-sync/releases/`，`current` 指向当前版本；数据在 `/var/lib/shixu-sync/`；配置在 `/etc/shixu-sync/service.env`（root 写、服务账号读）。随机口令在服务器生成，不输出到日志或发布包。既有配置不会被覆盖；同名 unit 必须匹配新包或当前发布包，否则停止安装以免覆盖未知配置。服务从工作目录以相对脚本路径和 `--preserve-symlinks-main` 启动，避免 Node 入口判断受到 `current` 符号链接影响。

首次只监听 `127.0.0.1:8788`，不修改防火墙或安全组，不开放公网。以 SSH 转发访问：

```sh
ssh -N -L 18788:127.0.0.1:8788 YOUR_SSH_HOST
```

本机访问 `http://127.0.0.1:18788/api/v2/status`。SSH 密钥文件和主机配置保存在开发机用户目录，不进入仓库。

## 云端验收

```sh
sudo node --env-file=/etc/shixu-sync/service.env /opt/shixu-sync/current/deploy/sync/verify.mjs http://127.0.0.1:8788 --restart-service
```

脚本注册两个临时设备，以唯一 `deployment-probe-` ID 创建虚构资料，验证 A 新建、B 完成、重复请求、旧版本冲突、真实服务重启及删除恢复。结束后仅清理自己的测试记录并撤销临时设备，不输出口令和设备 token。此操作会短暂重启服务，只适合当前独立测试环境。

## 一致性备份

```sh
sudo node /opt/shixu-sync/current/deploy/sync/backup.mjs /var/lib/shixu-sync/workspace.sqlite /var/backups/shixu-sync
```

使用 SQLite 在线备份 API，包含已提交的 WAL 内容；创建新目录，执行完整性检查并记录 schema、epoch、sequence，不覆盖已有备份。备份含资料及设备授权摘要，应限制访问。旧云端快照的备份只覆盖文字数据库；本分支将原件 BLOB 一并存入 SQLite，在线备份和恢复测试已核对二进制内容。这不包含客户端本机资料、运行配置或整个产品。参考 [Node.js SQLite backup](https://nodejs.org/download/release/v24.20.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options)。

升级时安装器会先备份；健康检查失败后只尝试退回前一个代码版本。此步骤仅适用于当前未迁移的相同数据库 schema；以后存在迁移时必须先评估恢复路径。恢复演练应在独立数据目录与端口运行，不能直接覆盖正在使用的数据库。恢复旧备份后还需处理同步 epoch、未同步操作和设备重新核对，不能直接宣称资料一致。

## 下一步

- 两端与后端共同确定协议与数据字段，完成附件、模型任务与全量往返验证。
- 域名、HTTPS 和小程序服务器域名准备好后，再单独配置正式接入。
- 正式使用前增加定时备份、异机副本、容量监控与恢复验收。

不把“SSH 已连接”“服务已运行”视为电脑或手机已同步；各阶段分别记录证据。
