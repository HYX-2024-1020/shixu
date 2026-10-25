const { createSyncClient, makeId } = require("../../lib/sync-client");
const { createTransport, normalizeServiceURL } = require("../../lib/transport");
const {
  KEY: FILES,
  createFileLibrary,
  createFileTransport,
  extension,
} = require("../../lib/files");
const {
  createLocalWorkspace,
  KEY: LOCAL,
} = require("../../lib/local-workspace");
const {
  KINDS,
  localDay,
  itemsFor,
  worldView,
  statePatch,
} = require("../../lib/world");
const {
  BUILTIN_SKINS,
  SKIN_MOTIONS,
  parseSkinCollection,
  MAX_CUSTOM_SKINS,
  mergeCardOrder,
  deadlineSections,
  parseDeadline,
  absoluteItem,
  setDeadline,
} = require("../../lib/generated/desktop");
const SKINS = "shixu:mini:skins:v1";
const FILTERS = "shixu:mini:filters:v1";
const jobsKey = (base) => `shixu:mini:jobs:v1:${base}`;
const DRAFT = "shixu:mini:draft:v1";
const CONNECTION = "shixu:mini:connection:v1";
const stateKey = (base) => `shixu:mini:workspace:v1:${base}`;
function dateInfo() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    capturedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    captureDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}
Page({
  data: {
    tab: "capture",
    ddlDays: [1, 3, 7, 14, 30],
    ddlIndex: 2,
    ddlLimit: 60,
    ddlHasMore: false,
    ddlOverdue: [],
    ddlSections: [],
    ddlUnsure: [],
    ddlDone: [],
    ddlCount: 0,
    ddlToday: 0,
    ddlShowOverdue: false,
    ddlShowUnsure: false,
    ddlShowDone: false,
    ddlAddOpen: false,
    ddlTitle: "",
    ddlDate: "",
    ddlTime: "",
    ddlRequirements: "",
    editTime: "",
    settingsReturnTab: "capture",
    draft: "",
    draftFiles: [],
    originalPreview: null,
    filesBusy: false,
    pendingFiles: 0,
    rows: [],
    recordPage: 0,
    recordTotal: 0,
    count: 0,
    pending: 0,
    conflicts: 0,
    serverUrl: "",
    password: "",
    connected: false,
    connecting: false,
    syncing: false,
    aiChecking: false,
    showAiGuide: false,
    error: "",
    notice: "",
    showDeleted: false,
    expandedId: "",
    updateReady: false,
    scope: "active",
    query: "",
    kind: "all",
    sort: "priority",
    dateFilter: "all",
    starOnly: false,
    grouped: false,
    group: "",
    items: [],
    sections: [],
    matched: 0,
    itemCount: 0,
    activeCount: 0,
    doneCount: 0,
    groups: [],
    limit: 60,
    kinds: ["全部类型", ...Object.values(KINDS)],
    kindKeys: ["all", ...Object.keys(KINDS)],
    kindIndex: 0,
    editKinds: Object.values(KINDS),
    sorts: ["优先处理", "日期", "重要程度", "最新创建", "手动排序"],
    sortKeys: ["priority", "date", "importance", "created", "custom"],
    sortIndex: 0,
    dates: ["全部日期", "今天", "已逾期", "未来七天"],
    dateKeys: ["all", "today", "overdue", "week"],
    dateIndex: 0,
    selected: null,
    editing: false,
    editTitle: "",
    editSummary: "",
    editGroup: "",
    editDate: "",
    editKind: 0,
    addition: "",
    manualTitle: "",
    manualKind: 0,
    recordsOpen: false,
    currentCaptureId: "",
    currentRows: [],
    localMode: true,
    localCount: 0,
    skinOpen: false,
    skins: [],
    activeSkin: BUILTIN_SKINS[0],
    previewSkin: BUILTIN_SKINS[0],
    skinMessage: BUILTIN_SKINS[0].hello,
    skinAnimating: false,
    skinEditor: false,
    skinForm: {},
    motionLabels: Object.values(SKIN_MOTIONS),
    motionKeys: Object.keys(SKIN_MOTIONS),
    motionIndex: 0,
    capabilities: {
      textSync: false,
      aiOrganize: false,
      attachments: false,
      wechatLogin: false,
    },
    jobs: [],
    chatInput: "",
    jobBusy: false,
    jobLabels: {
      submitting: "正在提交",
      queued: "等待整理",
      running: "正在整理",
      applying: "正在保存结果",
      done: "已完成",
      error: "未完成",
      conflict: "有新修改，请核对结果",
      interrupted: "已中断，请核对后重试",
    },
  },
  onLoad() {
    try {
      this._skinCollection = parseSkinCollection(
        wx.getStorageSync(SKINS) || null,
      );
      this._loadSkins();
      const filters = wx.getStorageSync(FILTERS);
      if (filters && this.data.sortKeys.includes(filters.sort))
        this.setData({
          sort: filters.sort,
          sortIndex: this.data.sortKeys.indexOf(filters.sort),
        });
      const savedDraft = wx.getStorageSync(DRAFT);
      this._draftId =
        savedDraft && typeof savedDraft === "object" ? savedDraft.id : null;
      this.setData({
        draft:
          typeof savedDraft === "string"
            ? savedDraft
            : (savedDraft && savedDraft.text) || "",
      });
      const connection = wx.getStorageSync(CONNECTION);
      if (connection && connection.base && connection.token)
        this._activate(connection);
      else this._activateLocal();
    } catch (error) {
      this._error(error);
    }
    this._network = (result) => {
      if (result.isConnected) this.syncQuietly();
    };
    wx.onNetworkStatusChange(this._network);
    this._prepareSkinAudio();
  },
  onShow() {
    this.setData({ updateReady: getApp().globalData.updateReady });
    this._refresh();
    this.syncQuietly();
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this._refresh();
      this.syncQuietly();
    }, 8000);
  },
  onHide() {
    clearInterval(this._timer);
    this._stopSkinInteraction();
  },
  onUnload() {
    clearInterval(this._timer);
    this._stopSkinInteraction();
    if (this._skinAudio) this._skinAudio.destroy();
    if (this._network) wx.offNetworkStatusChange(this._network);
  },
  _activate(connection) {
    const environment = wx.getAccountInfoSync().miniProgram.envVersion;
    const base = normalizeServiceURL(connection.base, environment);
    const transport = createTransport(base, () => connection.token);
    const client = createSyncClient({
      read: () => wx.getStorageSync(stateKey(base)) || null,
      write: (value) => wx.setStorageSync(stateKey(base), value),
      request: transport,
    });
    this._connection = connection;
    this._epoch = connection.epoch || null;
    this._transport = transport;
    this._client = client;
    const jobs = wx.getStorageSync(jobsKey(base));
    if (jobs && !Array.isArray(jobs))
      throw new Error("任务记录无法读取，请保留资料联系开发者");
    this._jobs = jobs || [];
    this.setData({
      connected: true,
      serverUrl: base,
      localMode: false,
      jobs: this._jobViews(this._jobs),
    });
    this._refresh();
  },
  _refresh() {
    if (!this._client) return;
    try {
      const library = this._library();
      if (library)
        for (const row of this._client
          .records()
          .filter((r) => r.purged && !r.pending))
          library.forgetPacket(
            row.id,
            this.data.localMode ? "local" : this._connection.base,
          );
    } catch (error) {
      this._error(
        new Error("投递已永久删除，本机原件缓存清理尚未完成，请保留资料后重试"),
      );
    }
    const all = this._client.records().filter((row) => !row.purged && row.data);
    const recordRows = all.filter(
      (row) => !!row.deletedAt === this.data.showDeleted,
    );
    const rows = recordRows
      .sort((a, b) =>
        (b.data.capturedAt || "").localeCompare(a.data.capturedAt || ""),
      )
      .slice(this.data.recordPage * 30, (this.data.recordPage + 1) * 30)
      .map((row) => ({
        id: row.id,
        text: (row.data.text || "").slice(0, 600),
        title: (
          (row.data.text || "").split("\n")[0] ||
          (row.data.attachments || [])[0]?.name ||
          "文字投递"
        ).slice(0, 32),
        date: row.data.captureDate || "",
        deleted: !!row.deletedAt,
        conflict: !!row.conflict,
        state: row.conflict ? "需处理冲突" : row.pending ? "待同步" : "已同步",
        hasResult: !!row.data.result,
        attachments: (row.data.attachments || []).filter((f) => !f.deletedAt),
      }));
    const view = worldView(this._client.records(), this.data);
    const clock = new Date();
    const ddl = deadlineSections(
      itemsFor(this._client.records()),
      localDay(),
      `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`,
      this.data.ddlDays[this.data.ddlIndex],
    );
    const selected =
      this.data.selected &&
      this._presentDetail(this._detail(this.data.selected.id));
    this.setData({
      rows,
      draftFiles: this._fileEntries(this._draftId).map((e) =>
        this._library().metadata(e),
      ),
      pendingFiles:
        this._library() && !this.data.localMode
          ? this._library()
              .entries(null, this._connection.base)
              .filter(
                (e) =>
                  !e.remote &&
                  this._record(e.packetId) &&
                  !this._record(e.packetId).deletedAt,
              ).length
          : 0,
      ddlOverdue: ddl.overdue.slice(0, this.data.ddlLimit).map(this._cardView),
      ddlUnsure: ddl.unsure.slice(0, this.data.ddlLimit).map(this._cardView),
      ddlDone: ddl.done.slice(0, this.data.ddlLimit).map(this._cardView),
      ddlSections: [
        {
          title: "今天截止",
          rows: ddl.today.slice(0, this.data.ddlLimit).map(this._cardView),
        },
        {
          title: `未来 ${this.data.ddlDays[this.data.ddlIndex]} 天`,
          rows: ddl.soon.slice(0, this.data.ddlLimit).map(this._cardView),
        },
        {
          title: `${this.data.ddlDays[this.data.ddlIndex]} 天之后`,
          rows: ddl.later.slice(0, this.data.ddlLimit).map(this._cardView),
        },
      ].filter((s) => s.rows.length),
      ddlCount:
        ddl.overdue.length +
        ddl.today.length +
        ddl.soon.length +
        ddl.later.length +
        ddl.unsure.length,
      ddlToday: ddl.today.length,
      ddlHasMore: Object.values(ddl).some(
        (rows) => rows.length > this.data.ddlLimit,
      ),
      ddlOverdueTotal: ddl.overdue.length,
      ddlUnsureTotal: ddl.unsure.length,
      ddlDoneTotal: ddl.done.length,
      recordTotal: recordRows.length,
      count: all.filter((row) => !row.deletedAt).length,
      pending: this._client.pendingCount(),
      conflicts: this._client.conflicts().length,
      items: view.items.map(this._cardView),
      sections: view.sections.map((s) => ({
        ...s,
        items: s.items.map(this._cardView),
      })),
      matched: view.matched,
      itemCount: view.total,
      activeCount: view.active,
      doneCount: view.done,
      groups: view.groups,
      selected: selected || null,
      currentRows: all
        .filter((r) => r.id === this.data.currentCaptureId)
        .map((r) => ({
          id: r.id,
          text: r.data.text,
          status: r.data.status,
          error: r.data.error || "",
          summary: (r.data.result && r.data.result.summary) || "",
          items: itemsFor([r]).slice(0, 60).map(this._cardView),
          attachments: (r.data.attachments || []).filter((f) => !f.deletedAt),
        })),
      localCount: this._localWorkspace()
        .records()
        .filter((r) => !r.purged && !r.deletedAt).length,
    });
  },
  _localWorkspace() {
    return createLocalWorkspace(
      () => wx.getStorageSync(LOCAL),
      (value) => wx.setStorageSync(LOCAL, value),
    );
  },
  _library() {
    if (!wx.env || !wx.getFileSystemManager) return null;
    if (!this._files)
      this._files = createFileLibrary({
        read: () => wx.getStorageSync(FILES),
        write: (value) => wx.setStorageSync(FILES, value),
        fs: wx.getFileSystemManager(),
        root: `${wx.env.USER_DATA_PATH}/shixu-originals`,
      });
    return this._files;
  },
  _fileEntries(packetId, space) {
    if (!packetId || !this._library()) return [];
    const entries = this._library().entries(packetId, space);
    // A retained local copy and its remote import may share one original.
    return entries.filter(
      (e, i) => entries.findIndex((f) => f.id === e.id) === i,
    );
  },
  chooseFiles() {
    if (this.data.filesBusy) return;
    this.setData({ filesBusy: true });
    wx.chooseMessageFile({
      count: 20,
      type: "all",
      success: (answer) => this._collectFiles(answer.tempFiles),
      fail: () => this.setData({ notice: "未选择文件，现有草稿已保留" }),
      complete: () => this.setData({ filesBusy: false }),
    });
  },
  chooseImages() {
    if (this.data.filesBusy) return;
    this.setData({ filesBusy: true });
    wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (answer) => this._collectFiles(answer.tempFiles),
      fail: () => this.setData({ notice: "未选择图片，现有草稿已保留" }),
      complete: () => this.setData({ filesBusy: false }),
    });
  },
  _collectFiles(files) {
    try {
      if (!this._draftId) this._draftId = makeId();
      // Persist the owner ID before copying a temporary file to durable storage.
      wx.setStorageSync(DRAFT, { id: this._draftId, text: this.data.draft });
      const library = this._library();
      if (!library) throw new Error("当前环境暂不支持原件保存");
      for (const file of files) {
        if (this._fileEntries(this._draftId).length >= 20)
          throw new Error("一次投递最多 20 份原件");
        library.add(file, this._draftId);
      }
      this.setData({
        error: "",
        notice: "原件已保存在本机；丢进去后与文字一起投递",
      });
    } catch (error) {
      this._error(error);
    }
    this._refresh();
  },
  removeDraftFile(event) {
    try {
      this._library().removeDraft(
        event.currentTarget.dataset.id,
        this._draftId,
      );
      this._refresh();
    } catch (error) {
      this._error(error);
    }
  },
  async _uploadFiles(epoch) {
    const library = this._library();
    if (!library || this.data.filesBusy || !this.data.capabilities.attachments)
      return;
    const base = this._connection.base,
      transport = createFileTransport(base, () => this._connection.token);
    this.setData({ filesBusy: true });
    try {
      let changed = false;
      for (const entry of library
        .entries(null, base)
        .filter((e) => !e.remote)) {
        const row = this._record(entry.packetId);
        if (!row || row.deletedAt || row.conflict) continue;
        const result = await transport.upload(
          entry,
          library.bytes(entry),
          epoch,
        );
        const confirmed = library.confirmation(entry, result.file);
        // Queue the reference durably before marking the transfer acknowledged.
        const latest = this._record(entry.packetId);
        if (!latest || latest.deletedAt || latest.conflict)
          throw new Error("投递状态已变化，原件上传结果保留，恢复或核对后重试");
        this._client.put(entry.packetId, {
          attachments: [
            ...(latest.data.attachments || []).filter((f) => f.id !== entry.id),
            confirmed,
          ],
        });
        library.markUploaded(entry, confirmed);
        changed = true;
      }
      if (changed) await this._client.sync();
    } finally {
      this.setData({ filesBusy: false });
    }
  },
  async openAttachment(event) {
    if (this.data.filesBusy) return;
    this.setData({ filesBusy: true });
    try {
      const { id, packet } = event.currentTarget.dataset,
        row = this._record(packet);
      if (!row || row.deletedAt) throw new Error("请先恢复整次投递");
      const file = (row.data.attachments || []).find(
        (f) => f.id === id && !f.deletedAt,
      );
      if (!file) throw new Error("附件不存在");
      const library = this._library();
      if (!library) throw new Error("当前环境不支持原件预览");
      const space = this.data.localMode ? "local" : this._connection.base;
      let entry = library.entries(packet, space).find((e) => e.id === id),
        path;
      if (entry) {
        try {
          path = library.path(entry);
        } catch {
          if (this.data.localMode)
            throw new Error("本机原件缺失，请保留资料后核对");
        }
      }
      if (!path) {
        if (!this._epoch) await this.sync();
        if (!this._epoch) throw new Error("请先完成同步并核对服务资料版本");
        const bytes = await createFileTransport(
          this._connection.base,
          () => this._connection.token,
        ).download(packet, id, this._epoch);
        const latest = this._record(packet);
        if (
          !latest ||
          latest.deletedAt ||
          !(latest.data.attachments || []).some(
            (f) => f.id === id && !f.deletedAt,
          )
        )
          throw new Error("投递状态已变化，未保存下载的原件");
        path = library.cache(file, packet, space, bytes);
      }
      const ext = extension(file.name);
      if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext))
        wx.previewImage({
          urls: [path],
          current: path,
          fail: () => this._error(new Error("图片预览失败，原件仍保留")),
        });
      else if (
        ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf"].includes(ext)
      )
        wx.openDocument({
          filePath: path,
          fileType: ext,
          showMenu: true,
          fail: () =>
            this._error(new Error("微信暂时无法打开这份原件，文件已保留")),
        });
      else if (
        /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|c|cpp|h|rs|go|sql|log)$/i.test(
          file.name,
        )
      ) {
        if (file.size > 400000)
          throw new Error("原件已保存；文字超过预览上限，请使用原文件查看");
        const text = wx.getFileSystemManager().readFileSync(path, "utf8");
        if (typeof text !== "string")
          throw new Error("当前环境无法解码这份文字，原件已保留");
        this.setData({
          originalPreview: {
            name: file.name,
            text: text.slice(0, 60000),
            truncated: text.length > 60000,
          },
        });
      } else
        this.setData({
          notice: "原件已完整保存在本机；此格式暂不支持微信内预览",
        });
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ filesBusy: false });
    }
  },
  closeOriginal() {
    this.setData({ originalPreview: null });
  },
  _cardView(row) {
    const { item, meta, search, ...view } = row;
    return {
      ...view,
      title: row.title.slice(0, 150),
      summary: row.summary.slice(0, 220),
    };
  },
  _presentDetail(row) {
    if (!row) return null;
    const { meta, search, ...view } = row;
    return {
      ...view,
      sourceText: row.sourceText.slice(0, 20000),
      sources: row.sources
        .slice(0, 10)
        .map((s) => ({ ...s, text: (s.text || "").slice(0, 2000) })),
      additions: row.additions
        .slice(-20)
        .map((a) => ({ ...a, text: a.text.slice(0, 2000) })),
      chat: row.chat.slice(-16),
      history: row.history.slice(-20).map((h) => ({
        ...h,
        before: String(h.before || "").slice(0, 1000),
        after: String(h.after || "").slice(0, 1000),
      })),
    };
  },
  _activateLocal() {
    this._client = this._localWorkspace();
    this._connection = null;
    this._transport = null;
    this._jobs = [];
    this.setData({
      localMode: true,
      connected: false,
      jobs: [],
      capabilities: {},
    });
    this._refresh();
  },
  useLocal() {
    if (
      this.data.syncing ||
      this.data.connecting ||
      this.data.jobBusy ||
      this.data.filesBusy
    )
      return;
    // Remote outbox remains durable under its original service URL.
    try {
      wx.setStorageSync(CONNECTION, null);
      this._activateLocal();
      this.setData({
        tab: "capture",
        notice: "已切换到本机资料，服务端资料及未同步操作仍保留",
      });
    } catch (error) {
      this._error(error);
    }
  },
  async importLocal() {
    if (this.data.localMode || this.data.syncing) return;
    try {
      await this.sync();
      if (this.data.error) return;
      const local = this._localWorkspace()
        .records()
        .filter((r) => !r.purged && !r.deletedAt);
      const remote = this._client.records();
      for (const row of local) {
        const existing = remote.find((r) => r.id === row.id);
        if (
          existing &&
          JSON.stringify({ ...existing.data, attachments: [] }) !==
            JSON.stringify({ ...row.data, attachments: [] })
        )
          throw new Error(
            "服务中已有不同的同名投递，本机原件仍保留，请核对后再导入",
          );
        if (!existing)
          this._client.put(row.id, { ...row.data, attachments: [] });
        if (this._library())
          this._library().copySpace(row.id, "local", this._connection.base);
      }
      await this.sync();
      this.setData({ notice: "导入操作已保存，本机原件保留；以同步状态为准" });
    } catch (error) {
      this._error(error);
    }
    this._refresh();
  },
  _error(error) {
    this.setData({ error: error.message || "操作未完成，请稍后重试" });
  },
  onDraft(event) {
    const draft = event.detail.value;
    if (!this._draftId) this._draftId = makeId();
    this.setData({ draft });
    try {
      wx.setStorageSync(DRAFT, { id: this._draftId, text: draft });
      this.setData({ error: "" });
    } catch (_) {
      this.setData({ error: "草稿保存失败，请先复制保留文字，再释放存储空间" });
    }
  },
  onServer(event) {
    this.setData({ serverUrl: event.detail.value });
  },
  onPassword(event) {
    this.setData({ password: event.detail.value });
  },
  switchTab(event) {
    const target = event.currentTarget.dataset.tab;
    if (target === "settings") {
      if (this.data.tab === "settings") return this.closeSettings();
      this.setData({ settingsReturnTab: this.data.tab });
    }
    this._stopSkinInteraction();
    this.setData({ tab: target, notice: "" });
    this._refresh();
  },
  closeSettings() {
    this.setData({
      tab: ["world", "ddl"].includes(this.data.settingsReturnTab)
        ? this.data.settingsReturnTab
        : "capture",
    });
    this._refresh();
  },
  openAiSettings() {
    if (this.data.tab !== "settings")
      this.setData({ settingsReturnTab: this.data.tab });
    this._stopSkinInteraction();
    this.setData({ tab: "settings", showAiGuide: true, selected: null });
    if (this.data.connected) return this.refreshAiStatus();
  },
  toggleAiGuide() {
    this.setData({ showAiGuide: !this.data.showAiGuide });
  },
  async refreshAiStatus() {
    if (!this._transport || this.data.aiChecking) return;
    this.setData({ aiChecking: true, error: "" });
    try {
      const status = await this._transport("GET", "/api/v2/status");
      if (status.application !== "shixu-sync" || status.protocolVersion !== 2)
        throw new Error("该地址不是兼容的拾序同步服务");
      this.setData({ capabilities: status.capabilities || {} });
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ aiChecking: false });
    }
  },
  toggleDeleted() {
    this.setData({ showDeleted: !this.data.showDeleted, recordPage: 0 });
    this._refresh();
  },
  expand(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? "" : id });
  },
  async connect() {
    if (
      this.data.connecting ||
      this.data.syncing ||
      this.data.jobBusy ||
      this.data.filesBusy
    )
      return;
    this.setData({ connecting: true, error: "", notice: "" });
    try {
      const base = normalizeServiceURL(
        this.data.serverUrl,
        wx.getAccountInfoSync().miniProgram.envVersion,
      );
      if (
        this._connection &&
        this._connection.base !== base &&
        this._client.pendingCount()
      )
        throw new Error("当前服务还有未同步操作，请先完成同步再切换服务地址");
      const transport = createTransport(base, () => null);
      const status = await transport("GET", "/api/v2/status");
      if (status.application !== "shixu-sync" || status.protocolVersion !== 2)
        throw new Error("该地址不是兼容的拾序同步服务");
      const previous = wx.getStorageSync(stateKey(base));
      if (previous && previous.epoch && previous.epoch !== status.epoch)
        throw new Error("服务器资料版本已变化，本机内容已保留，请先核对资料");
      const device = await transport("POST", "/api/v2/devices", {
        password: this.data.password,
        name: "拾序微信小程序",
      });
      const connection = {
        base,
        epoch: device.epoch,
        token: device.token,
        deviceId: device.deviceId,
        expiresAt: device.expiresAt,
      };
      this.setData({ capabilities: status.capabilities || {} });
      this._activate(connection);
      wx.setStorageSync(CONNECTION, connection);
      this.setData({ password: "", notice: "已连接，正在核对资料" });
      await this.sync();
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ connecting: false });
    }
  },
  async sync() {
    if (!this._client || this.data.localMode || this.data.syncing) return;
    this.setData({ syncing: true });
    try {
      const result = await this._client.sync();
      this._epoch = result.epoch;
      this.setData({ capabilities: result.capabilities || {} });
      await this._uploadFiles(result.epoch);
      await this._pollJobs();
      const pendingFiles = this._library()
        ? this._library()
            .entries(null, this._connection.base)
            .filter(
              (e) =>
                !e.remote &&
                this._record(e.packetId) &&
                !this._record(e.packetId).deletedAt,
            ).length
        : 0;
      this.setData({
        error: "",
        notice: result.conflicts
          ? "有修改冲突，本机副本已保留"
          : pendingFiles
            ? `还有 ${pendingFiles} 份原件保存在本机，尚未完成上传`
            : "资料已同步",
      });
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ syncing: false });
      this._refresh();
    }
  },
  syncQuietly() {
    if (this._client && !this.data.localMode) return this.sync();
  },
  submit() {
    if (
      this.data.filesBusy ||
      (!this.data.draft.trim() && !this.data.draftFiles.length)
    )
      return;
    if (!this._client) {
      this.setData({
        tab: "settings",
        notice: "草稿已保留，请先连接自己的同步服务",
      });
      return;
    }
    try {
      const text = this.data.draft;
      const id = this._draftId || this._client.newId();
      this._draftId = id;
      const originals = this._fileEntries(id);
      if (this._library())
        this._library().assign(
          id,
          this.data.localMode ? "local" : this._connection.base,
        );
      this._client.put(id, {
        id,
        text,
        ...dateInfo(),
        sources: text.trim() ? [{ id: "input", name: "随手输入", text }] : [],
        attachments: this.data.localMode
          ? originals.map((e) => this._library().metadata(e))
          : [],
        status: "pending",
        result: null,
        error: "",
        doneIds: [],
      });
      // Queue persistence happens before clearing the draft.
      wx.setStorageSync(DRAFT, "");
      this._draftId = null;
      this.setData({
        draft: "",
        currentCaptureId: id,
        notice: this.data.localMode
          ? "已保存在本机；可手动记成事项，连接后再同步和整理"
          : "文字已保存，等待整理",
        skinMessage: this.data.activeSkin.feeding,
        skinAnimating: true,
      });
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  _record(id) {
    return this._client.records().find((r) => r.id === id && !r.purged);
  },
  _detail(id) {
    const row = itemsFor(this._client.records()).find((r) => r.id === id);
    if (!row) return null;
    const record = this._record(row.packetId),
      p = record.data;
    return {
      ...row,
      sourceText: p.text || "",
      sources: p.sources || [],
      attachments: p.attachments || [],
      evidence: (row.item.evidence || []).map((e) => ({
        ...e,
        name:
          ((p.sources || []).find((s) => s.id === e.sourceId) || {}).name ||
          e.sourceId,
      })),
      facts: row.item.facts || [],
      nextSteps: row.item.nextSteps || [],
      uncertainties: row.item.uncertainties || [],
      additions: row.meta.additions || [],
      history: row.meta.history || [],
      chat: row.meta.chat || [],
      checked: (row.meta.checkins || []).includes(localDay()),
    };
  },
  openItem(event) {
    this.setData({
      selected: this._presentDetail(
        this._detail(event.currentTarget.dataset.id),
      ),
      editing: false,
      addition: "",
      error: "",
    });
  },
  loadMoreDdl() {
    this.setData({ ddlLimit: this.data.ddlLimit + 60 });
    this._refresh();
  },
  setDdlWindow(event) {
    this.setData({
      ddlIndex: Math.max(0, Math.min(4, Number(event.detail.value))),
    });
    this._refresh();
  },
  previewDdlWindow(event) {
    this.setData({
      ddlIndex: Math.max(0, Math.min(4, Number(event.detail.value))),
    });
  },
  chooseDdlWindow(event) {
    this.setDdlWindow({ detail: { value: event.currentTarget.dataset.index } });
  },
  toggleDdl(event) {
    const field = event.currentTarget.dataset.field;
    if (
      ["ddlShowOverdue", "ddlShowUnsure", "ddlShowDone", "ddlAddOpen"].includes(
        field,
      )
    )
      this.setData({ [field]: !this.data[field] });
  },
  onDdlField(event) {
    const field = event.currentTarget.dataset.field;
    if (["ddlTitle", "ddlDate", "ddlTime", "ddlRequirements"].includes(field))
      this.setData({ [field]: event.detail.value });
  },
  verifyDdl(event) {
    this.openItem(event);
    this.beginEdit();
  },
  addDdl() {
    try {
      const title = this.data.ddlTitle.trim();
      if (!title) throw new Error("请填写事项标题");
      let due;
      try {
        due = parseDeadline(
          this.data.ddlDate,
          localDay(),
          this.data.ddlTime.trim(),
        );
      } catch {
        due = null;
      }
      const id = makeId(),
        itemId = makeId(),
        text = `${title}；截止 ${this.data.ddlDate} ${this.data.ddlTime}；${this.data.ddlRequirements}`;
      const item = absoluteItem(
        {
          kind: "task",
          title,
          summary: this.data.ddlRequirements.trim(),
          facts: [],
          nextSteps: [],
          uncertainties: due ? [] : [`时间待确认：${this.data.ddlDate}`],
          due,
          evidence: [{ sourceId: "manual", quote: text }],
          sourceIds: ["manual"],
        },
        localDay(),
      );
      this._client.put(id, {
        id,
        text,
        sources: [{ id: "manual", name: "我的补充", text }],
        attachments: [],
        ...dateInfo(),

        status: "ready",
        result: { summary: "手动补充 DDL", items: [item], warnings: [] },
        itemIds: [itemId],
        itemState: { [itemId]: { origin: "manual", corrected: true } },
        doneIds: [],
        error: "",
      });
      this.setData({
        ddlTitle: "",
        ddlDate: "",
        ddlTime: "",
        ddlRequirements: "",
        notice: "DDL 已补充",
      });
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  closeItem() {
    this.setData({ selected: null, editing: false });
  },
  stopTap() {},
  onQuery(event) {
    this.setData({ query: event.detail.value, limit: 60 });
    this._refresh();
  },
  setScope(event) {
    const scope = event.currentTarget.dataset.scope;
    this.setData({ scope, showDeleted: scope === "trash", limit: 60 });
    this._refresh();
  },
  setKind(event) {
    const i = Number(event.detail.value);
    this.setData({ kindIndex: i, kind: this.data.kindKeys[i], limit: 60 });
    this._refresh();
  },
  setSort(event) {
    const i = Number(event.detail.value),
      sort = this.data.sortKeys[i];
    try {
      wx.setStorageSync(FILTERS, { sort });
      this.setData({ sortIndex: i, sort });
      this._refresh();
    } catch (error) {
      this._error(error);
    }
  },
  setDate(event) {
    const i = Number(event.detail.value);
    this.setData({
      dateIndex: i,
      dateFilter: this.data.dateKeys[i],
      limit: 60,
    });
    this._refresh();
  },
  toggleStarFilter() {
    this.setData({ starOnly: !this.data.starOnly, limit: 60 });
    this._refresh();
  },
  toggleGrouped() {
    this.setData({ grouped: !this.data.grouped });
  },
  setGroup(event) {
    this.setData({ group: event.currentTarget.dataset.group, limit: 60 });
    this._refresh();
  },
  loadMore() {
    this.setData({ limit: this.data.limit + 60 });
    this._refresh();
  },
  toggleRecords() {
    this.setData({ recordsOpen: !this.data.recordsOpen });
  },
  recordPage(event) {
    const next =
      this.data.recordPage + Number(event.currentTarget.dataset.step);
    if (next < 0 || next * 30 >= this.data.recordTotal) return;
    this.setData({ recordPage: next });
    this._refresh();
  },
  _changeItem(id, changes) {
    const row = itemsFor(this._client.records()).find((r) => r.id === id);
    if (!row || row.packetDeleted) throw new Error("请先恢复整次投递");
    const patch = statePatch(this._record(row.packetId).data, row, changes);
    this._client.put(row.packetId, patch);
    if (
      this.data.selected &&
      this.data.selected.id === id &&
      patch.itemIds[row.index] !== id
    )
      this.setData({
        selected: { ...this.data.selected, id: patch.itemIds[row.index] },
      });
    this._refresh();
    this.syncQuietly();
  },
  toggleDone(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      this._changeItem(row.id, {
        status: row.done ? "active" : "done",
        completedAt: row.done ? "" : new Date().toISOString(),
      });
    } catch (error) {
      this._error(error);
    }
  },
  toggleStar(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      this._changeItem(row.id, { starred: !row.starred });
    } catch (error) {
      this._error(error);
    }
  },
  togglePin(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      this._changeItem(row.id, { pinned: !row.pinned });
    } catch (error) {
      this._error(error);
    }
  },
  progressItem(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      this._changeItem(row.id, {
        status: row.progress ? "active" : "progress",
      });
    } catch (error) {
      this._error(error);
    }
  },
  removeItem(event) {
    try {
      this._changeItem(event.currentTarget.dataset.id, {
        deletedAt: new Date().toISOString(),
      });
      this.closeItem();
    } catch (error) {
      this._error(error);
    }
  },
  restoreItem(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      if (row.packetDeleted) this._client.restore(row.packetId);
      else this._changeItem(row.id, { deletedAt: "" });
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  checkin(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id),
        day = localDay(),
        old = row.meta.checkins || [];
      this._changeItem(row.id, {
        checkins: old.includes(day)
          ? old.filter((d) => d !== day)
          : [...old, day],
      });
    } catch (error) {
      this._error(error);
    }
  },
  purgeItem(event) {
    const id = event.currentTarget.dataset.id,
      row = this._detail(id);
    if (!row || !row.deleted) return;
    wx.showModal({
      title: "永久删除这张事项卡片？",
      content:
        "无法撤销。整次投递的原文和其他事项仍保留；删除整次投递请在投递记录中操作。",
      success: (answer) => {
        if (!answer.confirm) return;
        try {
          if (row.packetDeleted)
            throw new Error("请在投递记录中恢复整次投递后单独删除卡片");
          this._changeItem(id, { purgedAt: new Date().toISOString() });
          this.closeItem();
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  purgePacket(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "永久删除整次投递？",
      content: "此投递的原文、事项和补充都将被删除，无法撤销。",
      success: (answer) => {
        if (!answer.confirm) return;
        try {
          this._client.purge(id);
          this._refresh();
          this.syncQuietly();
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  beginEdit() {
    const row = this.data.selected;
    if (!row || row.deleted) return;
    this.setData({
      editing: true,
      editTitle: row.item.title,
      editSummary: row.item.summary || "",
      editGroup: row.group,
      editDate: row.startDate ? row.timeLabel.replace(" → ", " 至 ") : row.date,
      editTime: row.startDate ? "" : row.time,
      editKind: Object.keys(KINDS).indexOf(row.kind),
    });
  },
  onEdit(event) {
    const field = event.currentTarget.dataset.field;
    if (
      [
        "editTitle",
        "editSummary",
        "editGroup",
        "editDate",
        "editTime",
        "addition",
        "manualTitle",
        "chatInput",
      ].includes(field)
    )
      this.setData({ [field]: event.detail.value });
  },
  onEditKind(event) {
    this.setData({ editKind: Number(event.detail.value) });
  },
  cancelEdit() {
    this.setData({ editing: false });
  },
  saveEdit() {
    try {
      const row = this._detail(this.data.selected.id),
        record = this._record(row.packetId),
        title = this.data.editTitle.trim();
      if (!title || title.length > 150) throw new Error("标题应为 1 至 150 字");
      const due = this.data.editDate.trim()
        ? parseDeadline(
            this.data.editDate,
            localDay(),
            this.data.editTime.trim(),
          )
        : null;
      const previous = record.data.result.items[row.index];
      const next = setDeadline(
        {
          ...previous,
          title: absoluteItem(
            { ...previous, title, summary: this.data.editSummary.trim() },
            localDay(),
          ).title,
          summary: absoluteItem(
            { ...previous, title, summary: this.data.editSummary.trim() },
            localDay(),
          ).summary,
          kind: Object.keys(KINDS)[this.data.editKind],
        },
        due,
        record.data.captureDate,
      );
      const history = [
        ...(row.meta.history || []),
        ...["title", "summary", "kind", "due"]
          .filter(
            (field) =>
              JSON.stringify(next[field]) !== JSON.stringify(previous[field]),
          )
          .map((field) => ({
            at: new Date().toISOString(),
            field,
            before: JSON.stringify(previous[field]),
            after: JSON.stringify(next[field]),
            source: "手动编辑",
          })),
      ];
      const result = {
        ...record.data.result,
        items: record.data.result.items.map((item, i) =>
          i === row.index ? next : item,
        ),
      };
      const patch = statePatch(record.data, row, {
        group: this.data.editGroup.trim(),
        history,
        corrected: true,
      });
      this._client.put(row.packetId, { ...patch, result });
      this.setData({ editing: false });
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  addNote() {
    try {
      const row = this._detail(this.data.selected.id),
        text = this.data.addition.trim();
      if (!text) return;
      this._changeItem(row.id, {
        additions: [
          ...(row.meta.additions || []),
          { id: makeId(), text, at: new Date().toISOString() },
        ],
      });
      this.setData({ addition: "" });
    } catch (error) {
      this._error(error);
    }
  },
  moveItem(event) {
    try {
      const id = event.currentTarget.dataset.id,
        direction = Number(event.currentTarget.dataset.direction);
      const full = worldView(this._client.records(), {
        scope: this.data.scope,
        sort: "custom",
        limit: Number.MAX_SAFE_INTEGER,
      }).items;
      const visible = worldView(this._client.records(), {
        ...this.data,
        sort: "custom",
        limit: Number.MAX_SAFE_INTEGER,
      }).items;
      const row = visible.find((r) => r.id === id),
        siblings = this.data.grouped
          ? visible.filter((r) => r.group === row.group)
          : visible;
      const index = siblings.findIndex((r) => r.id === id),
        target = index + direction;
      if (target < 0 || target >= siblings.length) return;
      [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      // mergeCardOrder needs the original visible slots, independent of the reordered copy.
      const reordered = mergeCardOrder(
        full.map((r) => r.id),
        full
          .filter((r) => siblings.some((s) => s.id === r.id))
          .map((r) => r.id),
        siblings.map((r) => r.id),
      );
      const packetPatches = new Map();
      reordered.forEach((itemId, order) => {
        const moved = full.find((r) => r.id === itemId),
          previous = packetPatches.get(moved.packetId) || {},
          packet = this._record(moved.packetId).data;
        const patch = statePatch(
          {
            ...packet,
            ...previous,
            itemState: { ...packet.itemState, ...previous.itemState },
          },
          moved,
          { order },
        );
        packetPatches.set(moved.packetId, {
          ...patch,
          itemState: { ...previous.itemState, ...patch.itemState },
        });
      });
      for (const [packetId, patch] of packetPatches)
        this._client.put(packetId, patch);
      this.setData({ sort: "custom", sortIndex: 4 });
      wx.setStorageSync(FILTERS, { sort: "custom" });
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._refresh();
      this._error(error);
    }
  },
  createManual(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "手动记成事项",
      editable: true,
      placeholderText: "输入事项标题",
      success: (answer) => {
        if (!answer.confirm || !answer.content || !answer.content.trim())
          return;
        try {
          const row = this._record(id);
          if (!row || row.deletedAt) throw new Error("请先恢复投递");
          const item = {
            kind: "task",
            title: answer.content.trim().slice(0, 150),
            summary: row.data.text,
            facts: [],
            nextSteps: [],
            uncertainties: [],
            evidence: [],
            sourceIds: (row.data.sources || []).map((s) => s.id),
            due: null,
          };
          const result = row.data.result || {
              summary: "手动记录",
              items: [],
              warnings: [],
            },
            itemId = makeId();
          this._client.put(id, {
            result: { ...result, items: [...result.items, item] },
            itemIds: [
              ...(row.data.itemIds ||
                result.items.map((_, i) => `${id}_item_${i}`)),
              itemId,
            ],
            itemState: { [itemId]: { origin: "manual" } },
            status: "ready",
            updatedAt: new Date().toISOString(),
          });
          this._refresh();
          this.syncQuietly();
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  copySource() {
    if (this.data.selected)
      wx.setClipboardData({
        data: this._record(this.data.selected.packetId).data.text,
      });
  },
  copyRecord(event) {
    const row = this._record(event.currentTarget.dataset.id);
    if (row) wx.setClipboardData({ data: row.data.text || "" });
  },
  _jobViews(jobs) {
    return jobs.map(({ id, state, error, output }) => ({
      id,
      state,
      error,
      hasOutput: !!output,
    }));
  },
  _saveJobs(jobs) {
    wx.setStorageSync(jobsKey(this._connection.base), jobs);
    this._jobs = jobs;
    this.setData({ jobs: this._jobViews(jobs) });
  },
  async _pollJobs() {
    if (this._pollingJobs || !this._connection || !this._jobs) return;
    this._pollingJobs = true;
    try {
      const records = this._client.records();
      for (const saved of this._jobs.slice()) {
        const record = records.find((r) => r.id === saved.request.packetId);
        if (record && record.purged) {
          this._saveJobs(this._jobs.filter((j) => j.id !== saved.id));
          continue;
        }
        if (
          !["submitting", "queued", "running", "applying"].includes(saved.state)
        )
          continue;
        let job;
        try {
          job =
            saved.state === "submitting"
              ? await this._transport("POST", "/api/v2/jobs", saved.request)
              : await this._transport("GET", `/api/v2/jobs/${saved.id}`);
        } catch (error) {
          if ([400, 403, 404, 409, 422, 503].includes(error.status)) {
            this._saveJobs(
              this._jobs.map((j) =>
                j.id === saved.id
                  ? { ...j, state: "error", error: error.message }
                  : j,
              ),
            );
            continue;
          }
          throw error;
        }
        this._saveJobs(
          this._jobs.map((j) => (j.id === saved.id ? { ...j, ...job } : j)),
        );
        if (job.state === "done") await this._client.sync();
      }
    } finally {
      this._pollingJobs = false;
    }
  },
  async _startJob(kind, packetId, itemId, instruction) {
    if (this.data.jobBusy) return;
    if (this.data.localMode) {
      this.openAiSettings();
      this._error(
        new Error("请先连接配置了 AI 的同步服务，并导入这次本机投递"),
      );
      return;
    }
    this.setData({ jobBusy: true, error: "" });
    try {
      await this.sync();
      if (
        this.data.error ||
        this._client.pendingCount() ||
        this.data.pendingFiles
      )
        throw new Error(this.data.error || "请先完成未同步操作");
      if (
        !(kind === "chat"
          ? this.data.capabilities.itemChat
          : this.data.capabilities.aiOrganize)
      ) {
        this.openAiSettings();
        throw new Error("服务器尚未启用此 AI 能力，原文和事项已保留");
      }
      const record = this._record(packetId);
      if (!record || record.deletedAt || record.conflict)
        throw new Error("请先恢复投递并解决同步冲突");
      const status = await this._transport("GET", "/api/v2/status");
      const request = {
        id: makeId(),
        kind,
        packetId,
        baseVersion: record.version,
        epoch: status.epoch,
        ...(kind === "chat" ? { itemId, instruction } : {}),
      };
      const entry = { id: request.id, request, state: "submitting", error: "" };
      // Do not evict active requests; they may already have incurred a model charge.
      const jobs = this._jobs || [],
        active = jobs.filter((j) =>
          ["submitting", "queued", "running", "applying"].includes(j.state),
        );
      if (active.length >= 20) throw new Error("任务较多，请等待已有任务完成");
      this._saveJobs([
        ...jobs.filter((j) => !active.includes(j)).slice(-19),
        ...active,
        entry,
      ]);
      await this._pollJobs();
      const submitted = this._jobs.find((j) => j.id === entry.id);
      if (submitted?.state === "error")
        throw new Error(submitted.error || "模型任务未创建，请核对后重试");
      this.setData({
        notice: "模型任务已保存；可继续操作，结果就绪后自动同步",
        chatInput: "",
      });
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ jobBusy: false });
      this._refresh();
    }
  },
  organizeRecord(event) {
    return this._startJob("organize", event.currentTarget.dataset.id);
  },
  chatWithItem() {
    const row = this.data.selected,
      text = this.data.chatInput.trim();
    if (row && text) return this._startJob("chat", row.packetId, row.id, text);
  },
  copyJobResult(event) {
    const job = (this._jobs || []).find(
      (j) => j.id === event.currentTarget.dataset.id,
    );
    if (job && job.output)
      wx.setClipboardData({ data: JSON.stringify(job.output, null, 2) });
  },
  _loadSkins() {
    const collection = this._skinCollection || {
      selected: "whale",
      custom: [],
    };
    const skins = [...BUILTIN_SKINS, ...collection.custom].map((s) => ({
      ...s,
      image:
        s.art === "custom"
          ? this._skinPath(s)
          : s.art === "whale"
            ? "/assets/mascot.png"
            : `/assets/skins/${s.id}.png`,
    }));
    const activeSkin =
      skins.find((s) => s.id === collection.selected) || skins[0];
    this.setData({
      skins,
      activeSkin,
      previewSkin: activeSkin,
      skinMessage: activeSkin.hello,
    });
  },
  _skinPath(skin) {
    if (!wx.env || !wx.getFileSystemManager) return skin.image;
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(skin.image);
    const file = `${wx.env.USER_DATA_PATH}/shixu-${skin.id}.${match[1]}`;
    // Local files keep eight custom images from overflowing WeChat's setData limit.
    wx.getFileSystemManager().writeFileSync(file, match[2], "base64");
    return file;
  },
  openSkins() {
    this._stopSkinInteraction();
    this.setData({
      skinOpen: true,
      previewSkin: this.data.activeSkin,
      skinMessage: this.data.activeSkin.hello,
      skinEditor: false,
    });
  },
  closeSkins() {
    this._stopSkinInteraction();
    this.setData({
      skinOpen: false,
      skinEditor: false,
      skinMessage: this.data.activeSkin.hello,
      skinAnimating: false,
    });
  },
  previewSkin(event) {
    this._stopSkinInteraction();
    const s = this.data.skins.find(
      (s) => s.id === event.currentTarget.dataset.id,
    );
    if (s)
      this.setData({
        previewSkin: s,
        skinMessage: s.hello,
        skinAnimating: false,
      });
  },
  interactSkin() {
    const s = this.data.skinOpen ? this.data.previewSkin : this.data.activeSkin;
    this._stopSkinInteraction();
    this.setData({
      skinMessage: s.greeting,
      skinAnimating: true,
    });
    if (s.art === "whale" && this._prepareSkinAudio()) {
      try {
        this._skinAudio.play();
      } catch (_) {
        this.setData({
          skinAnimating: false,
          notice: "声音暂时不可用，资料保存不受影响",
        });
      }
    } else
      this._skinTimer = setTimeout(
        () => this.setData({ skinAnimating: false }),
        3200,
      );
  },
  _stopSkinInteraction() {
    clearTimeout(this._skinTimer);
    try {
      if (this._skinAudio) this._skinAudio.stop();
    } catch (_) {}
    this.setData({ skinAnimating: false });
  },
  _prepareSkinAudio() {
    if (this._skinAudio) return true;
    if (!wx.createInnerAudioContext) return false;
    let audio;
    try {
      audio = wx.createInnerAudioContext();
      audio.onEnded(() => this.setData({ skinAnimating: false }));
      audio.onError(() => this.setData({ skinAnimating: false }));
      audio.volume = 0.5;
      audio.src = "/assets/laugh.mp3";
      this._skinAudio = audio;
      return true;
    } catch (_) {
      try {
        if (audio) audio.destroy();
      } catch (_) {}
      return false;
    }
  },
  feedSkin() {
    this._stopSkinInteraction();
    const s = this.data.skinOpen ? this.data.previewSkin : this.data.activeSkin;
    this.setData({
      skinMessage: s.feeding,
      skinAnimating: !this.data.skinAnimating,
    });
  },
  _saveSkins(collection) {
    const raw = JSON.stringify(collection);
    if (raw.length > 2000000) throw new Error("皮肤收藏空间已满");
    wx.setStorageSync(SKINS, raw);
    this._skinCollection = collection;
    this._loadSkins();
  },
  applySkin() {
    this._stopSkinInteraction();
    try {
      this._saveSkins({
        ...this._skinCollection,
        selected: this.data.previewSkin.id,
      });
    } catch (error) {
      this._error(error);
    }
  },
  editSkin(event) {
    const id = event.currentTarget.dataset.id,
      old = (this._skinCollection.custom || []).find((s) => s.id === id);
    const skin = old || {
      id: `custom-${makeId()}`,
      name: "我的伙伴",
      description: "自己做的好朋友",
      art: "custom",
      color: "#ffe2b5",
      motion: "bounce",
      hello: "先放进来，慢慢理清楚。",
      greeting: "今天也陪着你！",
      feeding: "收到啦！",
      image: "",
    };
    this.setData({
      skinEditor: true,
      skinForm: skin,
      motionIndex: Object.keys(SKIN_MOTIONS).indexOf(skin.motion),
    });
  },
  onSkinField(event) {
    const field = event.currentTarget.dataset.field;
    if (["name", "description", "hello", "greeting", "feeding"].includes(field))
      this.setData({
        skinForm: { ...this.data.skinForm, [field]: event.detail.value },
      });
  },
  onMotion(event) {
    const i = Number(event.detail.value);
    this.setData({
      motionIndex: i,
      skinForm: { ...this.data.skinForm, motion: this.data.motionKeys[i] },
    });
  },
  chooseSkinImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (answer) => {
        const file = answer.tempFiles[0];
        if (file.size > 250000) {
          this._error(new Error("请选择小于 250 KB 的 PNG、JPG 或 WebP 图片"));
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: "base64",
          success: (result) => {
            const type = /\.png$/i.test(file.tempFilePath)
              ? "png"
              : /\.webp$/i.test(file.tempFilePath)
                ? "webp"
                : "jpeg";
            this.setData({
              skinForm: {
                ...this.data.skinForm,
                image: `data:image/${type};base64,${result.data}`,
              },
            });
          },
          fail: () => this._error(new Error("图片读取失败")),
        });
      },
    });
  },
  saveCustomSkin() {
    try {
      const skin = this.data.skinForm,
        custom = (this._skinCollection.custom || []).filter(
          (s) => s.id !== skin.id,
        );
      if (custom.length >= MAX_CUSTOM_SKINS)
        throw new Error("最多收藏 8 款自定义皮肤");
      const candidate = { selected: skin.id, custom: [...custom, skin] },
        parsed = parseSkinCollection(JSON.stringify(candidate));
      if (!parsed.custom.some((s) => s.id === skin.id))
        throw new Error("请添加图片，名称不超过 20 字，台词应为 1 至 40 字");
      this._saveSkins(candidate);
      this.setData({ skinEditor: false });
    } catch (error) {
      this._error(error);
    }
  },
  deleteCustomSkin(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除这款自定义皮肤？",
      content: "不会删除投递或事项。",
      success: (answer) => {
        if (!answer.confirm) return;
        try {
          this._saveSkins({
            selected:
              this._skinCollection.selected === id
                ? "whale"
                : this._skinCollection.selected,
            custom: this._skinCollection.custom.filter((s) => s.id !== id),
          });
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  remove(event) {
    try {
      this._client.remove(event.currentTarget.dataset.id);
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  restore(event) {
    try {
      this._client.restore(event.currentTarget.dataset.id);
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  resolveConflict(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["将本机内容另存一份", "采用服务器版本"],
      success: (result) => {
        if (result.tapIndex === 0) {
          try {
            this._client.keepLocalCopy(id);
            this._refresh();
            this.syncQuietly();
          } catch (error) {
            this._error(error);
          }
        } else if (result.tapIndex === 1) {
          wx.showModal({
            title: "采用服务器版本？",
            content: "此操作会放弃这次冲突中保留的本机修改。",
            success: (answer) => {
              if (!answer.confirm) return;
              try {
                this._client.acceptRemote(id);
                this._refresh();
              } catch (error) {
                this._error(error);
              }
            },
          });
        }
      },
    });
  },
  applyUpdate() {
    if (this.data.syncing || this.data.connecting || this.data.filesBusy) {
      wx.showToast({ title: "正在同步，稍后再更新", icon: "none" });
      return;
    }
    try {
      wx.setStorageSync(DRAFT, {
        id: this._draftId || null,
        text: this.data.draft,
      });
    } catch (error) {
      this._error(new Error("草稿保存失败，请先复制保留内容"));
      return;
    }
    wx.showModal({
      title: "更新拾序",
      content: this.data.pending
        ? "草稿和未同步操作已保存在本机，重启后继续同步。"
        : "草稿已保存，重启后使用新版本。",
      success: (result) => {
        if (!result.confirm || !getApp().updateManager) return;
        if (this.data.syncing || this.data.connecting || this.data.filesBusy) {
          wx.showToast({ title: "正在同步，稍后再更新", icon: "none" });
          return;
        }
        getApp().updateManager.applyUpdate();
      },
    });
  },
});
