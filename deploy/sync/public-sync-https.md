# 拾序同步公网入口

[#133](https://github.com/HYX-2024-1020/shixu/issues/133) 使用 `sync.shixunote.top` 连接现有 ECS 的用户服务。Nginx 只将 `/api/v3/` 和 `/api/v4/` 转发到 `127.0.0.1:8790`，保留 Windows 签名校验所需的原请求目标。管理台继续通过既有受保护连接使用 `127.0.0.1:8791`。

## 部署

1. 核对同步子域名的权威 A 记录与 ECS 一致，并确认官网配置及用户、管理 API 的回环监听。
2. 创建 `/var/www/shixu-sync-acme/.well-known/acme-challenge`，在服务器的 `sites-available` 安装 `nginx-public-sync-http.conf` 为 `shixu-sync-http.conf` 并在 `sites-enabled` 启用。运行 `nginx -t` 后重载，确认公网能访问 ACME 目录下的测试文件。
3. 执行 `certbot certonly --webroot -w /var/www/shixu-sync-acme --cert-name sync.shixunote.top -d sync.shixunote.top`。证书单独续期，现有 Certbot 部署钩子会校验并重载 Nginx。
4. 安装 `nginx-public-sync-tls.conf` 为 `shixu-sync-tls.conf` 并启用，运行 `nginx -t` 后重载。验证 HTTP 跳转、HTTPS 证书、`/api/v4/capabilities` 返回 200、未登录的 `/api/v4/changes?cursor=0` 返回 401，以及 `/admin/` 和 `/api/admin/health` 返回 404。复查原官网和管理监听。
5. 如需回退，移除 `sites-enabled` 中这两个同步站点链接，运行 `nginx -t` 后重载。官网链接和证书保持原样。

## 2026-11-21 联调起点

权威 DNS 和公共递归解析返回现有 ECS 的 A 记录。独立证书、HTTP 跳转、用户 API 与管理路径隔离均已验证。官网原 Nginx 配置哈希与上线前一致，根页面和使用指引返回 200。验证时 Windows 默认 DNS 曾返回否定结果，使用已经核对的 A 记录指定连接地址仍通过严格 TLS 校验。

v4 沿用同一 AppID 的既有微信凭据。向微信核验凭据后，只补入 v4 的微信登录配置，并在无在途任务和模型调用时重启该服务以加载配置。v4 报告微信登录可用。通过公网 HTTPS 完成隔离账号的 Windows 签名注册和临时设备撤销。测试账号已独立暂停 AI，建号后账本记录零模型调用。

当前小程序源码为 `2b3d294`，共享资源检查、官方 WXML/WXSS 编译、83 项 Node 回归和开发者工具预览构建均通过。真机登录、双向新增、交叉编辑、两端重开和 PDF 对端实际打开须在真实客户端记录。双端互通通过后再重写小程序前端。

## 真机验收步骤

用独立资料目录启动已安装的 Windows 0.3.31。小程序扫码进入开发者工具生成的预览。两端登录同一隔离账号后，在 Windows 新建测试事项并附合成 PDF，在微信新建另一事项。两端各确认收到对方的事项，再分别从对端修改日期和完成状态，关闭并重开两端核对结果。在手机打开 Windows 上传的 PDF，并在验收前后核对该账号的模型调用记录。本轮隔离账号已暂停 AI。
