# B/C/D 剩余验收

关联 #73 和 #69。2026-11-03 在 `00959e2` 核对固定代表样本与当前代码。历史真实调用、当前回归和外部验收分别记证。

| B6 代表样本 | 已有证据 | 尚需核对 |
| --- | --- | --- |
| 课程通知转行动与跨块去重 | 两项同课程作业分开，检查 A7319 事项、格式、文件名、算法要求和来源。语义步骤用真实模型，识别输入为固定夹具。[样本](evidence/notice-merge-v2-real.json) | 当前版本从原件识别到语义归并的完整真实链 |
| 夹图 DOCX | 真实开发链核对编号、格式、命名、截止、算法与复杂度、Office 锚点及全部原图。最终项含“待核对的图像事项”。[样本](evidence/office-real-docx.json) | 按当前输出复核分类、行动标题与待确认分流 |
| 扫描 PDF | 完整真实链识别与核对后发布任务，保留 2026-11-03 16:45、命名、复杂度及页面区域。固定缺陷回放另证报告尾部臆断移入待确认。[完整样本](evidence/visual-review-real-pipeline.json) · [缺陷回放](evidence/visual-review-real-replay.json) | 当前版本复核同一固定材料 |
| 同编号历史关联 | 模拟识别加真实关联选择同编号、同截止历史事项，排除其他编号和冲突日期。[样本](evidence/association-real-quality.json) | 当前版本完整识别与关联联合验证 |

当前代码的历史关联、合并、视觉核对和供应商收据共 48 项通过，Office 文字窗、停止接续和隐藏工作表 5 项通过。本机缺固定原生 WebP 资源，Office JPEG/GIF/WebP 联合项在读取输出断言失败，完整含原生资源的回归由远端 CI 核对。B6 保持待验收，真实模型新增调用 0。

| 项 | 当前门禁及剩余证据 |
| --- | --- |
| C7 安全重试 | [DeepSeek 错误码](https://api-docs.deepseek.com/quick_start/error_codes/)与[并发限制](https://api-docs.deepseek.com/quick_start/rate_limit/)说明 429 的限流含义。此次核对未找到能证明同一已发请求未计费的保证。读取服务继续将无可信 usage 的已发请求归入 unknown，自动重发需要可核对的未执行或未计费证据。 |
| C8 最终账单与时间证据 | [官方帮助](https://api-docs.deepseek.com/faq/)列出发票和 API Key 用量入口。现有请求/响应收据已可绑定本地调用。仍需能关联同一请求的真实最终计费证据，以及受信宿主的逐步骤终止和活跃时间记录。 |
| D5 恢复 | 已有独立账号/租户检查点、删除与到期的安全重放、宿主账本水位和[首次接入已核对的旧库](tenant-safety-verification.md#首次接入已核对的旧库)的合成验证。仍需真实旧库核对及完整跨域恢复。 |
| D6 原生双端 | Windows CI 与微信 Page/Node 签名 HTTP 已有证据。微信 develop 联验仍需隔离测试会话和身份，已有隔离失败详见[验收记录](acceptance-20261102.md)。 |
