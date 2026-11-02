# 63份历史本地改动的处理结果

2026-11-02，任务[#85](https://github.com/HYX-2024-1020/shixu/issues/85)，比较基线8c67690。用户明确授权自行处理此前保护的本地改动；本轮完成归档和参考checkout清理，不恢复产品开发。

## 已实际处理

| 来源 | 主线相同 | 历史原版 | 本地变体 | 合计 | 清理后 |
| --- | --- | --- | --- | --- | --- |
| shixu/ | 8 | 29 | 7 | 44 | Git状态干净，main仍在原ef5aeeb |
| shixu-baseline/ | 18 | 0 | 1 | 19 | Git状态干净，原分支仍在9bf9531 |
| 合计 | 26 | 29 | 8 | 63 | 原始内容全部可恢复 |

主线相同/历史原版按Git正常清洗后的blob比较，包含换行处理；归档另外保留原始字节及逐文件SHA-256。29份历史原版逐一找到了实际包含该路径和blob的提交，不仅按文件名猜测。8份本地变体不等于8项新功能，均完整保存且没有覆盖主线。

小程序兔子、狐图集及播放组件已与主线一致；不是丢在旧目录里的未交付新实现。其余早期同步、小程序、皮肤源码已有对应历史原版，后续从主线和明确任务分支接续。

14份已跟踪改动仅在旧工作副本恢复至各自HEAD；49份未跟踪工作副本在原始内容校验归档后逐文件移出。没有reset、clean、stash、递归删除或移动整个目录。两个checkout的分支、HEAD和暂存区条目摘要不变；没有开发或推送旧main。此维护操作是用户本次授权的限定例外，旧目录仍不得作为日常开发入口。

## 本地归档与恢复

归档位于工作区outputs/local-remnants-20261102/，不提交公共仓库：

- payload/保存全部63份原始文件，保持checkout/相对路径层次、原始字节和时间信息。
- manifest.json记录原Git状态、HEAD、分支、索引摘要、文件SHA-256、分类、历史提交和变体用途。
- 两份*-tracked.patch为14份已跟踪改动的full-index二进制补丁；清理前反向检查与清理后正向恢复检查均通过。
- source-remnants.zip包含63份原件、manifest、两份补丁和恢复说明，共67个条目；ZIP CRC及63份内容SHA-256逐一验证，ZIP校验值保存在SHA256SUMS.txt。
- cleanup-receipt.json记录63次限定操作及两个目录的清理后状态；归档README说明如何在核对原HEAD和目标后恢复选定文件。

恢复时以原始payload为准，不将这批旧文件整包覆盖到固定开发区。归档仅本地保留，未上传GitHub或外部服务；不设自动清除期限。历史工作记录、开发工具设置和二进制素材也没有作为新代码提交。

## 八份本地变体的取舍

| 来源文件 | 判断与处置 |
| --- | --- |
| shixu/.github/workflows/ci.yml | 早期21行工作流，旧执行项已由当前必需检查覆盖；不回退现有CI。 |
| shixu/.gitignore | 忽略规则集合一致，仅顺序/空行不同；原始字节留档。 |
| shixu/HANDOFF.md | 0.3.x历史交接与机器工作记录；多数段落已在历史归档，其余原文仅本地保留，不作为当前指令。 |
| shixu/package.json | 旧0.3.7构建清单；没有仅此处存在的脚本名或依赖名，不覆盖当前清单。 |
| shixu/docs/miniprogram-implementation.md | 旧段落已全部包含于主线文档，主线另有后续进展。 |
| shixu/docs/skin-market.md | 旧的预览/确认两步说明，已被后续点击应用及新角色说明取代。 |
| shixu/e2e/skins.spec.ts | 旧两步选择场景随产品改为点击应用；其余三类原有测试场景仍在现有套件，旧测试全文留档。 |
| shixu-baseline/miniprogram/project.config.json | 开发工具展开的默认选项与空配置对象；应用身份和网络校验未改变，按预览配置历史保留。 |

## 逐文件清单

每份原始内容均归档。主线相同项不再次合入，历史原版项保留历史来源，本地变体按上表退役留档。本表中的路径只是相对工作区标识，不含机器绝对路径或文件原文。

| 旧checkout | 相对路径 | 分类 | 已核对Git blob | 历史提交 |
| --- | --- | --- | --- | --- |
| shixu | .github/workflows/ci.yml | 本地变体 | c4ba0f3c6b2d | — |
| shixu | .gitignore | 本地变体 | 6c4a1abde6f0 | — |
| shixu | HANDOFF.md | 本地变体 | a9cb103ad48e | — |
| shixu | package.json | 本地变体 | 5ea6f61fc28c | — |
| shixu | src/bucket/BucketApp.tsx | 历史原版 | dc39b154fccc | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/BucketApp.tsx) |
| shixu | src/bucket/Results.tsx | 历史原版 | 6f0739840bbe | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/Results.tsx) |
| shixu | .env.sync.example | 历史原版 | 722b0aa68d22 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/.env.sync.example) |
| shixu | deploy/sync/README.md | 历史原版 | a94b52dbe6d9 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/deploy/sync/README.md) |
| shixu | deploy/sync/backup.mjs | 历史原版 | 59b1351b4512 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/deploy/sync/backup.mjs) |
| shixu | deploy/sync/install.sh | 主线相同 | 4990a164c282 | — |
| shixu | deploy/sync/release.test.mjs | 历史原版 | 7ce4b0f9c060 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/deploy/sync/release.test.mjs) |
| shixu | deploy/sync/shixu-sync.service | 主线相同 | 49efd6ba5df3 | — |
| shixu | deploy/sync/verify.mjs | 主线相同 | 9685297aef10 | — |
| shixu | docs/miniprogram-implementation.md | 本地变体 | eb6cc2db85db | — |
| shixu | docs/miniprogram-migration-plan.md | 历史原版 | 67d7fc452bf6 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/docs/miniprogram-migration-plan.md) |
| shixu | docs/server-staging-2026-10-24.md | 历史原版 | 2a03081fd279 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/docs/server-staging-2026-10-24.md) |
| shixu | docs/skin-market.md | 本地变体 | b5bb3a9bc2dc | — |
| shixu | e2e/skins.spec.ts | 本地变体 | 6a9119741ac3 | — |
| shixu | miniprogram/README.md | 历史原版 | 4cf84ded5de9 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/README.md) |
| shixu | miniprogram/app.js | 历史原版 | 41e95b7c3ef6 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/app.js) |
| shixu | miniprogram/app.json | 历史原版 | 0549ea2849c9 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/app.json) |
| shixu | miniprogram/app.wxss | 历史原版 | 4edd0a9b8744 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/app.wxss) |
| shixu | miniprogram/assets/mascot.png | 主线相同 | ddcb571665c8 | — |
| shixu | miniprogram/lib/sync-client.js | 历史原版 | 5c007ced1bdd | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/lib/sync-client.js) |
| shixu | miniprogram/lib/transport.js | 历史原版 | 118b60e5fbbf | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/lib/transport.js) |
| shixu | miniprogram/package.json | 主线相同 | 0fef86e3396e | — |
| shixu | miniprogram/pages/index/index.js | 历史原版 | a936149234d5 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/pages/index/index.js) |
| shixu | miniprogram/pages/index/index.json | 历史原版 | eb0f6401eb59 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/pages/index/index.json) |
| shixu | miniprogram/pages/index/index.wxml | 历史原版 | df0f4c85a101 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/pages/index/index.wxml) |
| shixu | miniprogram/pages/index/index.wxss | 历史原版 | 95058285b31c | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/pages/index/index.wxss) |
| shixu | miniprogram/project.config.json | 主线相同 | 1723cea2c342 | — |
| shixu | miniprogram/sitemap.json | 主线相同 | cb2debb0c6ba | — |
| shixu | miniprogram/tests/client.test.cjs | 主线相同 | 670617e9013a | — |
| shixu | miniprogram/tests/lifecycle.test.cjs | 历史原版 | d496d46ac82e | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/miniprogram/tests/lifecycle.test.cjs) |
| shixu | scripts/build-sync-release.mjs | 历史原版 | 459fd80f971b | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/scripts/build-sync-release.mjs) |
| shixu | server/sync-server.mjs | 历史原版 | c59bfb9105dd | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/server/sync-server.mjs) |
| shixu | server/sync-store.mjs | 历史原版 | dfee2ee6e038 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/server/sync-store.mjs) |
| shixu | server/sync.test.mjs | 历史原版 | e232477e194a | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/server/sync.test.mjs) |
| shixu | src/bucket/SkinArt.tsx | 历史原版 | 46afca397e07 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/SkinArt.tsx) |
| shixu | src/bucket/SkinMarket.tsx | 历史原版 | c6f24c6695e9 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/SkinMarket.tsx) |
| shixu | src/bucket/SkinMascot.tsx | 历史原版 | 9cb587d686aa | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/SkinMascot.tsx) |
| shixu | src/bucket/skins.css | 历史原版 | ffcef312c7e3 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/skins.css) |
| shixu | src/bucket/skins.test.ts | 历史原版 | 49ab95f44131 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/skins.test.ts) |
| shixu | src/bucket/skins.ts | 历史原版 | 43bde2abbe86 | [273ecd4](https://github.com/HYX-2024-1020/shixu/blob/273ecd489e37a32b8ca730f2b6ed7f45d7f47f5d/src/bucket/skins.ts) |
| shixu-baseline | miniprogram/app.json | 主线相同 | 27eb8f08fb87 | — |
| shixu-baseline | miniprogram/lib/generated/desktop.js | 主线相同 | 292e0e1fc2e9 | — |
| shixu-baseline | miniprogram/lib/generated/manifest.json | 主线相同 | 7065c8a00a7f | — |
| shixu-baseline | miniprogram/pages/index/index.js | 主线相同 | 5a9c37157a19 | — |
| shixu-baseline | miniprogram/pages/index/index.json | 主线相同 | 2e9431bea506 | — |
| shixu-baseline | miniprogram/pages/index/index.wxml | 主线相同 | 1a1de35ef106 | — |
| shixu-baseline | miniprogram/pages/index/index.wxss | 主线相同 | bae100c2874c | — |
| shixu-baseline | miniprogram/project.config.json | 本地变体 | 43ac2730a1ef | — |
| shixu-baseline | miniprogram/assets/bunny-voice.mp3 | 主线相同 | 13d86e640c24 | — |
| shixu-baseline | miniprogram/assets/bunny.png | 主线相同 | da4db4d708cb | — |
| shixu-baseline | miniprogram/assets/fox/atlas.webp | 主线相同 | abcab18f69b8 | — |
| shixu-baseline | miniprogram/assets/fox/entry.js | 主线相同 | 30de6e760a62 | — |
| shixu-baseline | miniprogram/assets/fox/entry.json | 主线相同 | 11a25c97e0cc | — |
| shixu-baseline | miniprogram/assets/fox/entry.wxml | 主线相同 | 7e975ad5ffa6 | — |
| shixu-baseline | miniprogram/assets/fox/entry.wxss | 主线相同 | 273044535c4d | — |
| shixu-baseline | miniprogram/assets/fox/player.js | 主线相同 | 015fd0ad19ba | — |
| shixu-baseline | miniprogram/assets/fox/player.json | 主线相同 | d80dd20a6bff | — |
| shixu-baseline | miniprogram/assets/fox/player.wxml | 主线相同 | 974d2609c323 | — |
| shixu-baseline | miniprogram/assets/fox/player.wxss | 主线相同 | 270e06ff3ce0 | — |

## 验证与范围

63份工作副本与原盘点摘要一致后才归档；ZIP中63份内容再逐一核对。清理后两个目标checkout状态为空，分支/HEAD/索引不变，补丁可重新应用。其余16个参考checkout与未合并成果保持原样；固定开发区只提交本处理文档与导航更新。

本地文档入口检查63份Markdown通过；PR/双端/工作区规则测试15项通过；Gitleaks全历史扫描及差异检查通过。最终远端CI按本任务提交独立核对。

没有读取或打包私人profile、真实通知、密钥、数据库、.private或忽略目录；没有执行旧源码、模型调用、客户端安装、微信工程同步或服务器操作。文档/规范及远端CI分别记录，不把这次文件归档称为产品验收。

[固定开发规则](local-workspace.md) · [当前入口](../current-baseline.md) · [处理前历史快照](inventory-20261102.md)
