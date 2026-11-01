# PDF批注与表单外观开发验证

2026-11-02，#73 / Draft PR #74。视觉窗口新增实际批注/表单外观及独立文字来源；B/C/D仍继续，非最后独立整体验收。

## 实现

- PDF.js `AnnotationMode.ENABLE`将实际外观流压入页图；以真实`beginAnnotation`操作确认外观覆盖，不以`hasAppearance`或仅拿到元数据冒充已渲染。`getAnnotations(intent:any)`检查完整注释集合，隐藏/HTML层独有/未出现实际外观的项仍有单独未读范围。
- 每项有页码、编号、闭合类型和原页矩形；正文、批注、字段保存值、所有选项分别作为有来源文字，坐标显示同步双端。选择字段同时保留可选值及对应保存值，不丢掉当前滚动视图之外的选项。内容仍是不可信文件输入，不把署名/保存值当成人工认证。
- 有存储外观的文本字段/勾选框与普通批注实际渲染；`NeedAppearances`文本/选择框在完整字体编码下用现有本地字体度量生成外观。固定上游在不需要OffscreenCanvas的完整编码路径也无条件告警，本批仅把该告警限定于确有encodingError的分支；没有关闭全局告警。字体缺口、不可编码CJK/emoji、坏操作符仍拒绝可信页图；缺字体资源仍失败。
- 密码字段保存值不追加文字；签名字段、嵌入附件/声音/视频/3D、未呈现链接等仍保持未读。URI/动作不执行；不引入HTML层、脚本或宿主字体。没有AP且未声明可重建的表单、复杂HTML/交互层、更多字段/媒体仍继续，不称全PDF支持。文字专用读取仍保留视觉未读，本批为视觉窗口能力。
- 第一瓦片输出完整批注文字，后续图像瓦片不重复；120k码点分片不是全文上限，累计偏移保持。每页1000项/8MiB文字为独立资源边界，超限明确未读，无可信图像前缀；重复身份或非法来源矩形拒绝。任务内核验证新增来源字段，独立窗口收据仍绑定全部覆盖元数据。
- `pdf-visual/3;annotations/1`、归一化`pdf-108dpi-white-png/2`、渲染包协议3，必须同版重建。原件、费用、根累计和未知保护保持；服务自包含包包含新模块、更新worker和原补丁源。

依据：固定PDF.js6.2.108实际源中的Annotation/Widget/getOperatorList和[官方API参数](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)。原始PDF、注释文字/表单值和像素图案均为项目合成；无个人文件/真实签名或密码。

## 已执行

- Windows最终完整reading544项：543通过、1既有symlink权限跳过；同步125、自包含发布2、mini生成/检查通过。基础外观、旋转0/90/180/270及CropBox八组，页图每个RGBA像素与独立几何公式相等；文本字段和勾选框也匹配原外观全像素。
- `NeedAppearances`文本字段的独立MuPDF1.28.2字形mask在双向2像素容差覆盖≥97%；当前样本实测100%，仅基线垂直1像素差。选择框不同引擎默认滚动位置不同，保留观察，不冒充该样本逐像素一致；完整选项独立文字保留。CJK/emoji无法在该字体编码时仍告警且无可信页图。
- 150k+码点批注两片完整拼回、偏移120000接续；坏AP、重复身份、1001项、非法矩形/类型/编号、链接/隐藏/无AP/签名/密码值保护均验证。网络fetch陷阱未触发；坏AP不发布像素。初次新增夹具有同名变量，修正后专项6项通过；自动外观在旧包上拒绝告警，复核编码分支后精确补丁正/负例通过，失败日志保留。
- 两页PDF和ZIP内PDF，实际Windows AccountWorkspace / Page生命周期+Node wx签名HTTP：批注编号/页码/矩形与图像、来源显示、停止/迟到丢弃、临时到期或删除补传、修订复用一致。每链4次**模拟**调用/80微元，修订新增1次且复用2块。不是原生微信/手机或安装版证据；本批无新本机UI窗口。
- Linux自有只读树`/opt/shixu-bcd-test-20261102-pdf-annotations`，nobody最终41项通过；受保护broker两客户端链、daemon拒绝及6个实际systemd样本（静态批注/字段/勾选框、自动文本/选择框、不可编码负例）通过。[机器证据](evidence/pdf-annotation-linux.json)。同源Linux工具为Windows交叉构建，实际Linux执行；仅复用/复制自有合成runtime和固定资产，没有宿主包安装或生产服务改动。
- 小页隔离样本解析约603–702ms、RSS约98–102MiB，端到端约754–879ms；非大文档/P95或cgroup峰值验收。前批字体头`001edc3`的CI run41326624392六项全绿，本批最终头CI另行核对。

复现：`npm run reading:pdf:visual:build`、`node scripts/build-reading-pdf.mjs --check`；`node --test server/reading/pdf-annotations.test.mjs server/reading/pdf-annotation-clients.test.mjs server/reading/pdf-resources.test.mjs deploy/sync/release.test.mjs`。独立表单参考生成器`scripts/generate-pdf-annotation-reference.py`仅用于合成PDF；Linux脚本`scripts/reading-pdf-annotation-linux.mjs`仅针对自有隔离树运行。

新增真实API0，接续既有33次usage估算¥0.060148保持，非供应商最终账单。继续其他PDF/Office/色彩/流式、独立安全重放和真实证据源；不做E/F、生产开放、真实迁移、安装发布。
