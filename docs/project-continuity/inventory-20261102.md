# 本地与远端盘点快照

2026-11-02，北京时间。整理基线e04a8d6，任务[#81](https://github.com/HYX-2024-1020/shixu/issues/81)。这是有日期的审计索引，后续开始前重新查询。新增整理分支计入本地表；远端表为创建本整理Issue/PR前的快照。

## 检查范围与证据边界

执行git fetch origin、全部19个worktree的Git状态、全部42个本地分支的SHA与远端可达性；GitHub查询46个历史PR的状态/头提交、11个原有开放Issue、最新Release以及#74头提交CI步骤。只读核对源码入口及现有文档，不逐行审计。

未连接ECS、检查正在运行的Windows安装版或当前微信IDE工程，未读个人profile/数据库/密钥/.private，未调用模型或打开UI。部署与本机版本均明确引用历史交付记录。

## 本地worktree

| 工作区目录（相对工作区根） | 分支 | HEAD | 原有变更数 | 归属/处置 |
| --- | --- | --- | --- | --- |
| shixu/ | main | ef5aeeb | 44 | 旧main落后29；44项全部保护，不拉取覆盖 |
| shixu-acceptance/ | fix/dual-client-release-acceptance | 71feddd | 0 | [#23](https://github.com/HYX-2024-1020/shixu/pull/23) 已合并（squash） |
| shixu-baseline/ | fix/skin-tap-audio-preview | 9bf9531 | 19 | 旧预览工程19项保护，未提交不等于可丢弃 |
| shixu-bcd/ | feat/bcd-attachment-loop | 165487a | 0 | #74成果保留，功能暂停 |
| shixu-card-motion/ | fix/mobile-card-scroll | e59c559 | 0 | [#79](https://github.com/HYX-2024-1020/shixu/pull/79) 已合并（squash） |
| shixu-connect/ | feat/sync-https | 6aace2a | 0 | 别名/历史基线，需结合提交核对 |
| shixu-ddl/ | detached | 429e4a2 | 0 | detached但提交有其他分支/PR保存，非新开发入口 |
| shixu-ddl-countdown/ | fix/ddl-countdown | f8595af | 0 | #51部分已吸收，不能整支重复合并 |
| shixu-governance/ | docs/project-continuity | e04a8d6 | 0 | 复用干净checkout，本任务专用文档分支；原治理分支保留 |
| shixu-habit-feedback/ | fix/mini-completion-circle | 429e4a2 | 0 | [#39](https://github.com/HYX-2024-1020/shixu/pull/39) 已合并（squash） |
| shixu-ice-skin/ | fix/skin-tap-audio | 9bf9531 | 0 | [#63](https://github.com/HYX-2024-1020/shixu/pull/63) 已合并（squash） |
| shixu-invite/ | chore/windows-accounts-release | f493c57 | 0 | [#43](https://github.com/HYX-2024-1020/shixu/pull/43) 已合并（squash） |
| shixu-miniprogram/ | feat/miniprogram-desktop-parity | 67d4a1b | 0 | #18已由#23吸收并关闭 |
| shixu-pink-bunny/ | fix/fox-av-sync | 12c5a5d | 0 | [#68](https://github.com/HYX-2024-1020/shixu/pull/68) 已合并（squash） |
| shixu-server-plan/ | docs/server-client-roadmap | da28c1f | 0 | #70固定方案保留，未合并 |
| shixu-stage-a/ | docs/stage-a-baseline | 8345d72 | 0 | [#72](https://github.com/HYX-2024-1020/shixu/pull/72) 已合并（squash） |
| shixu-ui-parity/ | fix/mini-touch-motion | 92978fd | 0 | #47部分已吸收，验收/残差未核完 |
| shixu-vivid-cards/ | feat/cel-card-system | 5b2c4f2 | 0 | [#58](https://github.com/HYX-2024-1020/shixu/pull/58) 已合并（squash） |
| shixu-windows-layout/ | fix/windows-layout-ddl | dcdf569 | 0 | [#49](https://github.com/HYX-2024-1020/shixu/pull/49) 已合并（squash） |

本次没有新建worktree：管理工具无法对工作区内嵌仓库创建托管worktree，遂复用已确认干净的shixu-governance/，从最新origin/main建立docs/project-continuity；原chore/open-source-workflow分支未改写。所有其他checkout的分支保持原样。

## 脏工作区与本地文件保护

- shixu/：6个已跟踪修改、38个未跟踪文件，共44项；涉及旧同步/小程序/皮肤、工作流和文档，不夹带到整理PR。
- shixu-baseline/：8个已跟踪修改、11个未跟踪文件，共19项；涉及小程序配置/生成副本/页面和角色素材，不自动重建或覆盖。
- 完整相对文件名、各文件SHA-256、分支与HEAD保存在工作区outputs/project-continuity-20261102/local-before.json；绝对路径只保留本地，不提交公共仓库。
- 工作区outputs/、handoff/、research/、.task-tools/是既有证据/交接/研究材料，保留原位；本次只盘点顶层归属，不递归读取或搬迁。dist/、release/、node_modules/保留但不作为交付状态依据，不加入Git。ultimate-calendar/是独立目录，不纳入拾序整理。

## 全部本地分支

下表“无远端分支可达提交”通过git rev-list BRANCH --not --remotes统计，不等于成果未保存：squash会改变SHA，已删除普通远端分支的原提交仍可通过原PR核对。不能据此删分支或重合并。

| 分支 | HEAD | 无普通远端分支可达的提交数 | PR/来源 |
| --- | --- | --- | --- |
| chore/consolidate-current-baseline | b48bcdd | 7 | [#6](https://github.com/HYX-2024-1020/shixu/pull/6) 已合并（squash） |
| chore/ddl-local-release | 1833b1e | 0 | [#28](https://github.com/HYX-2024-1020/shixu/pull/28) 已合并（squash） |
| chore/deliver-habit-ddl-feedback | 8afdf70 | 0 | [#37](https://github.com/HYX-2024-1020/shixu/pull/37) 已合并（squash） |
| chore/ice-active-preview | 7fae963 | 0 | [#61](https://github.com/HYX-2024-1020/shixu/pull/61) 已合并（squash） |
| chore/ice-client-update | 7fae963 | 0 | [#61](https://github.com/HYX-2024-1020/shixu/pull/61) 已合并（squash） |
| chore/open-source-workflow | f8d94e2 | 4 | [#2](https://github.com/HYX-2024-1020/shixu/pull/2) 关闭未直接合并 |
| chore/windows-accounts-release | f493c57 | 0 | [#43](https://github.com/HYX-2024-1020/shixu/pull/43) 已合并（squash） |
| docs/project-continuity | e04a8d6 | 0 | 本整理任务新分支，起点main；不是历史功能分支 |
| docs/public-project-guide | ad963bb | 1 | [#16](https://github.com/HYX-2024-1020/shixu/pull/16) 已合并（squash） |
| docs/server-client-roadmap | da28c1f | 0 | [#70](https://github.com/HYX-2024-1020/shixu/pull/70) Draft，开放，冲突 |
| docs/stage-a-baseline | 8345d72 | 0 | [#72](https://github.com/HYX-2024-1020/shixu/pull/72) 已合并（squash） |
| feat/accounts-deployment | 4053d94 | 0 | [#42](https://github.com/HYX-2024-1020/shixu/pull/42) 已合并（squash） |
| feat/admin-mobile | 2bf4c46 | 0 | [#76](https://github.com/HYX-2024-1020/shixu/pull/76) 已合并（squash） |
| feat/bcd-attachment-loop | 165487a | 0 | [#74](https://github.com/HYX-2024-1020/shixu/pull/74) Draft，开放 |
| feat/bold-sticker-cards | b15e95d | 0 | [#56](https://github.com/HYX-2024-1020/shixu/pull/56) 已合并（squash） |
| feat/cel-card-system | 5b2c4f2 | 0 | [#58](https://github.com/HYX-2024-1020/shixu/pull/58) 已合并（squash） |
| feat/ddl | 485be63 | 0 | [#26](https://github.com/HYX-2024-1020/shixu/pull/26) 已合并（squash） |
| feat/ddl-smart-time-ranges | d8d5968 | 0 | [#33](https://github.com/HYX-2024-1020/shixu/pull/33) 已合并（squash） |
| feat/dual-client-server | fb1f61a | 0 | [#20](https://github.com/HYX-2024-1020/shixu/pull/20) 关闭未直接合并 |
| feat/ice-skin | a524e24 | 0 | [#60](https://github.com/HYX-2024-1020/shixu/pull/60) 已合并（squash） |
| feat/invite-multi-user | d50f811 | 0 | [#41](https://github.com/HYX-2024-1020/shixu/pull/41) 已合并（squash） |
| feat/miniprogram-desktop-parity | 67d4a1b | 0 | [#18](https://github.com/HYX-2024-1020/shixu/pull/18) 关闭未直接合并 |
| feat/pink-bunny-skin | 6722c31 | 0 | [#66](https://github.com/HYX-2024-1020/shixu/pull/66) 已合并（squash） |
| feat/sync-https | 6aace2a | 0 | 别名/历史基线，需结合提交核对 |
| feat/vivid-world-ddl | 7a2a62f | 0 | [#54](https://github.com/HYX-2024-1020/shixu/pull/54) 已合并（squash） |
| feat/windows-skin-market | 352eb93 | 1 | [#14](https://github.com/HYX-2024-1020/shixu/pull/14) 已合并（squash） |
| fix/admin-test-icon | f1eb1b5 | 0 | [#77](https://github.com/HYX-2024-1020/shixu/pull/77) 已合并（squash） |
| fix/ddl-completion-style | 433dba8 | 0 | [#31](https://github.com/HYX-2024-1020/shixu/pull/31) 已合并（squash） |
| fix/ddl-countdown | f8595af | 0 | [#51](https://github.com/HYX-2024-1020/shixu/pull/51) 开放，冲突 |
| fix/deadline-time-recovery | 24bd7c1 | 0 | [#30](https://github.com/HYX-2024-1020/shixu/pull/30) 已合并（squash） |
| fix/dual-client-release-acceptance | 71feddd | 0 | [#23](https://github.com/HYX-2024-1020/shixu/pull/23) 已合并（squash） |
| fix/fox-av-sync | 12c5a5d | 0 | [#68](https://github.com/HYX-2024-1020/shixu/pull/68) 已合并（squash） |
| fix/habit-ddl-feedback | 9a66197 | 0 | [#35](https://github.com/HYX-2024-1020/shixu/pull/35) 已合并（squash） |
| fix/mini-cards-detail | fa29d8d | 0 | 别名/历史基线，需结合提交核对 |
| fix/mini-completion-circle | 429e4a2 | 0 | [#39](https://github.com/HYX-2024-1020/shixu/pull/39) 已合并（squash） |
| fix/mini-touch-motion | 92978fd | 0 | [#47](https://github.com/HYX-2024-1020/shixu/pull/47) Draft，开放，冲突 |
| fix/mini-ui-parity | 7acc600 | 0 | [#45](https://github.com/HYX-2024-1020/shixu/pull/45) 已合并（squash） |
| fix/mobile-card-scroll | e59c559 | 0 | [#79](https://github.com/HYX-2024-1020/shixu/pull/79) 已合并（squash） |
| fix/skin-tap-audio | 9bf9531 | 0 | [#63](https://github.com/HYX-2024-1020/shixu/pull/63) 已合并（squash） |
| fix/skin-tap-audio-preview | 9bf9531 | 0 | [#63](https://github.com/HYX-2024-1020/shixu/pull/63) 已合并（squash） |
| fix/windows-layout-ddl | dcdf569 | 0 | [#49](https://github.com/HYX-2024-1020/shixu/pull/49) 已合并（squash） |
| main | ef5aeeb | 0 | 别名/历史基线，需结合提交核对 |

四个旧分支存在普通远端分支不可达的原SHA：chore/consolidate-current-baseline（7）、chore/open-source-workflow（4）、docs/public-project-guide（1）、feat/windows-skin-market（1）。对应#6/#2/#16/#14保留原头提交；治理被整合、其余为squash，不能称为未交付。分支与本地历史均保留。chore/ice-active-preview与fix/skin-tap-audio-preview是已有提交的本地别名，不是新的功能批次。

## 远端PR完整索引

| PR | 标题 | 状态 | 头提交 | 合入提交（仅实际merged） |
| --- | --- | --- | --- | --- |
| [#80](https://github.com/HYX-2024-1020/shixu/pull/80) | chore(deps): bump the compatible-updates group across 1 directory with 6 updates | 开放 | b7f44e6 | — |
| [#79](https://github.com/HYX-2024-1020/shixu/pull/79) | fix(web): allow scrolling from administrator card bodies | 已合并（squash） | e59c559 | e04a8d6 |
| [#77](https://github.com/HYX-2024-1020/shixu/pull/77) | fix(web): reuse desktop icon for administrator home screen | 已合并（squash） | f1eb1b5 | 9d4f47b |
| [#76](https://github.com/HYX-2024-1020/shixu/pull/76) | feat(web): add administrator mobile direct test edition | 已合并（squash） | 2bf4c46 | 1366663 |
| [#74](https://github.com/HYX-2024-1020/shixu/pull/74) | feat: connect isolated material reading and dual-client accounts | Draft，开放 | 165487a | — |
| [#72](https://github.com/HYX-2024-1020/shixu/pull/72) | docs: establish stage A contracts and migration rehearsal | 已合并（squash） | 8345d72 | aad1903 |
| [#70](https://github.com/HYX-2024-1020/shixu/pull/70) | docs: [重要] 确认服务端与双端接入方案及实施总清单 | Draft，开放，冲突 | da28c1f | — |
| [#68](https://github.com/HYX-2024-1020/shixu/pull/68) | fix(skins): synchronize fox audio and video on one clock | 已合并（squash） | 12c5a5d | 2574a5e |
| [#66](https://github.com/HYX-2024-1020/shixu/pull/66) | feat(skins): add clear fox animation and update both clients | 已合并（squash） | 6722c31 | cca3c9e |
| [#64](https://github.com/HYX-2024-1020/shixu/pull/64) | chore(deps): bump the compatible-updates group across 1 directory with 5 updates | 关闭未直接合并 | 9365c5b | — |
| [#63](https://github.com/HYX-2024-1020/shixu/pull/63) | fix(skins): apply on tap and restore audible ice voices | 已合并（squash） | 9bf9531 | 6b23a76 |
| [#61](https://github.com/HYX-2024-1020/shixu/pull/61) | fix(mini): restore WXSS compilation and deliver 0.3.19 | 已合并（squash） | 7fae963 | 77f6d85 |
| [#60](https://github.com/HYX-2024-1020/shixu/pull/60) | feat(skins): add ice mascot with two single-shot voices | 已合并（squash） | a524e24 | 8f76ccd |
| [#58](https://github.com/HYX-2024-1020/shixu/pull/58) | feat(ui): polish cel cards and preserve visible metadata | 已合并（squash） | 5b2c4f2 | 57b1fae |
| [#56](https://github.com/HYX-2024-1020/shixu/pull/56) | feat(ui): ship bold sticker cards on both clients | 已合并（squash） | b15e95d | e3d57a1 |
| [#54](https://github.com/HYX-2024-1020/shixu/pull/54) | feat(ui): add semantic colors to world and deadline cards | 已合并（squash） | 7a2a62f | 9c3a9e0 |
| [#51](https://github.com/HYX-2024-1020/shixu/pull/51) | fix: restore DDL countdowns and update Windows to 0.3.16 | 开放，冲突 | f8595af | — |
| [#49](https://github.com/HYX-2024-1020/shixu/pull/49) | fix: adapt Windows layout and enable DDL card dragging | 已合并（squash） | dcdf569 | fa29d8d |
| [#47](https://github.com/HYX-2024-1020/shixu/pull/47) | fix: refine mini cards, detail actions and native touch sorting | Draft，开放，冲突 | 92978fd | — |
| [#45](https://github.com/HYX-2024-1020/shixu/pull/45) | fix: align mini UI and mascot motion with Windows | 已合并（squash） | 7acc600 | 3aecd89 |
| [#43](https://github.com/HYX-2024-1020/shixu/pull/43) | chore(release): update installed Windows account client to 0.3.14 | 已合并（squash） | f493c57 | 7223197 |
| [#42](https://github.com/HYX-2024-1020/shixu/pull/42) | feat(sync): deploy isolated accounts with backups and bounded live checks | 已合并（squash） | 4053d94 | 16e7f9a |
| [#41](https://github.com/HYX-2024-1020/shixu/pull/41) | feat: add invite activation and isolated server AI for both clients | 已合并（squash） | d50f811 | 6c73d7c |
| [#39](https://github.com/HYX-2024-1020/shixu/pull/39) | fix: keep WeChat completion buttons circular and draw checks | 已合并（squash） | 429e4a2 | 006a0c7 |
| [#37](https://github.com/HYX-2024-1020/shixu/pull/37) | chore: deliver completion animations in Windows 0.3.13 | 已合并（squash） | 8afdf70 | caf75ff |
| [#35](https://github.com/HYX-2024-1020/shixu/pull/35) | fix: restore DDL completion motion and keep daily habits visible | 已合并（squash） | 9a66197 | 82e5bd1 |
| [#33](https://github.com/HYX-2024-1020/shixu/pull/33) | feat: understand DDL time ranges and reserve navigation space | 已合并（squash） | d8d5968 | 6aace2a |
| [#31](https://github.com/HYX-2024-1020/shixu/pull/31) | fix: match DDL completion controls to world cards | 已合并（squash） | 433dba8 | d15d636 |
| [#30](https://github.com/HYX-2024-1020/shixu/pull/30) | fix: recover deadline clocks and infer missing times | 已合并（squash） | 24bd7c1 | 6df5cbc |
| [#28](https://github.com/HYX-2024-1020/shixu/pull/28) | chore: deliver DDL updates to local clients | 已合并（squash） | 1833b1e | 798f53c |
| [#26](https://github.com/HYX-2024-1020/shixu/pull/26) | feat: add dual-client DDL workspace and absolute dates | 已合并（squash） | 485be63 | 7f924ac |
| [#24](https://github.com/HYX-2024-1020/shixu/pull/24) | chore(deps): bump the compatible-updates group across 1 directory with 4 updates | 关闭未直接合并 | c24f2df | — |
| [#23](https://github.com/HYX-2024-1020/shixu/pull/23) | feat: integrate dual-client workflows and interaction fixes | 已合并（squash） | 71feddd | 1411ac9 |
| [#20](https://github.com/HYX-2024-1020/shixu/pull/20) | feat(sync): connect Windows and WeChat to the shared server | 关闭未直接合并 | fb1f61a | — |
| [#18](https://github.com/HYX-2024-1020/shixu/pull/18) | feat(miniprogram): port desktop workflows and synchronize originals | 关闭未直接合并 | 67d4a1b | — |
| [#16](https://github.com/HYX-2024-1020/shixu/pull/16) | docs: organize public guides and repair current entry points | 已合并（squash） | ad963bb | 35eb17f |
| [#14](https://github.com/HYX-2024-1020/shixu/pull/14) | feat: ship skin market in Windows 0.3.8 | 已合并（squash） | 352eb93 | 4b8ac2e |
| [#12](https://github.com/HYX-2024-1020/shixu/pull/12) | chore(deps-dev): bump vite from 6.4.5 to 8.3.5 | 开放 | bce2e8e | — |
| [#11](https://github.com/HYX-2024-1020/shixu/pull/11) | chore(deps-dev): bump @vitejs/plugin-react from 4.7.0 to 6.1.2 | 开放 | d5549b8 | — |
| [#10](https://github.com/HYX-2024-1020/shixu/pull/10) | chore(deps): bump the compatible-updates group across 1 directory with 3 updates | 关闭未直接合并 | d16c17c | — |
| [#9](https://github.com/HYX-2024-1020/shixu/pull/9) | chore(deps): bump actions/upload-pages-artifact from 3.0.1 to 5.0.0 | 开放 | 3cbf5b0 | — |
| [#8](https://github.com/HYX-2024-1020/shixu/pull/8) | chore(deps): bump actions/upload-artifact from 4.6.2 to 7.0.2 | 开放 | 1701365 | — |
| [#7](https://github.com/HYX-2024-1020/shixu/pull/7) | chore(deps): bump actions/checkout from 4.4.0 to 7.0.1 | 开放 | c4bd722 | — |
| [#6](https://github.com/HYX-2024-1020/shixu/pull/6) | chore: consolidate current desktop, skins, miniprogram and sync baseline | 已合并（squash） | b48bcdd | 273ecd4 |
| [#4](https://github.com/HYX-2024-1020/shixu/pull/4) | Windows 0.3.7：本次投喂结果、卡片原位开合与长按排序 | 已合并（squash） | ac54055 | ef5aeeb |
| [#2](https://github.com/HYX-2024-1020/shixu/pull/2) | chore: enforce open-source workflow and restore browser checks | 关闭未直接合并 | f8d94e2 | — |

截至快照共有10个开放PR：功能/方案#47/#51/#70/#74和依赖更新#7/#8/#9/#11/#12/#80。关闭未直接合并不等于成果废弃：#18/#20由#23吸收；#2由#6整合。#47/#51的部分源码又由#56/#58整合，剩余验收继续保留。本次未关闭、合并或重跑这些PR。

## 原有开放Issue

| Issue | 跟踪内容 | 本次判断 |
| --- | --- | --- |
| [#69](https://github.com/HYX-2024-1020/shixu/issues/69) | [重要] 拾序附件、账号、预算与运维分阶段实施总清单 | 保留为交付总清单，A已合入，BCD未验收，EF另计；历史进度不视为自动授权 |
| [#73](https://github.com/HYX-2024-1020/shixu/issues/73) | feat: B/C/D attachment reading loops and isolated execution | 保留为BCD成果/缺口跟踪，早期预算与继续措辞须结合最新暂停和固定证据 |
| [#52](https://github.com/HYX-2024-1020/shixu/issues/52) | fix: redesign mini cards and repair independent actions and attachment access | #47对应的原生卡片/附件验收待核，不重复从零实现 |
| [#50](https://github.com/HYX-2024-1020/shixu/issues/50) | feat: compact mini world and DDL with persistent touch sorting | #47排序/紧凑布局待核，注意后续#56/#58整合 |
| [#46](https://github.com/HYX-2024-1020/shixu/issues/46) | fix: native mini mascot motion and compact touch controls | 保留原生微信/手机交互证据缺口，用户反馈优先 |
| [#40](https://github.com/HYX-2024-1020/shixu/issues/40) | feat: invite activation, isolated accounts and server-managed AI | 账号服务源码/历史部署已有，公网/实际使用仍待验 |
| [#22](https://github.com/HYX-2024-1020/shixu/issues/22) | feat: route Windows cloud AI through the shared server queue | 统一AI已有#41实现记录，残余交付边界需核，不作为全新功能重做 |
| [#21](https://github.com/HYX-2024-1020/shixu/issues/21) | fix: complete dual-client interaction and pre-release acceptance | #23已有整合；未完发布/原生验收保留 |
| [#19](https://github.com/HYX-2024-1020/shixu/issues/19) | feat: connect Windows and WeChat clients to the existing sync server | #23已有源码；正式网络/手机等边界保留 |
| [#17](https://github.com/HYX-2024-1020/shixu/issues/17) | feat: align WeChat miniprogram with desktop and maintain both clients | #23及后续已有小程序；原生/真机/发布保留 |
| [#3](https://github.com/HYX-2024-1020/shixu/issues/3) | docs: 补齐鲸鱼图像和笑声音频的来源及再分发授权 | 第三方素材授权记录待补，未因MIT而免除 |

新增#81只跟踪本次整理，不取代#69/#73，也不要求先完成全部历史Issue才能改善体验。

## 已发现的状态脱节与处置

| 脱节 | 本次处置 | 后续边界 |
| --- | --- | --- |
| current-baseline仍为10月24日、架构/桌面入口混用0.3.8与旧同步描述 | 修正当前入口并保留历史记录 | 后续发布改变状态时更新当前入口，不向历史日志追加“下一轮继续” |
| #70只有规划分支文件，A和BCD以固定提交为依赖 | 显式链接da28c1f，不复制/篡改原方案 | #70与main冲突待独立审查，不自动重写原契约 |
| #47/#51开放但部分成果已整合 | 标注来源与残差未验 | 不重复合并、不自动关闭 |
| #74正文的头CI待核，而实际失败 | 以run41332437883与实际失败步骤记录 | 未读失败日志/定位根因，不擅自修复或重跑 |
| BCD README/implementation-status含大量历史继续和旧缺口 | 从当前入口说明证据阅读顺序 | 不覆盖历史；最新专项比旧增量更具体，仍须实际核对 |
| 本地目录名称像最新，实际版本不一 | 记录19个checkout和全部分支 | 禁止从shixu旧main或预览工程盲目继续 |

公开Release本次GET核对为v0.3.8；0.3.23为仓库最新本机交付记录。应急网页#79对应主线源码，不等于本次已核验线上部署revision或手机缓存。服务器仅引用10月25日记录，不作实时健康结论。

## 复核命令

```sh
git fetch origin
git status --short --branch
git worktree list --porcelain
git branch -vv
git log origin/main -12 --oneline
git diff --shortstat origin/main...origin/feat/bcd-attachment-loop
node scripts/check-docs.mjs
node --test scripts/check-pr.test.mjs scripts/check-client-parity.test.mjs
git diff --check
```

PR状态、原头提交和CI结论通过GitHub连接器读取；本地metadata副本remote.json/branches.json只作接续证据，不代替下次查询。没有读取运行中的账户/账本/真实通知。

## 本整理的本地验证

文档链接与当前入口61份Markdown通过；PR/双端门禁测试8项通过；git diff --check通过。除复用的文档checkout外，其余18个worktree的分支、HEAD与完整Git状态一致，两个原脏工作区的63份文件SHA-256逐一复核不变；本地结果见preservation.json。没有运行产品功能/模型/UI测试，新PR的远端CI另核，不以此覆盖#74失败。
