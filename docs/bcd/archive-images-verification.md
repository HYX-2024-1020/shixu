# 归档内 PNG 瓦片与恢复开发验证

2026-10-30，关联 #73/#69、Draft PR #74。接续静态 PNG 与 RAR4，并非 B/C/D 整体最终验收。

## 实施

- ZIP、明确编码的非 solid RAR4、RAR5、7z 内的静态 8 位非交错 PNG，逐成员再逐瓦片处理。使用同一隔离 PNG 解码、1024 像素瓦片和模型输入，不使用本地 OCR。
- 既有纯数字归档游标的 `page` 表示当前成员内 PDF 页或 PNG 瓦片；`base/offset` 对图片计瓦片位置，不冒称 Unicode 字符位置。来源保留原包内路径、唯一 sourceId、图像 hash、完整像素坐标与尺寸。
- 每次仍完整预检外层归档，沿用 1000 条、路径深度/长度、CRC、终态、100:1 和共享 64MiB 展开预算。图片跨瓦片不重复累加外层展开量，图片自身 32MP/边长/64瓦片/512MiB 进程限制不变。
- 服务端核验路径、游标连续性、瓦片坐标、图片 hash、segment/range 一致性；确认付费块后只持久保存覆盖/游标。双端进度按包内图片分别合并，切换到下一成员不丢历史进度。
- 归档图片沿用模型图像能力门禁。未启用时记 `IMAGE_PROVIDER_UNSUPPORTED`，不把占位描述作为原文送模型。停止、补传、删除墓碑、账本与根累计沿现有任务链。
- `READER_VERSION` 的归档部分升为 `archive/4`，防止跨旧读取语义误复用；固定源工具协议保持 2，没有重新构建或更换工具。

## 定向验证

`node --test server/reading/archive-images.test.mjs`：6 项通过。四种格式包含前言、2051×3 三瓦片 PNG、第二张单瓦片 PNG、唯一尾文，逐像素重建等于固定原始数组，核对成员顺序、来源 ID、offset、累计展开量、两张图片进度合并及尾部；伪造游标/尺寸/坐标和混用 PDF 元数据被拒绝。另两项运行真实签名 HTTP、Windows AccountWorkspace 和小程序 Page/Node，覆盖停止晚到、temporary/deleted 同 hash 补传及跨修订复用。

任务/归档组 81 项通过后，新增归档图片的进程内核重建和无图像供应商测试，定向 5 项通过（含已有顶层图片与两条双端链）。`archive-windows` 6 项保持通过；其尾空目录样本改用仍不支持的 JPG，继续验证 unsupported 覆盖不会被尾目录抹除。原生归档/RAR4/顶层图片组 24 项通过。构建/类型检查、mini:build/check、PR/双端政策 8 项、官方 WXML/WXSS 编译通过。最终像素四格式组另在 Linux 普通 UID 通过 4 项。本机没有启动 UI 窗口；远端完整必需 CI 仍执行。

## Linux 独立隔离联调

目录 `/opt/shixu-bcd-test-20261030-archive-images`，复用本任务 RAR4 已验证的 Linux 工具和既有最小 runtime；未安装宿主包、未读取或迁移私人数据。`nobody` 客户端连接 root 所有且禁止普通 UID 改写的 broker，解码运行于原有 systemd/bwrap 资源隔离。命令：

```sh
node scripts/reading-archive-windows-linux.mjs /opt/shixu-bcd-test-20261030-archive-images --archive-images
```

[结构化报告](evidence/archive-images-linux.json)：ZIP temporary 和 RAR4 deleted 各 7 次模拟调用、140 微元，包含停止后的晚到调用以及修订新增文字的 1 次调用；修订各复用 5 个已付费块。像素来源、尾部、删除/临时原件不复活、双端结果和进度一致；无权 daemon UID 和携带路径的游标拒绝。单次链路约 4860 / 5501ms，不代表 P95、压力容量或原生 UI 证据。

## 能力边界

本增量没有新增模型或提示词能力：复用 [PNG 真实 API 证据](image-verification.md) 的相同规范化 PNG 输入路径，无新增真实调用或费用；模拟只证明管线、费用和恢复，不能证明识别质量。累计新增真实调用仍为 1 次、usage 估算 ¥0.002316。

JPEG/GIF/WebP、其他 PNG 编码/色彩、扫描 PDF、Office 图像、跨区域语义合并、solid 和大材料流式仍待实施。原生微信、手机、安装版及本增量可见窗口未验证。完整剩余项见[实施清单](implementation-status.md)；不能写成实施全部完成。
