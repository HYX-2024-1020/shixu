# 现有ECS上的拾序静态网站

本目录只配置独立静态网站，不反代8788/8790/8791，不读取账号库、用户资料、模型凭据或控制台会话。业务服务保留原回环监听及受保护连接。

## 前提

- 根域名及www的A记录已指向当前ECS；安全组允许TCP80/443。
- Ubuntu官方源已安装certbot。证书覆盖两个域名，位于 `/etc/letsencrypt/live/shixunote.top/`；私钥留服务器，不打包、不下载、不输出。
- 从固定checkout的最新主线建立独立分支，并通过 `npm run workspace:check`、站点检查及适用PR流程。

## 发布

1. 将明确提交中的 `website/public/` 和本目录的 `nginx.conf`、`install.sh`、`renew-hook.sh` 打包。发布目录结构为 `public/` 加三个部署文件；不包含仓库其他目录或环境文件。
2. 上传到 `/srv/shixu-site/releases/site-<完整40位提交>/`。核对包与文件SHA-256，文件和目录分别为0644/0755。
3. 在该目录以root执行 `sh install.sh`。安装器仅在缺少nginx时从系统软件源安装，备份旧网站指向/配置及发行版默认站点链接；独立配置、语法检查并启用nginx。不会重启拾序业务服务。
4. 证书最初若由standalone方式签发，网站启用后执行 `certbot reconfigure --cert-name shixunote.top --authenticator webroot --webroot-path /srv/shixu-site/current --non-interactive`。该命令进行实际暂存CA续期验证，成功后保存webroot方式；失败时不能宣称自动续期可用。
5. 验证 `certbot.timer` 已启用且active，续期部署钩子 `/etc/letsencrypt/renewal-hooks/deploy/shixu-site` 可运行并通过nginx语法检查/平滑reload。

nginx只把两个指定域名用于网站；其他HTTP Host不提供内容，其他TLS SNI拒绝握手。www只允许读取静态路径，未知路径（含/admin、/api）返回404；没有单页应用回退或业务代理。静态页面不设Cookie，不加载脚本/第三方字体，关闭常规访问日志，错误日志供运维排查。

## 真实验证

- 外部验证HTTP及根域名308到www HTTPS；首页、使用指引、隐私页和图标200且内容/指纹一致。
- 标准信任链及SAN/到期日正确，HTTPS读取不跳过证书校验。
- /admin/、/api/和/.env返回404，POST不可用，未知Host不提供网站内容。
- 原三个业务服务active，PID/启动时间和回环监听保持，既有客户端/管理入口继续使用。
- 记录首次实际开通的北京时间、来源提交、打包/资源指纹及续期结果。以真实开通证据填写表单，其他负责人材料由本人在官方平台核对。

## 网站回退

保留发布目录及 `/srv/shixu-site/backups/`。回退时仅将 `current` 切回已记录的旧网站目录，并恢复对应站点配置、通过 `nginx -t` 后reload。首次部署如需关闭网站，仅停止nginx，保留证书及源码证据；不停止拾序业务、不回滚账号资料或账本。安装异常时保留现场和备份，不递归删除发布目录。
