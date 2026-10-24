# 独立同步后端：私有测试部署

此目录由服务器部署工作维护，与桌面、小程序界面分开。当前运行的是开发中的 `server/sync-server.mjs`，只验证文字资料同步。附件、AI 后台任务、微信登录和正式公网接入尚未包含；不能用于迁移现有个人资料。

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

使用 SQLite 在线备份 API，包含已提交的 WAL 内容；创建新目录，执行完整性检查并记录 schema、epoch、sequence，不覆盖已有备份。备份含资料及设备授权摘要，应限制访问。当前只覆盖文字同步数据库，不代表附件和整个产品已备份。参考 [Node.js SQLite backup](https://nodejs.org/download/release/v24.20.0/docs/api/sqlite.html#sqlitebackupsourceDb-path-options)。

升级时安装器会先备份；健康检查失败后只尝试退回前一个代码版本。此步骤仅适用于当前未迁移的相同数据库 schema；以后存在迁移时必须先评估恢复路径。恢复演练应在独立数据目录与端口运行，不能直接覆盖正在使用的数据库。恢复旧备份后还需处理同步 epoch、未同步操作和设备重新核对，不能直接宣称资料一致。

## 下一步

- 两端与后端共同确定协议与数据字段，完成附件、模型任务与全量往返验证。
- 域名、HTTPS 和小程序服务器域名准备好后，再单独配置正式接入。
- 正式使用前增加定时备份、异机副本、容量监控与恢复验收。

不把“SSH 已连接”“服务已运行”视为电脑或手机已同步；各阶段分别记录证据。
