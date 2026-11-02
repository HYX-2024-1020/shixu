# 当前成果与接续入口

更新：2026-11-02，北京时间。整理任务 [#81](https://github.com/HYX-2024-1020/shixu/issues/81)。本页提供当前入口；历史日志是证据，不自动形成开发授权。

**当前只整理、核对与保存成果，功能开发仍暂停。这是修正推进方式，保留并复用已有工作，不重开产品。** 拾序帮助大学生管理学习、通知和任务，保持轻量，支持小范围非商业分享；重心是好用、AI分类和命名、美观与流畅、云端资料可靠，解析覆盖服务于这些目标。

## 接续阅读顺序

本机日常开发固定在shixu-governance/，其他旧checkout只供参考；先读[固定位置与保留旧修复](project-continuity/local-workspace.md)。单一工作路径仍按任务建立独立分支，不在main开发，不从旧目录构建或送达。

1. [AGENTS](../AGENTS.md)与[贡献流程](../CONTRIBUTING.md)：保护未提交内容、分支、验证、PR与双端规则。
2. 本页及[成果复用与推进约束](project-continuity/README.md)：方向、模块、依赖及停止条件。
3. [本地与远端盘点快照](project-continuity/inventory-20261102.md)：worktree、全部本地分支、PR和开放Issue。
4. 具体任务的源码和专项证据。开始前重新获取Git和远端状态，快照不是实时状态。

## 当前基线不是一个版本号

| 层次 | 已核对内容 | 边界 |
| --- | --- | --- |
| 主线源码 | 整理起点 `origin/main=e04a8d6`；双端DDL、账号/同步、赛璐璐卡片、角色、应急网页及滚动修正 | 源码合入不等于部署或手机通过 |
| Windows本机交付记录 | 最新为[0.3.23](releases/windows-0.3.23.md)，含绯樱狐单播放器音画同步 | 本次未重新核验安装程序；不能证明手机浏览器无问题 |
| 公开下载 | 本次GitHub最新Release核对仍为[v0.3.8](https://github.com/HYX-2024-1020/shixu/releases/tag/v0.3.8) | 不含0.3.23或B/C/D |
| 应急手机网页 | [管理员测试版](guides/admin-test.md)，#76/#77/#79：独立浏览器本地资料、直连模型、备份 | 用户正在用且反馈UI/文字/音画问题；不是云同步客户端或B/C/D部署版，本次未复现/修复 |
| 微信小程序 | 主线有卡片折叠、排序、详情、附件与角色，以及工程送达和官方编译记录 | 当前IDE工程是否最新、原生交互、手机真机与公开发布仍须分别核对 |
| 服务器 | [2026-10-25记录](accounts-deployment-2026-10-25.md)为受控v3账号服务，回环监听，记录中AI关闭 | 本次未SSH核查实时服务、域名或配置；不能声称v4已部署 |
| A设计基线 | [#72](https://github.com/HYX-2024-1020/shixu/pull/72)已合入aad1903；[契约与资源](stage-a/README.md) | 设计和演练不等于运行接线、正式迁移完成 |
| B/C/D成果 | [Draft #74](https://github.com/HYX-2024-1020/shixu/pull/74)，165487a；59个提交、525个文件差异；隔离读取、任务/费用、账号原件及迁移底层 | 保存远端、未合并；未整体验收、未安装或部署，亦未弃用 |
| 原方案 | [Draft #70](https://github.com/HYX-2024-1020/shixu/pull/70)，da28c1f；[总清单 #69](https://github.com/HYX-2024-1020/shixu/issues/69)保留 | 清单不等于连续开发队列，历史未勾选不代表全无实现 |

## 必须保留的事实

- #70与#74未合并。方案在[da28c1f固定文件](https://github.com/HYX-2024-1020/shixu/blob/da28c1fbf76a0e7c5aae15228d25ecef6cca3ad9/docs/server-client-plan-2026-10-28.md)；B/C/D证据在[165487a入口](https://github.com/HYX-2024-1020/shixu/blob/165487a4ffe2fb80dd158fd6fe8e109282145a69/docs/bcd/README.md)。main没有这些文件时使用固定链接。
- #74头提交的[Verify 41332437883](https://github.com/HYX-2024-1020/shixu/actions/runs/41332437883)失败：Windows的 `--audit-time --pdf-windows --temporary` 专项失败，其后专项跳过，Required checks失败；Core、Browser、policy、Secret scan成功。此前一次运行取消。未诊断根因，不称偶发，不以旧头绿灯代替，不在整理任务里重跑。
- #47手机交互、#51倒计时仍开放并与main有冲突；[#56](https://github.com/HYX-2024-1020/shixu/pull/56)/[#58](https://github.com/HYX-2024-1020/shixu/pull/58)已吸收部分能力。恢复前核对最终文件及残差，不重复整支合并，不据此关闭未完成验收。
- 此前保护的shixu/44份、shixu-baseline/19份改动已按用户授权[逐份核对并归档](project-continuity/local-remnants-20261102.md)：26份与主线相同、29份历史原版、8份本地变体保留；两个旧checkout已干净，原HEAD/分支未变，仍只供参考，不能按目录名认作最新版本。归档可恢复，不夹带进新任务。
- 用户反馈手机世界折叠/密度和操作不顺手、AI分组/命名不足、应急网页适配与动效问题。源码已有功能不推翻实际反馈，需定位实际入口与版本。

## 下一轮怎样继续

先确定一个具体使用问题、核对复用成果与依赖，再建立独立Issue/分支/PR。总清单负责追踪交付，不是所有任务的共同开发区。功能恢复需要用户明确指令，本次不启动UI改造、AI实验、旧CI修复或云部署。

解析、安全、预算、同步与迁移成果保留；常见材料缺口按实际场景排序，罕见格式扩展暂停。unknown、删除/撤销、费用及隔离门禁不放松；未具备条件的模式继续关闭。

[文档目录](README.md) · [双端能力与历史增量](client-parity.md) · [开发指南](guides/development.md)
