# 云端同步测试后端：2026-10-24 部署记录

## 当前结果

已通过 SSH 登录用户提供的阿里云成都 ECS，并部署独立文字同步测试服务。电脑端、小程序的真实客户端接入、个人资料迁移和公网发布尚未完成。本记录可供后续两端开发工作读取，不需要重新查找服务器或创建另一套后端。

服务器核验：Ubuntu 24.04.5 LTS，x86_64；系统可见内存约 1740MiB；根盘 40GiB、可用约 35GiB。初次检查只有 SSH 监听公网，没有已有网站或应用。安装了从 Node.js 官方 HTTPS 地址下载、经 SHASUMS256 校验的 Node.js v24.20.0；运行时在 `/opt/shixu-runtime/`，`/usr/local/bin/node` 为链接。

## 连接与服务

- 当前开发电脑已配置 `ssh shixu-ecs`，登录用户为 root。该连接用于运维，应用进程以非登录普通用户 `shixu-sync` 运行。
- 专用 SSH 私钥仅在本机用户的 `.ssh/` 目录；服务器已由用户通过阿里云远程终端添加对应公钥。密钥、访问口令均不进入源码或发布包。
- systemd 单元：`shixu-sync.service`，已启用开机启动及失败重启；验证结束时为 `active/running`、重启计数 0，内存约 18MiB。
- API 仅监听 `127.0.0.1:8788`。未修改安全组或防火墙，没有开放公网 API。
- 代码：`/opt/shixu-sync/current`，指向固定版本目录。
- 数据：`/var/lib/shixu-sync/workspace.sqlite`。
- 配置：`/etc/shixu-sync/service.env`，root 写、服务账号读；随机访问口令在服务器生成，不写日志。
- 备份：`/var/backups/shixu-sync/snapshot-OKB3na`，已检查 SQLite 完整性并在隔离副本恢复启动。

本机按需建立隧道（命令保持运行期间可访问）：

```powershell
ssh -N -L 127.0.0.1:18788:127.0.0.1:8788 -o ExitOnForwardFailure=yes shixu-ecs
```

另一个终端访问 `http://127.0.0.1:18788/api/v2/status`。这条路径已从当前开发机实测成功，验收用的临时隧道已停止。小程序真机不能把此地址作为正式服务器地址；公网接入需后续配置域名、HTTPS 与微信后台服务器域名。

## 固定发布快照

- 发布 ID：`sync-20261023165925063-aa910b895168`（ID 中的时间为 UTC）。
- 源文件指纹：`aa910b8951689b357b5235869b3671b8e1b9cc377f005969537cc5c0fcd9954f`。
- 归档 SHA256：`45b6577c3475c3016574116e32f58e65b49b3e0b265b240ca3492d0fe2e50dd2`。
- 本机归档：`release/sync-20261023165925063-aa910b895168.tar.gz`（忽略提交）。
- 工作区快照只包含同步服务和部署运行文件；使用文件指纹确认内容，不把 Git 基准视为所有开发内容已提交。部署完成时两个服务源码文件与本机对应文件 SHA256 相同。
- 后端能力：version `0.1.0`、protocol `2`、schema `1`；`textSync=true`，`attachments=false`、`aiOrganize=false`、`wechatLogin=false`。

## 实际验证

1. 现有 `server/sync.test.mjs`：8 项通过，覆盖双设备、离线队列、重放、冲突、删除、恢复、分页、授权及协议边界。
2. `node --test deploy/sync/release.test.mjs`：发布包独立启动、双设备、真实监听器重启、WAL 在线备份、恢复、`current` 符号链接下的 CLI 运行通过。
3. 云端实际 HTTP 验收：未授权读取拒绝、两台模拟设备读写、重复提交不重复落库、旧版本写入冲突、删除与恢复通过。
4. 云端真实执行 `systemctl restart shixu-sync` 后，设备授权与已提交资料仍可读取。
5. 测试只创建唯一 `deployment-probe-` 虚构记录；验证结束后已永久清理该测试记录并撤销两个临时设备授权，保留协议需要的删除标记。没有上传本机个人资料。
6. 在线生成一致性备份后，在 `/tmp/shixu-restore-check-*` 的独立副本以临时本机端口启动，核对 schema、epoch、sequence 与状态接口；未改写原备份或运行数据库。
7. 从当前开发电脑通过 SSH 隧道读取云端状态接口通过。

首次安装暴露并修复了配置权限受 umask 影响、符号链接下 Node 主入口判断和首次失败回退的问题，之后重新构建固定快照并完成上述验收。既有桌面与小程序界面文件未由此次部署修改。

## 后续开发入口

同步核心沿用 `server/sync-server.mjs`、`server/sync-store.mjs`，不要重新部署旧的单用户网页 `/api` 服务来替代 `/api/v2`。当前服务仅用于开发验证，不迁移已有桌面资料。两端接入前先核对协议，随后补齐附件上传、服务端模型队列、设备绑定、完整字段往返和迁移验证；公网接入另行配置。

发布、服务管理、验收与备份命令见 [部署说明](../deploy/sync/README.md)。运行源码变化后需要重新构建、验证并部署固定快照；本机保存代码不会自动更新云端。
