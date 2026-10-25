# Windows 0.3.15：窗口适配与 DDL 拖动

关联 [Issue #48](https://github.com/HYX-2024-1020/shixu/issues/48)。分支 `fix/windows-layout-ddl`，从 main 3aecd89 开始，独立 checkout 保留其他任务的未提交内容。

整理记录现在有白底黑色描边。主内容滚动区铺满窗口，滚动条固定在窗口右缘；世界内容随窗口增加宽度与卡片列数，最大 1760px，DDL 最大 1280px。保留卡片文字大小和纸黄描边视觉，避免整体拉伸导致文字过大。

DDL 标题和时间栏可像世界卡片一样按下并移动拿起；浮层跟手、周围让位、松手落位，边缘自动滚动，Escape、失焦和窗口改变可取消。完成按钮和核对表单继续正常工作，短按仍可展开核对。日期分区保持，拖动只调整分区内顺序；复用事项 order 和批量保存，不更改截止时间，不移动隐藏分区事项的顺序槽位。

## 验证

- 核心测试 81 项、桌面底层 16 项通过，生产及桌面构建通过。
- 浏览器 Chromium/Edge 与 WebKit 共 46 项通过；原有 Windows 16 套 UI 回归通过，使用独立合成 profile 和模拟模型。
- 新增 `node scripts/desktop-layout-drag-smoke.mjs`：720/1360/1920/2560 宽度、右缘滚动区、实际内容增宽、整理记录白底边框与打开、DDL 拿起/换位/落位、Escape/窗口改变取消、重启顺序及短按展开通过。截图 `release/layout-wide.png`、`release/ddl-drag.png` 已视检。
- 新增检查接入 Windows CI；最终必需检查以 PR 为准。

## 本机更新

用户从托盘正常退出后，将原 profile 完整复制到本机 `.private/before-0.3.15`，再静默覆盖安装；退出码 0，实际 exe 版本 0.3.15，`workspace/state.json` 安装前后 SHA-256 一致。仅复制和校验原资料，没有解析个人记录或向模型发送内容。

- 安装器：`release/verified/Shixu-Setup-0.3.15.exe`，144273203 字节。
- 安装器 SHA-256：`cad17e6f40d204ce61d0b174283e900dec7bda0df3bed72e7aef90c754f09f60`。
- 安装后与打包版 `resources/app.asar` SHA-256 相同：`33744c32b29166303532b1cff56cd11d7e56746fbb6a27bddeb834f0ae917eae`。
- 最终打包版与实际安装版分别通过布局/DDL 拖动专项；实际安装版另通过 DDL 添加/完成/撤销/区间/重启及完成动画/习惯打卡专项，均为独立合成 profile。

重打包时缓存解压目录改名遇到 Windows EPERM，改为从 npm 安装的相同版本 Electron 分发目录复制并生成最终安装包，未更改 Electron 版本或跳过打包验证。

## 双端与回滚

本次明确限 Windows，不修改或发布微信客户端，不调用真实模型。日期/同步协议及个人资料迁移策略保持原样。可重新安装上一版；保留 profile，必要时在退出后用安装前备份恢复。此次为本机更新，不创建公开 GitHub Release。
