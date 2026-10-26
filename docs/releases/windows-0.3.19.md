# Windows 0.3.19：冰冰冰双端本机更新

功能来自已合并 PR #60（Issue #59）。本次用户明确要求更新本机和小程序；交付分支 `chore/ice-client-update`。没有公开 GitHub Release、微信上传审核或服务器部署。

## 功能

双端内置皮肤仅保留鲸鱼娘与冰冰冰。用户冰块图片已抠透明背景；两段用户录屏各截取一声完整「冰冰冰」（1.00 / 0.73 秒，含短尾音）。声音一/声音二可切换并保存，每次点击从头播放一遍，不循环、不叠音。旧预设选择回退鲸鱼娘，个人自定义收藏保留。来源和使用范围见 [素材说明](../../THIRD_PARTY_NOTICES.md)。

## Windows 本机交付

用户从托盘正常退出 0.3.18，确认安装路径旧进程已归零。安装前将原 profile 整体复制到本地受保护目录 `.private/before-0.3.19-20261026-235032/ShixuDesktop`，不解析个人资料或凭据。NSIS 静默覆盖安装退出码 0，实际安装 exe 版本 0.3.19.0。原 workspace/state.json 安装前后 SHA-256 一致；安装后的 app.asar 与打包产物字节摘要一致。

- 安装器 `release/Shixu-Setup-0.3.19.exe` SHA-256：`45f03063b3cbb777730636d8a3d91d980c78283fbc9c45c3ed28c0bd4dbee9bc`。
- 实际安装 app.asar SHA-256：`d4bfbe165067dd9c4f5c692cafd89e71d2616528c76c515df2aee6fa9c4dd057`。
- 打包 exe 的基础/托盘/草稿重启与皮肤专项通过。实际安装 exe 的同两项隔离验证也已通过；不向用户资料注入测试内容。

## 小程序现有工程

现有工程 `shixu-ui-parity-ojIwyw` 的 26 个跟踪运行文件已同步；其中 9 个文件更新，随后逐字节一致性检查无差异。配置和本地资料不覆盖，不清空微信存储，不迁移资料。CLI open 返回成功，但该返回值不证明 IDE 已切换活动工程。

官方 WXML/WXSS/WXS 编译与模板渲染在该工程通过，验证商店有两个预设、两个声音选项及音色选中状态。IDE automation 在 Fetching AppID permissions 时返回 ECONNRESET；按项目 computer-use 限制停止该路径，不用界面自动化重试。用户反馈「编译失败或界面未更新」。后续只读检查发现文件监听进程实际指向 `shixu-baseline/miniprogram`，不是已同步的预览工程；此前对当前工程的判断不成立。旧 checkout 有未提交的 project.config.json 修改，未覆盖或切换该 checkout。基于该新证据仅重试一次 CLI，直接打开 `shixu-ice-skin/miniprogram`；命令返回成功，监听路径仍未切换，已停止重试。用户导入后，文件监听路径现已确认切到 `shixu-ice-skin/miniprogram`，工程选择问题已解决。但用户反馈只显示导航标题「拾序」，随后提示模拟器长时间无响应；原生交付仍未完成。原工程配置及本地资料保留，不迁移测试数据。尚未完成手机真机听音、原生手势或微信上传发布；不把官方编译和 Node 测试称为真机通过。

### 启动故障定位（进行中）

用户报告 `VM13:2 ... getActiveAppWindow`。项目源码及已用自动化 SDK 无该标识；只读检查安装版开发工具 2.02.0 的 app.asar，在 `js/5cd41701460b6113adbf1f8f645cdd15.js` 的 `wrapExecuteScriptCodeForMFR` 找到相同第二行调用 `window.__global.getActiveAppWindow`。该模块 SHA-256 为 `5da64665a0b5262c2dd5ec892bebd88003cb55a88d2868a4a6321bc3cabda538`。这只证明异常脚本由开发工具生成，不能据此排除业务启动诱因，也未修改开发工具安装文件。

隔离 Node 启动探针运行真实页面 onLoad/onShow，使用空资料、100/1000 条合成记录；约 5/18/60 毫秒返回，无异常，空资料 setData 总序列化约 4 KB。该结果不能替代微信原生启动。活动工程切换后基于新证据仅恢复一次 automation 诊断，仍在获取 AppID permissions 时返回 ECONNRESET，已停止该路径；没有回退界面自动化。

当前小程序添加固定文本的 `[拾序启动]` 阶段日志（app 模块、App.onLaunch、首页依赖、Page.onLoad/onShow 与 setData 回调）；不打印资料、凭据或网络响应。76 项小程序测试与官方编译通过。已请用户正常重开开发工具并编译，若仍白屏提供最后一条启动标记，以区分应用代码未进入、启动阶段卡住和渲染通信挂起。尚未得到该证据，不声称根因已修复。

## 验证与回滚

功能 PR #60 已通过 92 项核心、118 项同步/小程序、18 项桌面、62 项浏览器和 17 套 Electron UI 回归及全部必需 CI。本交付重新打包、运行预览同步/PR/双端门禁测试并核对版本、安装文件与资料字节摘要。当前 PR 的必需 CI 单独等待，不复用旧提交检查。

无数据结构迁移。需要回滚时正常退出后重装 0.3.18；个人资料备份保留本地。源码经 GitHub revert 回退，重新同步小程序运行文件，不清空客户端资料。
