# 拾序个人项目网站

关联 [Issue #109](https://github.com/HYX-2024-1020/shixu/issues/109)。用户完成个人ICP备案后，授权在现有阿里云主机准备真实网站及HTTPS，再由本人提交公安联网备案。

`public/` 是独立的无构建静态网站：项目介绍、使用指引和访问隐私说明。沿用现有 `public/desktop-icon.svg` 的标识及黄色/黑框视觉，文字和CSS为本项目原创；使用系统字体，没有新增外部图片、字体或统计服务。许可证沿用项目MIT及已有[第三方说明](../THIRD_PARTY_NOTICES.md)，不扩大旧素材授权。

- 当前网站不提供登录、资料上传、公开发布、AI在线处理或私有安装包下载。
- 文字明确Windows正在邀请体验，不将既有客户端功能或测试数写成网站的公开在线功能。
- 服务器根域名与HTTP统一跳转到 `https://www.shixunote.top/`，与ICP登记首页一致。
- 网站不引入运行时应用依赖；不会替换Vite应用、客户端、云端业务或本地管理台。

## 验证

`npm run site:check` 用隔离无身份Chromium检查三页在1440、390、360宽度下的链接、备案链接、横向溢出、脚本错误及无意外外部请求；如需保留截图，执行 `npm run site:check -- --screenshots <输出目录>`。这是代码驱动的隔离页面检查，不控制用户桌面或读取个人浏览器资料。

该检查已接入Browser E2E必需工作流。真实服务器的TLS、重定向、404边界和业务监听仍须独立检查，不能用本地静态预览代替。

## 部署与备案

参见[服务器部署说明](../deploy/website/README.md)及[本轮网站与备案记录](../docs/project-continuity/public-website-filing-20261112.md)。网站上线、源码合入与公安审核是不同状态。
