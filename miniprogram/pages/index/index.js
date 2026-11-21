const { createSyncClient, makeId } = require("../../lib/sync-client");
const { createTransport, normalizeServiceURL } = require("../../lib/transport");
const { sha256: originalHash } = require("../../lib/originals");
const { packedWebp } = require("../../lib/skin-images");
const {
  CONNECTION,
  SERVICE_ORIGIN,
  accountServiceOrigin,
  credentials: accountCredentials,
  activate: activateAccount,
  spaceKey,
  accountTransport,
} = require("../../lib/accounts");
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
  NATIVE_SKIN_MOTIONS,
  SKIN_INTERACTION,
  BUILTIN_SKINS,
  ICE_VOICES,
  skinSound,
  BUNNY_CLIP,
  bunnyFrame,
  SKIN_MOTIONS,
  parseSkinCollection,
  MAX_CUSTOM_SKINS,
  mergeCardOrder,
  deadlineCountdown,
  deadlineTone,
  parseDeadline,
  absoluteItem,
  setDeadline,
  habitCheckin,
  readingView,
  walletView,
  reuseView,
  pdfProgressView,
  imageProgressView,
  mergeProgressView,
  processingView,
  sourceLocation,
} = require("../../lib/generated/desktop");
const { createTouchOrder, ddlLists } = require("../../lib/touch-order");
const SKINS = "shixu:mini:skins:v1";
const FILTERS = "shixu:mini:filters:v1";
const jobsKey = (base) => `shixu:mini:jobs:v1:${base}`;
const ACTIVE_JOB_STATES = ["submitting", "queued", "running", "applying"];
const canResubmitOrganize = (job) =>
  !job.serverAccepted && !job.actions?.includes("continue") &&
  ["error", "conflict"].includes(job.state);
const captureKey = (space) => `shixu:mini:last-capture:${space}`;
const DRAFT = "shixu:mini:draft:v1";
const stateKey = (base) => `shixu:mini:workspace:v1:${base}`;
const originalExpiry = (row) =>
  row?.expiresAt && row.available
    ? new Date(row.expiresAt).toLocaleDateString("zh-CN")
    : "";
const presentOriginal = (row) => ({
  ...row,
  rowKey: `${row.packetId}:${row.id}`,
  expiresLabel: originalExpiry(row),
});
function dateInfo() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    capturedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    captureDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}
function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
Page({
  ...createTouchOrder(wx),
  data: {
    materialUseNotice: null,
    materialConsentAccepted: false,
    taskPreview: null,
    tab: "capture",
    dragId: "",
    dragView: null,
    dragGhost: null,
    dragSettling: false,
    dragScrollTop: 0,
    dragNotice: "",
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
    accountAiState: "未激活",
    activationState: "未激活",
    connecting: false,
    syncing: false,
    refreshingWorld: false,
    syncStatus: "",
    savedAccount: false,
    organizingPacketId: "",
    aiChecking: false,
    showAiGuide: false,
    error: "",
    notice: "",
    showDeleted: false,
    expandedId: "",
    expandedCardId: "",
    detailAnchor: "",
    detailScrollTop: 0,
    updateReady: false,
    scope: "active",
    scopeLabels: ["待处理", "完成 / 归档", "最近删除"],
    scopeIndex: 0,
    filtersOpen: false,
    query: "",
    filterActive: false,
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
    captureResultAnchor: "",
    localMode: true,
    localCount: 0,
    skinOpen: false,
    skins: [],
    activeSkin: BUILTIN_SKINS[0],
    previewSkin: BUILTIN_SKINS[0],
    skinMessage: BUILTIN_SKINS[0].hello,
    skinAnimating: false,
    foxHomeReady: false,
    foxPreviewReady: false,
    bunnyPlaying: false,
    bunnyPosition: "left:0%;top:0%",
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
    accountUsername: "",
    accountPassword: "",
    accountNewPassword: "",
    loginDevices: [],
    accountDevices: [],
    accountAction: "",
    credentialMode: "login",
    showAccountForm: false,
    switchAccountOpen: false,
    activeAccountName: "",
    authExpired: false,
    passwordChangeRequired: false,
    passwordAccounts: false,
    legacyAccountActivation: false,
    accountProbeChecking: false,
    accountProbeError: "",
    accountClaimed: false,
    jobLabels: {
      submitting: "正在提交",
      queued: "等待整理",
      running: "正在整理",
      applying: "正在保存结果",
      done: "已完成",
      error: "未完成",
      conflict: "有新修改，请核对结果",
      interrupted: "已中断，请核对后重试",
      paused: "已暂停",
      cancelled: "已停止",
      partial: "已收下部分",
      purged: "已清除",
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
      if (
        connection &&
        connection.protocolVersion === 3 &&
        connection.base &&
        connection.token &&
        wx.getStorageSync(CONNECTION + ":active") !== false
      )
        this._activate(connection);
      else this._activateLocal();
    } catch (error) {
      this._error(error);
    }
    this._network = (result) => {
      this.setData({ offline: !result.isConnected });
      if (result.isConnected && this._visible) this.syncQuietly();
    };
    wx.onNetworkStatusChange(this._network);
    this._prepareSkinAudio();
  },
  onShow() {
    this._visible = true;
    this.setData({ updateReady: getApp().globalData.updateReady });
    this._refresh();
    this.syncQuietly();
    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this._refresh();
      this.syncQuietly();
    }, 15000);
  },
  onHide() {
    this._visible = false;
    this.cancelDrag();
    clearInterval(this._timer);
    clearTimeout(this._queryTimer);
    this._queryTimer = null;
    this._stopSkinInteraction();
  },
  onUnload() {
    this._visible = false;
    this.cancelDrag();
    clearInterval(this._timer);
    clearTimeout(this._queryTimer);
    this._queryTimer = null;
    this._stopSkinInteraction();
    if (this._skinAudio) this._skinAudio.destroy();
    if (this._network) wx.offNetworkStatusChange(this._network);
  },
  _activate(connection) {
    const environment = wx.getAccountInfoSync().miniProgram.envVersion;
    const base = normalizeServiceURL(connection.base, environment);
    if (connection.protocolVersion === 3 && base !== accountServiceOrigin(wx))
      throw new Error("激活服务地址无效");
    const transport =
      connection.protocolVersion === 3
        ? accountTransport(connection, wx, (account) => {
            if (this._connection !== connection) return;
            this._reading = account.reading || null;
            const materialUseNotice = account.reading?.materialUseNotice || null;
            this.setData({
              materialUseNotice,
              materialConsentAccepted: !materialUseNotice || wx.getStorageSync("material-use:" + spaceKey(connection)) === materialUseNotice.version,
              passwordAccounts: !!account.authentication,
              accountClaimed: !!account.authentication?.claimed,
              passwordChangeRequired: !!account.authentication?.passwordChangeRequired,
              activeAccountName: account.authentication?.username || "",
              accountUsername: this.data.accountUsername || account.authentication?.username || "",
            });
            const day = new Date().toISOString().slice(0, 10),
              used = account.ai.usage.find((u) => u.day === day)?.requests || 0;
            this.setData({
              activationState: account.authentication?.passwordChangeRequired ? "请先修改临时密码" : "已连接",
              accountAiState: account.reading
                ? walletView(account.wallet)
                : !account.ai.enabled
                  ? "服务端 AI 暂未启用"
                  : used >= account.ai.dailyLimit
                    ? "今日 AI 额度已用完；记录和同步仍可用"
                    : `今日 ${used} / ${account.ai.dailyLimit} 次，UTC 零点重置`,
            });
          })
        : createTransport(base, () => connection.token);
    const space = spaceKey(connection);
    const client = createSyncClient({
      read: () => wx.getStorageSync(stateKey(space)) || null,
      write: (value) => wx.setStorageSync(stateKey(space), value),
      request: transport,
      protocolVersion: connection.protocolVersion || 2,
    });
    const jobs = wx.getStorageSync(jobsKey(space));
    if (jobs && !Array.isArray(jobs))
      throw new Error("任务记录无法读取，请保留资料联系开发者");
    this._reading = null;
    this._connection = connection;
    this._epoch = connection.epoch || null;
    this._transport = transport;
    this._client = client;
    this._jobs = jobs || [];
    this._loadDraft();
    this.setData({
      connected: true,
      authExpired: false,
      savedAccount: true,
      accountUsername: "",
      activeAccountName: "",
      accountDevices: [],
      accountClaimed: false,
      passwordChangeRequired: false,
      capabilities: {},
      accountAiState: "正在核对账号能力",
      activationState: "设备凭证已保存，等待核验",
      serverUrl: base,
      localMode: false,
      jobs: this._jobViews(this._jobs),
      taskPreview: null,
      materialUseNotice: null,
      materialConsentAccepted: false,
    });
    this._refresh();
  },
  _refresh() {
    if (this._drag || this._completionLock) return;
    if (!this._client) return;
    const records = this._client.records();
    try {
      const library = this._library();
      if (library)
        for (const row of records.filter((r) => r.purged && !r.pending))
          library.forgetPacket(
            row.id,
            this.data.localMode ? "local" : this._space(),
          );
    } catch (error) {
      this._error(
        new Error("投递已永久删除，本机原件缓存清理尚未完成，请保留资料后重试"),
      );
    }
    const all = records.filter((row) => !row.purged && row.data && row.data.recordType !== 'board-workspace');
    const recordRows = all.filter(
      (row) => !!row.deletedAt === this.data.showDeleted,
    );
    const recordPage = Math.min(
      this.data.recordPage,
      Math.max(0, Math.ceil(recordRows.length / 30) - 1),
    );
    const rows = recordRows
      .sort((a, b) =>
        (b.data.capturedAt || "").localeCompare(a.data.capturedAt || ""),
      )
      .slice(recordPage * 30, (recordPage + 1) * 30)
      .map((row) => {
        const rawText = row.data.text || "",
          title = (
            rawText.split("\n")[0] ||
            (row.data.attachments || [])[0]?.name ||
            "文字投递"
          ).slice(0, 32),
          body = rawText.startsWith(title)
            ? rawText.slice(title.length).replace(/^\n+/, "")
            : rawText;
        return {
          id: row.id,
          text: rawText.slice(0, 600),
          body: body.slice(0, 600),
          title,
          date: row.data.captureDate || "",
          deleted: !!row.deletedAt,
          conflict: !!row.conflict,
          state: row.conflict ? "需处理冲突" : row.pending ? "待同步" : "已同步",
          hasResult: itemsFor([row]).length > 0,
          organizeJob: this._jobViews([this._organizeJob(row.id)].filter(Boolean))[0] || null,
          ...this._deliveryFiles(row),
        };
      });
    const view = worldView(records, this.data);
    const clock = new Date();
    const day = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, "0")}-${String(clock.getDate()).padStart(2, "0")}`;
    const clockText = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
    const ddl = ddlLists(
      itemsFor(records),
      day,
      clockText,
      this.data.ddlDays[this.data.ddlIndex],
    );
    for (const [urgency, rows] of Object.entries(ddl)) {
      for (const row of rows) row.urgency = urgency;
    }
    const ddlCard = (row, index) => {
      const card = this._cardView(row, index);
      const countdown = deadlineCountdown(
        card.date || "",
        day,
        card.time || "",
        clockText,
        !!card.done,
      );
      return {
        ...card,
        deadlineTone: deadlineTone(card.date || "", day, !!card.done),
        countdown: countdown.label,
        countdownStatus: countdown.status,
      };
    };
    const activePackets = new Set(all.filter((row) => !row.deletedAt).map((row) => row.id));
    const selected =
      this.data.selected &&
      this._presentDetail(this._detail(this.data.selected.id));
    this.setData({
      rows,
      draftFiles: this._fileEntries(this._draftId).map((entry) => ({
        ...this._library().metadata(entry),
        sizeLabel: formatBytes(entry.size),
        volatile: !!entry.volatile,
      })),
      pendingFiles:
        this._library() && !this.data.localMode
          ? this._library()
              .entries(null, this._space())
              .filter(
                (e) =>
                  !e.remote && activePackets.has(e.packetId),
              ).length
          : 0,
      ddlOverdue: ddl.overdue.slice(0, this.data.ddlLimit).map(ddlCard),
      ddlUnsure: ddl.unsure.slice(0, this.data.ddlLimit).map(ddlCard),
      ddlDone: ddl.done.slice(0, this.data.ddlLimit).map(ddlCard),
      ddlSections: [
        {
          title: "今天截止",
          rows: ddl.today.slice(0, this.data.ddlLimit).map(ddlCard),
        },
        {
          title: `未来 ${this.data.ddlDays[this.data.ddlIndex]} 天`,
          rows: ddl.soon.slice(0, this.data.ddlLimit).map(ddlCard),
        },
        {
          title: `${this.data.ddlDays[this.data.ddlIndex]} 天之后`,
          rows: ddl.later.slice(0, this.data.ddlLimit).map(ddlCard),
        },
      ].flatMap((section) =>
        [...new Set(section.rows.map((row) => row.date))].map((date) => ({
          title: `${section.title} · ${date || "日期待确认"}`,
          rows: section.rows.filter((row) => row.date === date),
        })),
      ),
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
      recordPage,
      count: all.filter((row) => !row.deletedAt).length,
      pending: this._client.pendingCount(),
      conflicts: this._client.conflicts().length,
      ...this._worldPatch(view),
      selected: selected || null,
      currentRows: all
        .filter((r) => r.id === this.data.currentCaptureId && !r.deletedAt)
        .map((r) => ({
          id: r.id,
          text: r.data.text,
          status: r.data.status,
          error: r.data.error || "",
          summary: (r.data.result && r.data.result.summary) || "",
          organizeJob: this._jobViews([this._organizeJob(r.id)].filter(Boolean))[0] || null,
          items: itemsFor([r]).slice(0, 60).map(this._cardView),
          ...this._deliveryFiles(r),
        })),
      localCount: this._localWorkspace()
        .records()
        .filter((r) => !r.purged && !r.deletedAt).length,
    });
  },
  _worldPatch(view) {
    return {
      groupChoices: ["全部分组", ...view.groups],
      groupIndex: view.groups.indexOf(this.data.group) + 1,
      categories: view.categories,
      items: view.items.map(this._cardView),
      sections: view.sections.map((section) => ({
        ...section,
        items: section.items.map(this._cardView),
      })),
      matched: view.matched,
      itemCount: view.total,
      activeCount: view.active,
      doneCount: view.done,
      groups: view.groups,
      filterActive: !!(
        this.data.query.trim() ||
        this.data.kind !== "all" ||
        this.data.dateFilter !== "all" ||
        this.data.starOnly ||
        this.data.group
      ),
    };
  },
  _refreshWorld() {
    if (!this._client) return;
    this.setData(this._worldPatch(worldView(this._client.records(), this.data)));
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
    if (space === undefined)
      space = packetId === this._draftId ? this._draftSpace() : this._space();
    const entries = this._library().entries(packetId, space);
    // A retained local copy and its remote import may share one original.
    return entries.filter(
      (e, i) => entries.findIndex((f) => f.id === e.id) === i,
    );
  },
  _deliveryFiles(row) {
    const attachments = (row.data.attachments || []).filter((file) => !file.deletedAt);
    const pending = this.data.localMode ? [] : this._fileEntries(row.id).filter((file) => !file.remote);
    const issue = this._deliveryIssues?.get(row.id);
    return {
      attachments,
      pendingOriginals: pending.length,
      temporaryOriginals: pending.some((file) => file.volatile),
      uploadIssue: issue?.upload,
      organizeIssue: issue?.organize,
    };
  },
  _setDeliveryIssue(id, stage, message) {
    this._deliveryIssues ||= new Map();
    this._deliveryIssues.set(id, { ...this._deliveryIssues.get(id), [stage]: message });
  },
  retryDeliveryUpload() {
    return this._sync({ interactive: true });
  },
  chooseFiles() {
    if (this.data.filesBusy) return;
    const count = 20 - this.data.draftFiles.length;
    if (!count) return this._error(Error("一次投递已选满 20 份原件"));
    if (!wx.chooseMessageFile) return this._error(Error("当前微信环境无法选择聊天文件"));
    this.setData({ filesBusy: true });
    wx.chooseMessageFile({
      count,
      type: "all",
      success: (answer) => this._collectFiles(answer.tempFiles),
      fail: (error) => {
        if (!/cancel/i.test(error?.errMsg || "")) this._error(Error("无法打开聊天文件，草稿已保留"));
      },
      complete: () => this.setData({ filesBusy: false }),
    });
  },
  chooseImages() {
    if (this.data.filesBusy) return;
    const count = Math.min(9, 20 - this.data.draftFiles.length);
    if (!count) return this._error(Error("一次投递已选满 20 份原件"));
    if (!wx.chooseMedia) return this._error(Error("当前微信环境无法打开相册或相机"));
    this.setData({ filesBusy: true });
    wx.chooseMedia({
      count,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (answer) => this._collectFiles(answer.tempFiles),
      fail: (error) => {
        if (!/cancel/i.test(error?.errMsg || "")) this._error(Error("无法打开相册或相机，草稿已保留"));
      },
      complete: () => this.setData({ filesBusy: false }),
    });
  },
  _collectFiles(files) {
    if (!files?.length) return;
    try {
      if (!this._draftId) this._draftId = makeId();
      // Persist the owner ID before copying a temporary file to durable storage.
      wx.setStorageSync(this._draftKey(), {
        id: this._draftId,
        text: this.data.draft,
      });
      const library = this._library();
      if (!library) throw new Error("当前环境暂不支持原件保存");
      const failures = [];
      for (const file of files) {
        try {
          if (this._fileEntries(this._draftId).length >= 20)
            throw new Error("一次投递最多 20 份原件");
          library.add(file, this._draftId, this._draftSpace());
        } catch (error) {
          failures.push(error.message);
        }
      }
      this.setData({
        error: failures.length
          ? `${failures.length} 份原件未加入：${failures[0]}。可重选未加入的文件。`
          : "",
        notice: library
          .entries(this._draftId, this._draftSpace())
          .some((e) => e.volatile)
          ? "本机原件保存失败，仅本次会话可用；上传后请核对云端保存结果，关闭前另存副本"
          : "",
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
        this._draftSpace(),
      );
      this._refresh();
      this._acknowledge("已从草稿移出附件");
    } catch (error) {
      this._error(error);
    }
  },
  async _uploadFiles(epoch, interactive) {
    const library = this._library();
    if (!library || this.data.filesBusy || !this.data.capabilities.attachments)
      return;
    const base = this._space();
    const packets = new Set(this._client.records()
      .filter((row) => !row.purged && !row.deletedAt && !row.conflict).map((row) => row.id));
    const pending = library.entries(null, base).filter((entry) => !entry.remote && packets.has(entry.packetId));
    if (!pending.length) return;
    const transport = createFileTransport(
        this._connection.base,
        () => this._connection.token,
        wx,
        this._connection.protocolVersion || 2,
      );
    this.setData({ filesBusy: true });
    let uploadingPacketId;
    try {
      if (this._reading?.features?.submissionManifest) {
        let attached = false;
        for (const packetId of new Set(pending.map((e) => e.packetId))) {
          const row = this._record(packetId);
          if (!row || row.deletedAt || row.conflict) continue;
          uploadingPacketId = packetId;
          const entries = pending.filter((entry) => entry.packetId === packetId);
          const newFiles = entries.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type,
            size: e.size,
            hash: e.remote?.hash || originalHash(library.bytes(e)),
          }));
          const manifest = [
            ...(row.data.attachments || []).filter(
              (f) => !f.deletedAt && !newFiles.some((n) => n.id === f.id),
            ),
            ...newFiles,
          ];
          const key = `shixu:submission:${base}:${packetId}`;
          let saved = wx.getStorageSync(key);
          if (
            !saved ||
            JSON.stringify(saved.manifest) !== JSON.stringify(manifest)
          ) {
            saved = { id: makeId(), manifest, baseVersion: row.version };
            wx.setStorageSync(key, saved);
          }
          const submission = await this._transport(
            "POST",
            "/api/v4/submissions",
            {
              submissionId: saved.id,
              packetId,
              manifest,
              epoch,
              storageIntent: "retained",
            },
          );
          this.setData({ originalNotice: submission.warning });
          if (
            submission.mode === "temporary" &&
            entries.some((e) => e.volatile)
          ) {
            if (!interactive)
              throw Error("原件仅本次会话可用，请点「重试上传」确认临时整理，或先另存原件");
            const answer = await new Promise((resolve) =>
              wx.showModal({
                title: "原件未保存",
                content:
                  "本机保存失败且云端空间不足，只能临时整理；停止、失败或关闭后需重新选择原件。仍继续？",
                success: resolve,
                fail: () => resolve({ confirm: false }),
              }),
            );
            if (!answer.confirm)
              throw Error("已保留本次会话材料，请先另存原件后重试");
          }
          for (const entry of entries)
            await transport.uploadSubmission(
              saved.id,
              entry,
              library.bytes(entry),
            );
          try {
            await this._transport("POST", `/api/v4/submissions/${saved.id}/commit`, {
              manifestHash: submission.manifestHash,
              epoch,
              operation: {
                opId: saved.id,
                id: packetId,
                type: "put",
                baseVersion: saved.baseVersion,
                data: { attachments: manifest },
              },
            });
          } catch (error) {
            if (error.code === "REVISION_CONFLICT" && error.current?.id === packetId &&
                !error.current.deletedAt && !error.current.purged) {
              // The server rejected this operation before committing the upload.
              wx.setStorageSync(key, { ...saved, baseVersion: error.current.version });
            }
            throw error;
          }
          for (const entry of entries)
            library.markUploaded(
              entry,
              manifest.find((f) => f.id === entry.id),
            );
          wx.setStorageSync(key, null);
          attached = true;
        }
        if (attached) await this._client.sync();
        return;
      }
      let changed = false;
      for (const entry of pending) {
        const row = this._record(entry.packetId);
        if (!row || row.deletedAt || row.conflict) continue;
        uploadingPacketId = entry.packetId;
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
    } catch (error) {
      if (uploadingPacketId) this._setDeliveryIssue(uploadingPacketId, "upload", error.message);
      throw error;
    } finally {
      this.setData({ filesBusy: false });
    }
  },
  async _refreshOriginalStorage() {
    if (!this._reading?.features?.submissionManifest || this.data.originalActionBusy) return;
    const storage = await this._transport("GET", "/api/v4/storage");
    if (!this.data.originalActionBusy)
      this.setData({
        originalStorage: { ...storage, originals: storage.originals.map(presentOriginal) },
        originalActionFeedback: null,
      });
  },
  async _reuploadTemporary(packetId) {
    if (!this._reading?.features?.submissionManifest) return;
    const storage = await this._transport(
      "GET",
      `/api/v4/storage?packetId=${encodeURIComponent(packetId)}`,
    );
    const library = this._library();
    const transport = createFileTransport(
      this._connection.base,
      () => this._connection.token,
      wx,
      3,
    );
    for (const f of storage.originals.filter(
      (f) =>
        f.packetId === packetId &&
        !f.available &&
        !f.readingAvailable &&
        (f.mode === "temporary" || ["deleted", "cleaned"].includes(f.state)),
    )) {
      const entry = library
        ?.entries(packetId, this._space())
        .find((e) => e.id === f.id);
      if (!entry)
        throw Error("原件已清理，请在有本地副本的设备继续，或重新选择同一原件");
      if (["deleted", "cleaned"].includes(f.state)) {
        await transport.verifyOriginal(packetId, entry, library.bytes(entry));
        this.setData({
          notice: "云端原件保持已清除；本次仅临时核验，停止或结束后清理",
        });
      } else
        await transport.uploadSubmission(
          f.submissionId,
          entry,
          library.bytes(entry),
        );
    }
  },
  async originalAction(event) {
    const { id, packet, action } = event.currentTarget.dataset;
    if (!["renew", "download", "delete"].includes(action)) return;
    const f = this.data.originalStorage?.originals.find(
      (f) => f.id === id && f.packetId === packet,
    );
    if (!f || this.data.filesBusy) return;
    if (this.data.offline) {
      this._error(Error("离线时不能修改云端原件；联网后刷新再操作"));
      return;
    }
    const rowKey = `${packet}:${id}`;
    const key = `shixu:original-action:${this._space()}:${rowKey}:${f.version}:${action}`;
    this.setData({ filesBusy: true, originalActionBusy: { rowKey, action }, originalActionFeedback: null });
    try {
      if (action === "delete") {
        const answer = await new Promise((resolve) =>
          wx.showModal({
            title: "删除云端原件",
            content: "会停止对应任务并清理云端原件；本机副本保留。",
            success: resolve,
            fail: () => resolve({ confirm: false }),
          }),
        );
        if (!answer.confirm) return;
      }
      if (action === "download") {
        if (!this._epoch) throw Error("请先同步账号再下载");
        if (!this._library()) throw Error("当前微信环境无法保存原件");
        const bytes = await createFileTransport(
          this._connection.base,
          () => this._connection.token,
          wx,
          3,
        ).download(packet, id, this._epoch);
        if (originalHash(bytes) !== f.hash)
          throw Error("下载校验不一致，未保存原件");
        this._library().cache(f, packet, this._space(), bytes);
        this.setData({ originalActionFeedback: { rowKey, message: "已保存到本机，可在投递记录或事项详情中预览、导出" } });
        return;
      }
      let operationId = wx.getStorageSync(key);
      if (!operationId) {
        operationId = makeId();
        wx.setStorageSync(key, operationId);
      }
      const result = await this._transport(
        "POST",
        `/api/v4/originals/${action}`,
        {
          operationId,
          ids: [{ packetId: packet, id, expectedVersion: f.version }],
          stopTask: action === "delete",
        },
      );
      const receipt = result.results?.find((row) => row.id === id && row.packetId === packet);
      if (receipt?.code !== "OK") {
        wx.setStorageSync(key, null);
        throw Error("原件状态已变化，请刷新后重试");
      }
      let updated;
      if (action === "delete") {
        updated = { ...f, version: receipt.version, state: "deleted", available: false, remind: false };
      } else {
        try {
          const storage = await this._transport("GET", `/api/v4/storage?packetId=${encodeURIComponent(packet)}`);
          updated = storage.originals.find((row) => row.id === id);
        } catch (error) {
          this._rememberRateLimit(error);
        }
      }
      const storage = this.data.originalStorage;
      this.setData({
        originalStorage: {
          ...storage,
          usedBytes: action === "delete" && f.mode === "retained"
            ? Math.max(0, storage.usedBytes - f.size) : storage.usedBytes,
          originals: storage.originals.map((row) =>
            row.id === id && row.packetId === packet
              ? presentOriginal(updated || { ...row, expiresAt: null })
              : row),
        },
        originalActionFeedback: {
          rowKey,
          message: action === "delete" ? "云端原件已删除"
            : updated ? "已续期 30 天" : "已续期，请刷新同步查看新的到期时间",
          needsRefresh: !updated,
        },
      });
      if (updated) wx.setStorageSync(key, null);
    } catch (e) {
      this._rememberRateLimit(e);
      if (e.status === 401) this._error(e);
      this.setData({ originalActionFeedback: { rowKey, message: e.message || "操作未完成，请重试", failed: true } });
    } finally {
      this.setData({ filesBusy: false, originalActionBusy: null });
    }
  },
  async moreOriginals() {
    if (
      !this.data.originalStorage?.hasMore ||
      this.data.filesBusy ||
      this.data.offline
    )
      return;
    this.setData({ filesBusy: true });
    try {
      const next = await this._transport(
        "GET",
        `/api/v4/storage?cursor=${this.data.originalStorage.nextCursor}`,
      );
      this.setData({
        originalStorage: {
          ...next,
          originals: [
            ...this.data.originalStorage.originals,
            ...next.originals.map(presentOriginal),
          ],
        },
      });
    } catch (e) {
      this._error(e);
    } finally {
      this.setData({ filesBusy: false });
    }
  },
  openAttachment(event) {
    return this._openAttachment(event.currentTarget.dataset, false);
  },
  exportAttachment(event) {
    return this._openAttachment(event.currentTarget.dataset, true);
  },
  async _openAttachment({ id, packet }, exporting) {
    if (this.data.filesBusy) return;
    this.setData({ filesBusy: true, error: "", notice: "" });
    try {
      const row = this._record(packet);
      if (!row || row.deletedAt) throw new Error("请先恢复整次投递");
      const file = (row.data.attachments || []).find(
        (f) => f.id === id && !f.deletedAt,
      );
      if (!file) throw new Error("附件不存在");
      const library = this._library();
      if (!library) throw new Error("当前环境无法读取原件");
      if (exporting && typeof wx.shareFileMessage !== "function")
        throw Error("当前微信版本无法发送原件，请更新微信后重试");
      const space = this.data.localMode ? "local" : this._space();
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
        if (this.data.localMode) throw Error("这份原件未在本机保存");
        if (this.data.offline) throw Error("联网后才能取回云端原件");
        if (!this._epoch) await this.sync();
        if (!this._epoch) throw new Error("请先完成同步并核对服务资料版本");
        const bytes = await createFileTransport(
          this._connection.base,
          () => this._connection.token,
          wx,
          this._connection.protocolVersion || 2,
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
        if (file.hash && originalHash(bytes) !== file.hash)
          throw Error("原件校验不一致，请重新同步后再试");
        path = library.cache(file, packet, space, bytes);
      }
      if (exporting) {
        await new Promise((resolve, reject) => wx.shareFileMessage({
          filePath: path,
          fileName: file.name,
          success: resolve,
          fail: (error) => /cancel/i.test(error?.errMsg || "")
            ? resolve()
            : reject(Error("微信暂时无法发送这份原件，文件已保留")),
        }));
        return;
      }
      const ext = extension(file.name);
      if (["png", "apng", "jpg", "jpeg", "gif", "webp"].includes(ext))
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
            id,
            packet,
            text: text.slice(0, 60000),
            truncated: text.length > 60000,
          },
        });
      } else
        this.setData({
          notice: "这种格式无法在微信内预览，可点「导出」发送原件",
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
  _cardView(row, index = 0) {
    const { item, meta, search, ...view } = row;
    const now = new Date();
    const countdown = deadlineCountdown(
      row.date || "",
      localDay(),
      row.time || "",
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      !!row.done,
    );
    return {
      ...view,
      shadowIndex: index % 3,
      compactTimeLabel: (row.timeLabel || "").replace(
        new RegExp(`${now.getFullYear()}-`, "g"),
        "",
      ),
      countdown: countdown.label,
      countdownStatus: countdown.status,
      title: row.title.slice(0, 150),
      summary: row.summary,
    };
  },
  _presentDetail(row) {
    if (!row) return null;
    const { meta, search, ...view } = row;
    const sourceText = row.sourceText.slice(0, 20000);
    // Only omit the built-in copy of the input. Other sources carry their own names.
    const sources = row.sources
      .filter((source) => source.id !== "input" || source.text !== row.sourceText)
      .slice(0, 10)
      .map((source) => ({ ...source, text: (source.text || "").slice(0, 2000) }));
    return {
      ...view,
      sourceText,
      sources,
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
  _space() {
    return this._connection ? spaceKey(this._connection) : "local";
  },
  _draftKey() {
    return this._connection?.protocolVersion === 3
      ? DRAFT + ":" + this._space()
      : DRAFT;
  },
  _draftSpace() {
    return this._connection?.protocolVersion === 3
      ? "draft:" + this._space()
      : "draft";
  },
  _loadDraft() {
    const saved = wx.getStorageSync(this._draftKey());
    this._draftId = saved && typeof saved === "object" ? saved.id : null;
    this._syncRetryAt = 0;
    this._nextJobPoll = 0;
    this._deliveryIssues = new Map();
    this.setData({
      draft: typeof saved === "string" ? saved : saved?.text || "",
      currentCaptureId: wx.getStorageSync(captureKey(this._space())) || "",
      captureResultAnchor: "",
      originalStorage: null,
      originalNotice: "",
      originalActionFeedback: null,
      expandedCardId: "",
      expandedId: "",
      syncStatus: "",
      draftFiles: [],
      selected: null,
      originalPreview: null,
      chatInput: "",
    });
  },
  async resumeAccount() {
    if (
      this.data.filesBusy ||
      this.data.connecting ||
      this.data.syncing ||
      this.data.jobBusy
    )
      return;
    try {
      const connection = wx.getStorageSync(CONNECTION);
      if (!connection?.token || connection.protocolVersion !== 3)
        throw Error("此设备尚未激活");
      wx.setStorageSync(this._draftKey(), {
        id: this._draftId,
        text: this.data.draft,
      });
      wx.setStorageSync(CONNECTION + ":active", true);
      this._activate(connection);
      this.setData({ notice: "已切回云端账号", error: "" });
      await this.sync();
    } catch (error) {
      this._error(error);
    }
  },
  _activateLocal() {
    this._client = this._localWorkspace();
    this._connection = null;
    this._transport = null;
    this._reading = null;
    this._epoch = null;
    this._jobs = [];
    this._loadDraft();
    this.setData({
      localMode: true,
      connected: false,
      authExpired: false,
      savedAccount: !!wx.getStorageSync(CONNECTION)?.token,
      activationState: "当前在本机空间",
      jobs: [],
      accountDevices: [],
      accountClaimed: false,
      activeAccountName: "",
      switchAccountOpen: false,
      passwordChangeRequired: false,
      taskPreview: null,
      materialUseNotice: null,
      materialConsentAccepted: false,
      accountAiState: "本机空间 · 可记录和管理事项",
      capabilities: {},
    });
    this._refresh();
  },
  useLocal() {
    if (
      this.data.syncing ||
      this.data.connecting ||
      this.data.jobBusy ||
      this.data.filesBusy ||
      this.data.accountAction
    )
      return;
    // Remote outbox remains durable under its original service URL.
    try {
      wx.setStorageSync(this._draftKey(), {
        id: this._draftId,
        text: this.data.draft,
      });
      wx.setStorageSync(CONNECTION + ":active", false);
      this._activateLocal();
      this._showTab("capture", {
        error: "",
        notice: "已切换到本机空间，云端账号仍保留。可随时切回云端。",
      });
    } catch (error) {
      this._error(error);
    }
  },
  async importLocal() {
    if (this.data.localMode || this.data.syncing) return;
    try {
      if (!await this.sync()) return;
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
          this._library().copySpace(row.id, "local", this._space());
      }
      const synced = await this.sync();
      if (synced) this._acknowledge("本机投递已导入，原件仍保留");
      else if (!this.data.error) this._acknowledge("导入已保存，等待同步");
    } catch (error) {
      this._error(error);
    }
    this._refresh();
  },
  _error(error, { session = true } = {}) {
    if (session && this._connection &&
      (error.status === 401 || ["UNAUTHORIZED", "ACCOUNT_DISABLED"].includes(error.code))
    )
      this.setData({
        authExpired: true,
        activationState: "设备授权已失效，请重新登录",
        accountAiState: "设备授权失效，本地资料仍保留",
      });
    const message = error.message || "操作未完成，请稍后重试";
    this.setData({ error: message, notice: "" });
    if (!this.data.selected && !this.data.recordsOpen && !this.data.skinOpen)
      wx.showToast?.({ title: message, icon: "none", duration: 2600 });
  },
  _acknowledge(message) {
    this.setData({ notice: message, error: "" });
    wx.showToast?.({ title: message, icon: "none", duration: 1500 });
  },
  onDraft(event) {
    const draft = event.detail.value;
    if (!this._draftId) this._draftId = makeId();
    try {
      wx.setStorageSync(this._draftKey(), { id: this._draftId, text: draft });
      this.setData({ draft, error: "", notice: "", captureResultAnchor: "" });
    } catch (_) {
      this.setData({
        draft,
        captureResultAnchor: "",
        error: "草稿保存失败，请先复制保留文字，再释放存储空间",
      });
    }
  },
  onServer(event) {
    this.setData({ serverUrl: event.detail.value });
  },
  onPassword(event) {
    this.setData({ password: event.detail.value });
  },
  switchTab(event) {
    this.cancelDrag();
    clearTimeout(this._queryTimer);
    this._queryTimer = null;
    const target = event.currentTarget.dataset.tab;
    if (target === "settings") {
      if (this.data.tab === "settings") return this.closeSettings();
      this.setData({ settingsReturnTab: this.data.tab });
    }
    this._stopSkinInteraction();
    this._showTab(target, { notice: "", error: "", expandedCardId: "" });
    if (target === "settings") void this.probeAccountCapabilities();
    if (["settings", "world"].includes(target)) this.syncQuietly();
    this._refresh();
  },
  _showTab(tab, patch = {}) {
    const previous = this.data.tab;
    if (previous === tab) return this.setData(patch);
    this._workspaceScrollByTab ||= {};
    const position = this._scrollTop || 0;
    this._workspaceScrollByTab[previous] = position;
    this.setData({ ...patch, tab, foxHomeReady: false, captureResultAnchor: "", dragScrollTop: position }, () =>
      this.setData({ dragScrollTop: this._workspaceScrollByTab[tab] || 0 }),
    );
  },
  closeSettings() {
    const tab = this.data.settingsReturnTab || "capture";
    this._showTab(tab, { error: "", notice: "" });
    this._refresh();
  },
  openAiSettings() {
    void this.probeAccountCapabilities();
    if (this.data.tab !== "settings")
      this.setData({ settingsReturnTab: this.data.tab });
    this._stopSkinInteraction();
    this._showTab("settings", { selected: null, error: "", notice: "" });
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
      if (
        status.application !== "shixu-sync" ||
        status.protocolVersion !== (this._connection?.protocolVersion || 2)
      )
        throw new Error("该地址不是兼容的拾序同步服务");
      this.setData({ capabilities: status.capabilities || {} });
      this._acknowledge("AI 状态已刷新");
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
      if (this._connection && this._client.pendingCount())
        throw new Error("请先同步当前账号的待传操作");
      wx.setStorageSync(this._draftKey(), {
        id: this._draftId,
        text: this.data.draft,
      });
      const connection = await activateAccount(this.data.password, wx);
      if (this._client.pendingCount())
        throw Error("原空间新增了待同步操作，请先同步，再恢复激活");
      const previous = wx.getStorageSync(stateKey(spaceKey(connection)));
      if (previous?.epoch && previous.epoch !== connection.epoch)
        throw new Error("账号资料版本已变化，请保留本地队列联系管理员核对");
      this._activate(connection);
      wx.setStorageSync(CONNECTION, connection);
      wx.setStorageSync(CONNECTION + ":active", true);
      this.setData({ password: "", notice: "设备已激活，正在核对资料" });
      await this.sync();
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ connecting: false });
    }
  },
  sync() {
    return this._sync({ interactive: true, details: this.data.tab === "settings" });
  },
  async refreshWorld() {
    if (this.data.localMode || this.data.refreshingWorld) return;
    this.setData({ refreshingWorld: true });
    try {
      await this._sync({ interactive: true });
    } finally {
      this.setData({ refreshingWorld: false });
    }
  },
  _sync({ interactive = false, details = false } = {}) {
    if (this._syncing) return this._syncing;
    if (!this._client || this.data.localMode) return Promise.resolve(false);
    if (this.data.passwordChangeRequired) {
      if (interactive) this._acknowledge("请在设置中修改临时密码后同步");
      return Promise.resolve(false);
    }
    if (this.data.authExpired) {
      if (interactive) this._acknowledge("请在设置中重新登录账号");
      return Promise.resolve(false);
    }
    const wait = Math.ceil(((this._syncRetryAt || 0) - Date.now()) / 1000);
    if (this.data.offline || wait > 0) {
      if (interactive)
        this.setData({ syncStatus: this.data.offline
          ? "当前离线，修改已保留"
          : `请求较多，约 ${wait} 秒后恢复同步` });
      return Promise.resolve(false);
    }
    this._syncing = this._runSync({ interactive, details }).finally(() => {
      this._syncing = null;
    });
    return this._syncing;
  },
  _rememberRateLimit(error) {
    if (error.status !== 429 || (error.code && error.code !== "RATE_LIMIT")) return false;
    const seconds = Math.max(1, Math.min(60, error.retryAfterSeconds || 30));
    this._syncRetryAt = Date.now() + seconds * 1000;
    return true;
  },
  async _runSync({ interactive, details }) {
    this.setData({ syncing: true });
    try {
      const result = await this._client.sync();
      this._epoch = result.epoch;
      const checkedAt = new Date();
      const time = [checkedAt.getHours(), checkedAt.getMinutes()]
        .map((part) => String(part).padStart(2, "0")).join(":");
      this.setData({
        capabilities: result.capabilities || {},
        syncStatus: result.conflicts
          ? "有同步冲突，本机副本已保留"
          : `${time} · 已同步卡片`,
        ...(interactive ? { error: "" } : {}),
      });
      this._refresh();
      try {
        await this._uploadFiles(result.epoch, interactive);
      } catch (error) {
        this._rememberRateLimit(error);
        this.setData({ syncStatus: `卡片已同步，原件待上传：${error.message}` });
        if (interactive && (this.data.tab !== "capture" || error.status === 401)) this._error(error);
        return false;
      }
      this._refresh();
      if (this.data.pendingFiles)
        this.setData({ syncStatus: "卡片已同步，仍有原件待上传" });
      try {
        const active = this._jobs?.some((job) =>
          job.pendingAction || ACTIVE_JOB_STATES.includes(job.state));
        if (!this.data.jobBusy && (active || interactive || Date.now() >= (this._nextJobPoll || 0))) {
          await this._pollJobs();
          this._nextJobPoll = Date.now() + 45000;
        }
        if (this.data.tab === "settings" && (details || !this.data.originalStorage))
          await this._refreshOriginalStorage();
        if (this.data.tab === "settings" && this.data.passwordAccounts &&
            (details || !this.data.accountDevices.length)) {
          const { devices } = await this._transport("GET", "/api/v4/devices");
          this.setData({
            accountDevices: devices.map((device) => ({
              ...device,
              lastSeenLabel: new Date(device.lastSeen).toLocaleString(),
            })),
          });
        }
      } catch (error) {
        this._rememberRateLimit(error);
        this.setData({ syncStatus: `卡片已同步，部分状态待刷新：${error.message}` });
      }
      return true;
    } catch (error) {
      this._rememberRateLimit(error);
      this.setData({ syncStatus: `同步未完成：${error.message}` });
      if (interactive || error.status === 401) this._error(error);
      return false;
    } finally {
      this.setData({ syncing: false });
      this._refresh();
    }
  },
  syncQuietly() {
    if (this._client && !this.data.localMode && !this.data.connecting && !this.data.authExpired)
      return this._sync();
  },
  submit() {
    if (this.data.connecting) {
      wx.showToast({ title: "正在激活，请稍后投递", icon: "none" });
      return;
    }
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
          this.data.localMode ? "local" : this._space(),
          this._draftSpace(),
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
      wx.setStorageSync(this._draftKey(), "");
      this._draftId = null;
      this.setData({
        draft: "",
        currentCaptureId: id,
        notice: "",
        skinMessage: this.data.activeSkin.feeding,
        skinAnimating: true,
      });
      try {
        wx.setStorageSync(captureKey(this._space()), id);
      } catch {
        // The capture is already durable; this only restores its position.
      }
      this.feedSkin();
      this._refresh();
      this.setData({ captureResultAnchor: "" }, () => {
        if (
          this.data.tab === "capture" &&
          this.data.currentCaptureId === id
        )
          this.setData({ captureResultAnchor: "capture-result" });
      });
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
      reading: readingView(p.readingCoverage),
      processing: processingView(p.processingCoverage),
      attachments: (p.attachments || []).filter((file) => !file.deletedAt),
      evidence: (row.item.evidence || []).map((e) => ({
        ...e,
        name:
          sourceLocation(p.readingCoverage, e.sourceId) ||
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
  selectCardCategory(event) {
    const kind = event.currentTarget.dataset.kind;
    const kindIndex = this.data.kindKeys.indexOf(kind);
    if (kindIndex < 0) return;
    this.setData({ kind, kindIndex, expandedCardId: "", limit: 60 });
    this._refresh();
  },
  onCardAction(event) {
    if (this._drag || (this._dragJustEndedAt && Date.now() - this._dragJustEndedAt < 350)) return;
    const { action, id } = event.currentTarget.dataset;
    const allowed = [
      "toggleCard",
      "toggleStar",
      "toggleDone",
      "openItem",
      "openMaterials",
      "confirmRemoveItem",
      "restoreItem",
      "verifyDdl",
    ];
    if (!allowed.includes(action)) return;
    const row = this._detail(id);
    if (
      !row ||
      (row.deleted &&
        ["toggleStar", "toggleDone", "confirmRemoveItem"].includes(action))
    )
      return;
    this.onCardActionStart();
    return this[action](event);
  },
  toggleCard(event) {
    if (this._blockDragTap()) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedCardId: this.data.expandedCardId === id ? "" : id });
  },
  openMaterials(event) {
    this.openItem(event);
    if (this.data.selected?.id === event.currentTarget.dataset.id)
      this.jumpToMaterials();
  },
  jumpToMaterials() {
    this.setData({ detailAnchor: "" }, () =>
      this.setData({ detailAnchor: "detail-materials" }),
    );
  },
  openItem(event) {
    if (this._blockDragTap()) return;
    const selected = this._presentDetail(this._detail(event.currentTarget.dataset.id));
    if (!selected) return this._error(Error("事项已更新，请刷新后再试"));
    this.setData({
      selected,
      editing: false,
      addition: "",
      chatInput: "",
      detailAnchor: "",
      detailScrollTop: 0,
      error: "",
      notice: "",
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
    if (this._drag || this._completionLock) return;
    try {
      const row = this._presentDetail(
        this._detail(event.currentTarget.dataset.id),
      );
      if (!row || row.deleted) throw Error("事项已更新，请重新打开");
      this.setData({
        selected: row,
        addition: "",
        error: "",
        notice: "",
        detailAnchor: "",
        detailScrollTop: 0,
        ...this._beginEditState(row),
      });
    } catch (error) {
      this._error(error);
    }
  },
  addDdl() {
    try {
      const title = this.data.ddlTitle.trim();
      if (!title) throw new Error("请填写事项标题");
      const date = this.data.ddlDate.trim(), time = this.data.ddlTime.trim();
      if (time && !date) throw Error("填写时刻时也请填写截止日期");
      let due = null;
      if (date) {
        try {
          due = parseDeadline(date, localDay(), time);
        } catch (error) {
          if (time) throw error;
        }
      }
      if (time && !due) throw Error("没能识别截止时间，请核对日期或时刻");
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
        ddlAddOpen: false,
      });
      this._refresh();
      this.syncQuietly();
      this._acknowledge(due ? "DDL 已添加" : "DDL 已添加，日期待确认");
    } catch (error) {
      this._error(error);
    }
  },
  closeItem() {
    this.setData({ selected: null, editing: false });
  },
  stopTap() {},
  onQuery(event) {
    clearTimeout(this._queryTimer);
    this.setData({ query: event.detail.value, limit: 60 });
    this._queryTimer = setTimeout(() => {
      this._queryTimer = null;
      this._refreshWorld();
    }, 160);
  },
  clearSearch() {
    clearTimeout(this._queryTimer);
    this._queryTimer = null;
    this.setData({ query: "", limit: 60 });
    this._refreshWorld();
  },
  resetWorldFilters() {
    clearTimeout(this._queryTimer);
    this._queryTimer = null;
    this.setData({
      query: "",
      kind: "all",
      kindIndex: 0,
      dateFilter: "all",
      dateIndex: 0,
      starOnly: false,
      group: "",
      limit: 60,
      filtersOpen: false,
      expandedCardId: "",
    });
    this._refreshWorld();
  },
  chooseScope(event) {
    const scope = ["active", "done", "trash"][Number(event.detail.value)];
    if (scope) this.setScope({ currentTarget: { dataset: { scope } } });
  },
  chooseGroup(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.groupChoices.length) return;
    this.setData({ group: index === 0 ? "" : this.data.groupChoices[index], limit: 60 });
    this._refreshWorld();
  },
  setScope(event) {
    const scope = event.currentTarget.dataset.scope;
    if (!["active", "done", "trash"].includes(scope)) return;
    this.setData({
      scope,
      scopeIndex: ["active", "done", "trash"].indexOf(scope),
      kind: "all",
      kindIndex: 0,
      group: "",
      expandedCardId: "",
      limit: 60,
    });
    this._refresh();
  },
  toggleFilters() {
    this.setData({ filtersOpen: !this.data.filtersOpen });
  },
  setKind(event) {
    const i = Number(event.detail.value);
    this.setData({ kindIndex: i, kind: this.data.kindKeys[i], limit: 60 });
    this._refreshWorld();
  },
  setSort(event) {
    const i = Number(event.detail.value),
      sort = this.data.sortKeys[i];
    try {
      wx.setStorageSync(FILTERS, { sort });
      this.setData({ sortIndex: i, sort });
      this._refreshWorld();
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
    this._refreshWorld();
  },
  toggleStarFilter() {
    this.setData({ starOnly: !this.data.starOnly, limit: 60 });
    this._refreshWorld();
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
    this.setData({ recordsOpen: !this.data.recordsOpen, error: "", notice: "" });
  },
  recordPage(event) {
    const next =
      this.data.recordPage + Number(event.currentTarget.dataset.step);
    if (next < 0 || next * 30 >= this.data.recordTotal) return;
    this.setData({ recordPage: next });
    this._refresh();
  },
  _changeItem(id, changes, deferRefresh = false) {
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
    if (!deferRefresh) this._refresh();
    this.syncQuietly();
  },
  async toggleDone(event) {
    if (this._blockDragTap()) return;
    if (this._completionLock) return;
    this._completionLock = true;
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      if (!row || row.deleted) return;
      // Persist first: a missed animation or interrupted page must not lose the action.
      this._changeItem(
        row.id,
        row.kind === "habit"
          ? habitCheckin(row.meta, localDay())
          : {
              status: row.done ? "active" : "done",
              completedAt: row.done ? "" : new Date().toISOString(),
            },
        true,
      );
      this.setData({ checkingId: row.id });
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (row.kind !== "habit" && !this.data.selected && this.data.tab !== "capture") {
        this.setData({ leavingId: row.id });
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
      this._acknowledge(row.kind === "habit"
        ? row.checked ? "已撤销今日打卡" : "今日打卡已记录"
        : row.done ? "已移回待处理" : "已标记完成");
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ checkingId: "", leavingId: "" });
      this._completionLock = false;
      this._refresh();
    }
  },
  toggleStar(event) {
    if (this._blockDragTap()) return;
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      if (!row || row.deleted) throw Error("事项已更新，请刷新后再试");
      this._changeItem(row.id, { starred: !row.starred });
      this._acknowledge(row.starred ? "已取消星标" : "已添加星标");
    } catch (error) {
      this._error(error);
    }
  },
  togglePin(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      if (this._blockDragTap()) return;
      wx.setStorageSync(FILTERS, { sort: "priority" });
      this.setData({ sort: "priority", sortIndex: 0 });
      this._changeItem(row.id, { pinned: !row.pinned });
      this.setData({
        error: "",
        notice: row.pinned ? "已取消置顶" : "已置顶，世界已切换为优先处理",
      });
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
  confirmRemoveItem(event) {
    if (this._blockDragTap()) return;
    wx.showModal({
      title: "将这项移入最近删除？",
      content: "可以在世界的最近删除中恢复，原文及其他事项会保留。",
      success: (answer) => {
        if (answer.confirm) this.removeItem(event);
      },
    });
  },
  removeItem(event) {
    try {
      this._changeItem(event.currentTarget.dataset.id, {
        deletedAt: new Date().toISOString(),
      });
      this.closeItem();
      this._acknowledge("已移入最近删除");
    } catch (error) {
      this._error(error);
    }
  },
  restoreItem(event) {
    try {
      const row = this._detail(event.currentTarget.dataset.id);
      if (row.packetDeleted) this._client.restore(row.packetId);
      else this._changeItem(row.id, { deletedAt: "" });
      this._acknowledge(row.packetDeleted ? "整次投递已恢复" : "事项已恢复");
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  checkin(event) {
    return this.toggleDone(event);
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
          this._acknowledge("投递已永久删除");
          this._refresh();
          this.syncQuietly();
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  _editFields(row) {
    return {
      editing: true,
      editTitle: row.item.title,
      editSummary: row.item.summary || "",
      editGroup: row.group,
      editDate: row.startDate ? row.timeLabel.replace(" → ", " 至 ") : row.date,
      editTime: row.startDate ? "" : row.time,
      editKind: Object.keys(KINDS).indexOf(row.kind),
    };
  },
  _beginEditState(row) {
    const fields = this._editFields(row);
    this._editingBaseline = { fields, item: JSON.stringify(row.item), group: row.group, id: row.id };
    return fields;
  },
  beginEdit() {
    const row = this.data.selected;
    if (row && !row.deleted)
      this.setData({ ...this._beginEditState(row), error: "", notice: "", detailAnchor: "", detailScrollTop: 0 });
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
    this.setData({ editing: false, error: "", notice: "" });
  },
  saveEdit() {
    try {
      const row = this._detail(this.data.selected?.id);
      if (!row || row.deleted) throw Error("事项已更新，请重新打开");
      const record = this._record(row.packetId),
        title = this.data.editTitle.trim(),
        group = this.data.editGroup.trim(),
        baseline = this._editingBaseline?.id === row.id ? this._editingBaseline : null;
      if (baseline && (baseline.item !== JSON.stringify(row.item) || baseline.group !== row.group))
        throw Error("事项已在另一处更新。请复制未保存的文字，再取消并重新编辑");
      if (!title || title.length > 150) throw Error("标题应为 1 至 150 字");
      const kind = Object.keys(KINDS)[this.data.editKind];
      if (!kind) throw Error("请选择事项类型");
      const date = this.data.editDate.trim(),
        time = this.data.editTime.trim(),
        initial = baseline?.fields || this._editFields(row),
        dateChanged = date !== initial.editDate || time !== initial.editTime;
      if (dateChanged && time && !date) throw Error("填写时刻时也请填写截止日期");
      const previous = record.data.result.items[row.index];
      const fields = absoluteItem(
        { ...previous, title, summary: this.data.editSummary.trim(), kind }, localDay(),
      );
      let next = { ...previous, title: fields.title, summary: fields.summary, kind };
      if (dateChanged) {
        const due = date ? parseDeadline(date, localDay(), time) : null;
        if (date && !due) throw Error("没能识别截止时间，请核对日期或时刻");
        next = setDeadline(next, due, record.data.captureDate);
      }
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
      if (JSON.stringify(previous) === JSON.stringify(next) && group === row.group) {
        this.cancelEdit();
        this._acknowledge("事项没有改动");
        return;
      }
      const patch = statePatch(record.data, row, {
        group,
        history,
        corrected: true,
      });
      this._client.put(row.packetId, { ...patch, result });
      this.setData({ editing: false });
      this._refresh();
      this.syncQuietly();
      this._acknowledge("修改已保存");
    } catch (error) {
      this._error(error);
    }
  },
  addNote() {
    try {
      const row = this._detail(this.data.selected.id),
        text = this.data.addition.trim();
      if (!text) throw Error("请先写下补充内容");
      this._changeItem(row.id, {
        additions: [
          ...(row.meta.additions || []),
          { id: makeId(), text, at: new Date().toISOString() },
        ],
      });
      this.setData({ addition: "" });
      this._acknowledge("补充已保存");
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
        if (!answer.confirm) return;
        if (!answer.content?.trim()) return this._error(Error("请填写事项标题"));
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
          this._acknowledge("事项已创建，可在世界查看");
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  copySource() {
    if (this.data.selected) this._copyText(this._record(this.data.selected.packetId)?.data?.text);
  },
  copyRecord(event) {
    const row = this._record(event.currentTarget.dataset.id);
    if (row) this._copyText(row.data?.text);
  },
  _copyText(text) {
    if (!text?.trim()) return this._error(Error("没有可复制的文字"));
    if (!wx.setClipboardData) return this._error(Error("当前微信环境无法访问剪贴板"));
    wx.setClipboardData({
      data: text,
      fail: () => this._error(Error("未能复制，请长按文字手动复制")),
    });
  },
  async probeAccountCapabilities() {
    if (this.data.accountProbeChecking || typeof wx.request !== "function") return;
    this.setData({ accountProbeChecking: true, accountProbeError: "" });
    try {
      const capability = await createTransport(
        accountServiceOrigin(wx),
        () => null,
        wx,
      )("GET", "/api/v4/capabilities");
      const passwordAccounts = capability.features?.registration === true;
      this.setData({ passwordAccounts, legacyAccountActivation: !passwordAccounts });
    } catch (error) {
      if (error.status === 404) {
        this.setData({ passwordAccounts: false, legacyAccountActivation: true });
        return;
      }
      const messages = {
        REQUEST_DOMAIN_NOT_ALLOWED: "微信未允许访问同步域名，请在小程序后台配置 request 合法域名。",
        REQUEST_TIMEOUT: "连接同步服务超时，请检查网络后重试。",
      };
      this.setData({
        legacyAccountActivation: false,
        accountProbeError: messages[error.reason] || "暂时连不上同步服务，请重试。",
      });
    } finally {
      this.setData({ accountProbeChecking: false });
    }
  },
  toggleAccountForm() {
    this.setData({ showAccountForm: !this.data.showAccountForm, switchAccountOpen: false, accountPassword: "", loginDevices: [] });
  },
  toggleAccountSwitch() {
    this.setData({
      switchAccountOpen: !this.data.switchAccountOpen,
      showAccountForm: false,
      credentialMode: "login",
      accountUsername: this.data.activeAccountName,
      accountPassword: "",
      loginDevices: [],
    });
  },
  chooseCredentialMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!["login", "register"].includes(mode)) return;
    this.setData({ credentialMode: mode, password: "", loginDevices: [], error: "", notice: "" });
  },
  onAccountField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  async credentialAction(event) {
    if (this.data.connecting || this.data.syncing || this.data.filesBusy || this.data.jobBusy || this.data.accountAction) return;
    let operationState;
    const { action, replace } = event.currentTarget.dataset;
    if (replace) {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "替换设备",
          content: "旧设备立即失去云端访问权限，本地副本保留。",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!answer.confirm) return;
    }
    this.setData({ connecting: true, error: "" });
    try {
      const current = this._connection;
      const keepPending = current && this._client.pendingCount() > 0;
      if (keepPending && action !== "claim" && (!this.data.authExpired || action === "register"))
        throw Error("请先同步待传操作，再切换账号");
      const operationKey = "shixu:mini:auth-operations:v1",
        operations = wx.getStorageSync(operationKey) || {};
      const key = `${action}:${this.data.accountUsername}:${replace || ""}`;
      operationState = { operationKey, operations, key };
      operations[key] ||= makeId();
      wx.setStorageSync(operationKey, operations);
      const connection = await accountCredentials(
        action,
        {
          operationId: operations[key],
          username: this.data.accountUsername,
          password: this.data.accountPassword,
          ...(action === "register" ? { invite: this.data.password } : {}),
          ...(replace ? { replaceBindingId: replace } : {}),
        },
        wx,
        this._connection,
      );
      if (action !== "claim") {
        if (current && current.userId !== connection.userId && this._client.pendingCount())
          throw Error("请先重新登录当前账号，上传未同步的修改后再切换");
        const previous = wx.getStorageSync(stateKey(spaceKey(connection)));
        if (previous?.epoch && previous.epoch !== connection.epoch)
          throw Error("账号资料版本变化，本机队列已保留");
        wx.setStorageSync(this._draftKey(), {
          id: this._draftId,
          text: this.data.draft,
        });
        this._activate(connection);
        wx.setStorageSync(CONNECTION, connection);
        wx.setStorageSync(CONNECTION + ":active", true);
      }
      this.setData({
        accountPassword: "",
        password: "",
        loginDevices: [],
        showAccountForm: false,
        switchAccountOpen: false,
        notice: action === "claim" ? "账号密码已设置" : "账号已连接，本机资料已保留",
      });
      delete operations[key];
      wx.setStorageSync(operationKey, operations);
      await this.sync();
    } catch (error) {
      if (
        operationState &&
        [400, 401, 403, 404, 409, 422, 426, 429, 503].includes(error.status)
      ) {
        const { operations, key, operationKey } = operationState;
        delete operations[key];
        wx.setStorageSync(operationKey, operations);
      }
      if (error.code === "DEVICE_SLOTS_FULL")
        this.setData({
          loginDevices: (error.devices || []).map((device) => ({
            ...device,
            lastSeenLabel: new Date(device.lastSeen).toLocaleString(),
          })),
        });
      this._error(error, { session: action === "claim" });
    } finally {
      this.setData({ connecting: false });
    }
  },
  async revokeAccountDevice(event) {
    if (this.data.accountAction || this.data.connecting || this.data.authExpired || !this._transport) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ accountAction: id });
    try {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "撤销设备",
          content: "该设备会失去云端访问权限，本地副本保留。",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!answer.confirm) return;
      await this._transport("POST", `/api/v4/devices/${encodeURIComponent(id)}/revoke`, {
        contractVersion: 1,
        operationId: makeId(),
      });
      this.setData({ accountDevices: this.data.accountDevices.filter((device) => device.id !== id) });
      this._acknowledge("设备已撤销");
      await this.sync();
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ accountAction: "" });
    }
  },
  async changeAccountPassword() {
    if (this.data.accountAction || this.data.connecting || this.data.authExpired || !this._transport) return;
    this.setData({ accountAction: "password" });
    try {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "修改密码并撤销现有设备？",
          content: "修改后，需要在手机和 Windows 上重新登录。",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!answer.confirm) return;
      await this._transport("POST", "/api/v4/auth/password", {
        contractVersion: 1,
        operationId: makeId(),
        oldPassword: this.data.accountPassword,
        newPassword: this.data.accountNewPassword,
        revokeAll: true,
      });
      this.setData({
        accountPassword: "",
        accountNewPassword: "",
        accountDevices: [],
        authExpired: true,
        passwordChangeRequired: false,
        showAccountForm: true,
        credentialMode: "login",
        activationState: "密码已修改，请使用新密码重新登录",
        accountAiState: "重新登录后可查看云端 AI 状态",
        syncStatus: "设备已撤销，等待重新登录",
      });
      this._acknowledge("密码已修改，请重新登录");
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ accountAction: "" });
    }
  },
  _organizeJob(packetId) {
    const jobs = (this._jobs || []).filter((job) =>
      job.state !== "purged" && (job.kind || job.request?.kind) === "organize" &&
      (job.packetId || job.request?.packetId) === packetId,
    );
    return jobs.find((job) => ACTIVE_JOB_STATES.includes(job.state)) ||
      jobs[jobs.length - 1];
  },
  _jobViews(jobs) {
    return jobs.map(
      ({
        id,
        state,
        error,
        output,
        actions,
        serverAccepted,
        calls,
        hasPreview,
        reusedBlocks,
        phase,
        completedMergeBatches,
        completedAssociationBatches,
        completedVisualBatches,
        readingSummary,
        rootCalls,
        rootActiveSeconds,
      }) => ({
        id,
        state,
        error,
        retryable: canResubmitOrganize({ state, actions, serverAccepted }),
        hasOutput: !!output,
        hasPreview: !!hasPreview,
        calls: calls || 0,
        completedVisualBatches,
        reuseLabel: reuseView(reusedBlocks),
        mergeLabel: mergeProgressView(phase, completedMergeBatches, completedVisualBatches, completedAssociationBatches),
        pdfProgressLabel: [pdfProgressView(readingSummary),imageProgressView(readingSummary)].filter(Boolean).join("；"),
        rootCalls,
        rootActiveSeconds,
        canStop: actions?.includes("stop") || false,
        canContinue: actions?.includes("continue") || false,
        canPurge: actions?.includes("purge") || false,
        canAcceptPartial: actions?.includes("accept-partial") || false,
        canCompleteRemaining: actions?.includes("remaining") || false,
      }),
    );
  },
  _saveJobs(jobs) {
    wx.setStorageSync(jobsKey(this._space()), jobs);
    this._jobs = jobs;
    this.setData({ jobs: this._jobViews(jobs) });
  },
  _pollJobs() {
    if (!this._connection || !this._jobs) return;
    if (!this._pollingJobs) this._pollingJobs = this._updateJobs().finally(() => {
      this._pollingJobs = null;
    });
    return this._pollingJobs;
  },
  async _updateJobs() {
    try {
      const records = this._client.records();
      const remoteTaskIds = new Set();
      if (this._reading) {
        const remote = await this._transport("GET", "/api/v4/tasks");
        const jobsById = new Map(this._jobs.map((job) => [job.id, job]));
        const jobs = [];
        let published = false;
        for (const task of remote.tasks.slice().reverse()) {
          remoteTaskIds.add(task.id);
          if (this.data.taskPreview?.taskId === task.id) this.setData({ taskPreview: task.state === "purged" ? null
            : { ...this.data.taskPreview, published: ["done", "partial"].includes(task.state) } });
          const old = jobsById.get(task.id);
          if (old) {
            if (["done", "partial"].includes(task.state) && old.state !== task.state) published = true;
            jobs.push({ ...old, ...task, protocol: 4, serverAccepted: true });
          }
          else
            jobs.push({
              ...task,
              protocol: 4,
              serverAccepted: true,
              request: { packetId: task.packetId, kind: task.kind || "organize", ...(task.itemId?{itemId:task.itemId}:{}) },
            });
        }
        if (published) await this._client.sync();
        this._saveJobs([...this._jobs.filter((job) => !remoteTaskIds.has(job.id)), ...jobs]);
      }
      for (const saved of this._jobs.slice()) {
        if (saved.pendingAction) {
          const { action, ...request } = saved.pendingAction;
          if (["continue", "remaining"].includes(action)) this._requireMaterialConsent();
          let task;
          try {
            if (["continue", "accept-partial", "remaining"].includes(action))
              await this._reuploadTemporary(
                saved.packetId || saved.request.packetId,
              );
            task = await this._transport(
              "POST",
              `/api/v4/tasks/${saved.id}/${action}`,
              request,
            );
          } catch (error) {
            if ([401, 403, 404, 409, 422, 426, 503].includes(error.status) ||
                (error.status === 429 && !this._rememberRateLimit(error)))
              this._saveJobs(
                this._jobs.map((j) =>
                  j.id === saved.id
                    ? { ...j, pendingAction: null, error: error.message }
                    : j,
                ),
              );
            throw error;
          }
          if (action === "remaining") {
            const latest = this._jobs.map(j => j.id === saved.id
              ? { ...j, pendingAction: null, actions: j.actions?.filter(a => a !== "remaining") } : j);
            if (!latest.some(j => j.id === task.id)) latest.push({ ...task, request: { packetId: task.packetId, kind: "organize" } });
            this._saveJobs(latest);
            continue;
          }
          if (action === "purge" && this.data.taskPreview?.taskId === saved.id) this.setData({ taskPreview: null });
          this._saveJobs(
            this._jobs.map((j) =>
              j.id === saved.id ? { ...j, ...task, pendingAction: null } : j,
            ),
          );
          continue;
        }
        const record = records.find((r) => r.id === (saved.packetId || saved.request?.packetId));
        if (record && record.purged) {
          this._saveJobs(this._jobs.filter((j) => j.id !== saved.id));
          continue;
        }
        if (
          !["submitting", "queued", "running", "applying"].includes(saved.state)
        )
          continue;
        if (this._reading && saved.state !== "submitting" &&
            remoteTaskIds.has(saved.id)) continue;
        let job;
        try {
          if (saved.state === "submitting" && saved.protocol === 4) this._requireMaterialConsent();
          if (saved.state === "submitting" && saved.protocol === 4)
            await this._reuploadTemporary(saved.request.packetId);
          job =
            saved.state === "submitting"
              ? await this._transport(
                  "POST",
                  saved.protocol === 4 ? "/api/v4/tasks" : "/api/v2/jobs",
                  saved.request,
                )
              : await this._transport(
                  "GET",
                  `${saved.protocol === 4 ? "/api/v4/tasks" : "/api/v2/jobs"}/${saved.id}`,
                );
        } catch (error) {
          if ([400, 403, 404, 409, 413, 422, 503].includes(error.status) ||
              (error.status === 429 && !this._rememberRateLimit(error))) {
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
          this._jobs.map((j) => (j.id === saved.id ? { ...j, ...job, serverAccepted: true } : j)),
        );
        if (["done", "partial"].includes(job.state)) await this._client.sync();
      }
    } catch (error) {
      this._rememberRateLimit(error);
      throw error;
    }
  },
  async _startJob(kind, packetId, itemId, instruction) {
    if (this.data.jobBusy) return;
    if (this.data.localMode) {
      if (kind !== "chat") this.openAiSettings();
      this._error(
        new Error("请先连接配置了 AI 的同步服务，并导入这次本机投递"),
      );
      return;
    }
    this.setData({
      jobBusy: true,
      error: "",
      organizingPacketId: kind === "organize" ? packetId : "",
    });
    if (kind === "organize") this._setDeliveryIssue(packetId, "organize", "");
    try {
      const synced = await this.sync();
      if (
        !synced ||
        this._client.pendingCount() ||
        this.data.pendingFiles
      )
        throw new Error(this.data.error || this.data.syncStatus || "请先完成未同步操作");
      if (kind === "organize") {
        await this._pollJobs();
        const existing = this._organizeJob(packetId);
        if (existing && !canResubmitOrganize(existing)) {
          this.setData({ notice: "这次投递已有整理任务，请在原文下方查看进度" });
          return;
        }
      }
      if (
        !(kind === "chat"
          ? this.data.capabilities.itemChat
          : this.data.capabilities.aiOrganize)
      ) {
        throw new Error("服务器尚未启用此 AI 能力，原文和事项已保留");
      }
      this._requireMaterialConsent();
      const record = this._record(packetId);
      if (!record || record.deletedAt || record.conflict)
        throw new Error("请先恢复投递并解决同步冲突");
      const costWallet = this._reading
        ? await this._transport("GET", "/api/v4/wallet") : null;
      const request = {
        id: makeId(),
        kind,
        packetId,
        baseVersion: record.version,
        epoch: this._epoch,
        ...(this._reading ? {
          contractVersion: 1,
          expectedCostOperation: costWallet?.costAuditOperation || null,
        } : {}),
        ...(kind === "chat" ? { itemId, instruction } : {}),
      };
      const entry = {
        id: request.id,
        request,
        state: "submitting",
        error: "",
        ...(this._reading ? { protocol: 4 } : {}),
      };
      // Do not evict active requests; they may already have incurred a model charge.
      const jobs = this._jobs || [],
        active = jobs.filter((j) =>
          ACTIVE_JOB_STATES.includes(j.state),
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
        notice: kind === "chat" ? "对话任务已提交，可在设置中查看进度" : "",
        chatInput: "",
      });
    } catch (error) {
      this._rememberRateLimit(error);
      if (kind === "organize") this._setDeliveryIssue(packetId, "organize", error.message);
      if (kind === "chat" || error.status === 401) this._error(error);
    } finally {
      this.setData({ jobBusy: false, organizingPacketId: "" });
      this._refresh();
    }
  },
  showDelivery(event) {
    const id = event.currentTarget.dataset.id;
    this._showTab("capture", { recordsOpen: false, currentCaptureId: id, captureResultAnchor: "" });
    this._refresh();
    this.setData({ captureResultAnchor: "capture-result" });
  },
  organizeRecord(event) {
    return this._startJob("organize", event.currentTarget.dataset.id);
  },
  acceptMaterialUse() {
    const notice = this._reading?.materialUseNotice;
    if (!notice || !this._connection) return;
    try {
      wx.setStorageSync("material-use:" + spaceKey(this._connection), notice.version);
      this.setData({ materialConsentAccepted: true });
      this._acknowledge("已确认资料用途和保存期限");
    } catch (error) { this._error(error); }
  },
  async taskPreview(event) {
    const { id, offset } = event.currentTarget.dataset;
    if (!this._transport || this.data.jobBusy) return;
    this.setData({ jobBusy: true });
    const space = this._space();
    try {
      const preview = await this._transport("GET", `/api/v4/tasks/${encodeURIComponent(id)}/preview?offset=${offset || 0}`);
      if (space !== this._space()) return;
      this.setData({ taskPreview: preview, recordsOpen: false, error: "" });
    } catch (error) { this._error(error); }
    finally { this.setData({ jobBusy: false }); }
  },
  closeTaskPreview() {
    this.setData({ taskPreview: null });
  },
  _requireMaterialConsent() {
    const notice = this._reading?.materialUseNotice;
    if (notice && wx.getStorageSync("material-use:" + spaceKey(this._connection)) !== notice.version)
      throw Error("请先在账号设置确认资料用途和保存期限；尚未发起AI调用");
  },
  async taskAction(event) {
    const { id, action } = event.currentTarget.dataset;
    const job = (this._jobs || []).find((j) => j.id === id);
    if (!job || !job.actions?.includes(action) || this.data.jobBusy) return;
    if (action === "purge") {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: "清除任务",
          content: "可复用块将清除，已发布事项和已消费额度保留。",
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!answer.confirm) return;
    }
    this.setData({ jobBusy: true });
    try {
      if (["continue", "remaining"].includes(action)) this._requireMaterialConsent();
      if (["continue", "accept-partial", "remaining"].includes(action))
        await this._reuploadTemporary(job.packetId || job.request.packetId);
      if (!job.pendingAction)
        job.pendingAction = {
          action,
          contractVersion: 1,
          operationId: makeId(),
          expectedGeneration: job.generation,
          expectedRevision: job.inputRevision,
          expectedMaintenanceOperation: job.maintenanceOperation || null,
          ...(action === "remaining" ? { expectedCostOperation: (await this._transport("GET", "/api/v4/wallet"))?.costAuditOperation || null } : {}),
        };
      this._saveJobs(this._jobs.map((j) => (j.id === id ? job : j)));
      await this._pollJobs();
      await this.sync();
      this._refresh();
      this._acknowledge("任务状态已更新");
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ jobBusy: false });
    }
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
      this._copyText(JSON.stringify(job.output, null, 2));
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
          : ["capybara", "owl"].includes(s.art) ? this._builtinSkinArt(s.art)
          : s.art === "whale"
            ? "/assets/mascot.png"
            : s.art === "bunny"
              ? "/assets/bunny.png"
              : "/assets/ice.png",
    }));
    const activeSkin =
      skins.find((s) => s.id === collection.selected) || skins[0];
    this.setData({
      skins,
      iceVoices: Object.entries(ICE_VOICES).map(([id, label]) => ({
        id,
        label,
      })),
      iceVoice: collection.iceVoice || "voice-1",
      activeSkin,
      previewSkin: activeSkin,
      skinMessage: activeSkin.hello,
    });
  },
  _skinPath(skin) {
    if (!wx.env || !wx.getFileSystemManager) return skin.image;
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(skin.image);
    if (!match) return "/assets/mascot.png";
    const file = `${wx.env.USER_DATA_PATH}/shixu-${skin.id}.${match[1]}`;
    // Local files keep eight custom images from overflowing WeChat's setData limit.
    this._skinImageWrites ||= new Map();
    if (this._skinImageWrites.get(file) === skin.image) return file;
    try {
      wx.getFileSystemManager().writeFileSync(file, match[2], "base64");
      this._skinImageWrites.set(file, skin.image);
      return file;
    } catch {
      return "/assets/mascot.png";
    }
  },
  _builtinSkinArt(art) {
    try {
      return packedWebp(`/assets/${art}.bin`, art);
    } catch {
      return "/assets/mascot.png";
    }
  },
  openSkins() {
    this._stopSkinInteraction();
    this.setData({
      error: "", notice: "",
      skinOpen: true,
      foxPreviewReady: false,
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
    if (!s) return;
    try {
      if (this.data.activeSkin.id === s.id) return this._acknowledge("当前正在使用这款皮肤");
      this._saveSkins({ ...this._skinCollection, selected: s.id });
      this._acknowledge("已换用" + s.name);
    } catch (error) {
      this._error(error);
    }
  },
  interactSkin() {
    const s = this.data.skinOpen ? this.data.previewSkin : this.data.activeSkin;
    this._stopSkinInteraction();
    this.setData({
      skinMessage: s.greeting,
      skinAnimating: s.art !== "ice",
    });
    if (s.art !== "bunny") this._startSkinMotion(s);
    if (skinSound(s, this.data.iceVoice) && this._prepareSkinAudio(s)) {
      try {
        this._skinAudio.play();
        if (s.art === "bunny" && !this._skinAudio.onPlay)
          this._startBunnyClip();
      } catch (_) {
        this.setData({
          skinAnimating: false,
          notice: "声音暂时不可用，资料保存不受影响",
        });
      }
    } else
      this._skinTimer = setTimeout(
        () => this._finishSkinInteraction(),
        SKIN_INTERACTION.greetingMs,
      );
  },
  foxResourceReady(event) {
    this.setData({
      [event.currentTarget.dataset.preview ? "foxPreviewReady" : "foxHomeReady"]: true,
    });
  },
  foxResourceError(event) {
    this.setData({
      [event.currentTarget.dataset.preview ? "foxPreviewReady" : "foxHomeReady"]: false,
    });
  },
  _startBunnyClip() {
    clearTimeout(this._bunnyTimer);
    const generation = (this._bunnyGeneration || 0) + 1;
    this._bunnyGeneration = generation;
    const started = Date.now();
    this.setData({ bunnyPlaying: true });
    const advance = () => {
      if (generation !== this._bunnyGeneration || !this.data.skinAnimating)
        return;
      const time = (Date.now() - started) / 1000;
      if (time >= BUNNY_CLIP.duration) {
        this._stopSkinInteraction();
        return;
      }
      const frame = bunnyFrame(time);
      this.setData({
        bunnyPosition: `left:${-frame.x * (BUNNY_CLIP.columns - 1)}%;top:${-frame.y * (BUNNY_CLIP.rows - 1)}%`,
      });
      this._bunnyTimer = setTimeout(advance, 1000 / BUNNY_CLIP.fps);
    };
    advance();
  },
  _startSkinMotion(skin) {
    if (skin.art === "ice" || skin.art === "bunny") return;
    if (!wx.createAnimation) return;
    const motion = NATIVE_SKIN_MOTIONS[skin.motion];
    if (!motion) return;
    clearTimeout(this._skinMotionTimer);
    const generation = (this._skinMotionGeneration || 0) + 1;
    this._skinMotionGeneration = generation;
    this.setData({ skinNativeMotion: true });
    let index = 1,
      turns = 0;
    const advance = () => {
      if (!this.data.skinAnimating || generation !== this._skinMotionGeneration)
        return;
      const frame = motion.frames[index];
      const duration =
        ((frame.at - motion.frames[index - 1].at) * motion.duration) / 100;
      // Send one changed target per render. Re-exporting identical whole cycles
      // can be deduplicated by the native view after the first cycle.
      const animation = wx.createAnimation({
        duration,
        transformOrigin: "50% 83%",
        timingFunction: "ease-in-out",
      });
      for (const [method, ...args] of frame.commands) {
        if (skin.motion === "spin" && method === "rotate")
          animation.rotate(args[0] + 360 * turns);
        else animation[method](...args);
      }
      animation.step({ duration });
      this.setData({ skinAnimation: animation.export() });
      index++;
      if (index === motion.frames.length) {
        index = 1;
        turns++;
      }
      this._skinMotionTimer = setTimeout(advance, duration + 16);
    };
    advance();
  },
  _finishSkinInteraction() {
    clearTimeout(this._bunnyTimer);
    this._bunnyGeneration = (this._bunnyGeneration || 0) + 1;
    const skin = this.data.skinOpen
      ? this.data.previewSkin
      : this.data.activeSkin;
    clearTimeout(this._skinMotionTimer);
    this._skinMotionGeneration = (this._skinMotionGeneration || 0) + 1;
    const reset = wx.createAnimation && wx.createAnimation({ duration: 100 });
    if (reset) reset.translateY(0).scale(1, 1).rotate(0).step();
    this.setData({
      skinAnimating: false,
      bunnyPlaying: false,
      bunnyPosition: "left:0%;top:0%",
      skinMessage: skin.hello,
      ...(reset ? { skinAnimation: reset.export() } : {}),
    });
  },
  _stopSkinInteraction() {
    clearTimeout(this._skinTimer);
    try {
      if (this._skinAudio) this._skinAudio.stop();
    } catch (_) {}
    this._finishSkinInteraction();
  },
  changeIceVoice(event) {
    const voice = event.currentTarget.dataset.voice;
    if (!Object.prototype.hasOwnProperty.call(ICE_VOICES, voice)) return;
    this._stopSkinInteraction();
    try {
      this._saveSkins({ ...this._skinCollection, iceVoice: voice });
    } catch (error) {
      this._error(error);
    }
  },
  _prepareSkinAudio(skin = this.data.activeSkin) {
    const file = skinSound(skin, this.data.iceVoice);
    if (!file) return false;
    const source = "/assets/" + file;
    if (this._skinAudio) {
      if (this._skinAudio.src !== source) this._skinAudio.src = source;
      return true;
    }
    if (!wx.createInnerAudioContext) return false;
    let audio;
    try {
      audio = wx.createInnerAudioContext();
      audio.onEnded(() => this._finishSkinInteraction());
      if (audio.onPlay)
        audio.onPlay(() => {
          const s = this.data.skinOpen
            ? this.data.previewSkin
            : this.data.activeSkin;
          if (s.art === "bunny" && this.data.skinAnimating)
            this._startBunnyClip();
        });
      audio.onError(() => {
        this._finishSkinInteraction();
        this.setData({ notice: "声音播放失败，请重试" });
      });
      audio.obeyMuteSwitch = false;
      audio.volume = SKIN_INTERACTION.volume;
      audio.loop = false;
      audio.src = source;
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
      skinAnimating: s.art !== "ice",
    });
    this._startSkinMotion(s);
    this._skinTimer = setTimeout(
      () => this._finishSkinInteraction(),
      SKIN_INTERACTION.feedingMs,
    );
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
    if (!wx.chooseMedia || !wx.getFileSystemManager) return this._error(Error("当前微信环境无法选择图片"));
    const editingId = this.data.skinForm.id;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (answer) => {
        const file = answer.tempFiles?.[0];
        if (!file) return;
        if (file.size > 250000) {
          this._error(new Error("请选择小于 250 KB 的 PNG、JPG 或 WebP 图片"));
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: "base64",
          success: (result) => {
            if (!this.data.skinEditor || this.data.skinForm.id !== editingId) return;
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
      fail: (error) => {
        if (!/cancel/i.test(error?.errMsg || "")) this._error(Error("未能打开相册或相机"));
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
      const candidate = {
          ...this._skinCollection,
          selected: skin.id,
          custom: [...custom, skin],
        },
        parsed = parseSkinCollection(JSON.stringify(candidate));
      if (!parsed.custom.some((s) => s.id === skin.id))
        throw new Error("请添加图片，名称不超过 20 字，台词应为 1 至 40 字");
      this._saveSkins(candidate);
      this.setData({ skinEditor: false });
      this._acknowledge("自定义皮肤已保存并应用");
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
            ...this._skinCollection,
            selected:
              this._skinCollection.selected === id
                ? "whale"
                : this._skinCollection.selected,
            custom: this._skinCollection.custom.filter((s) => s.id !== id),
          });
          this._acknowledge("自定义皮肤已删除");
        } catch (error) {
          this._error(error);
        }
      },
    });
  },
  remove(event) {
    try {
      this._client.remove(event.currentTarget.dataset.id);
      this._acknowledge("投递已移入最近删除");
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
  },
  restore(event) {
    try {
      this._client.restore(event.currentTarget.dataset.id);
      this._acknowledge("投递及事项已恢复");
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
            this._acknowledge("已将本机修改另存一份");
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
                this._acknowledge("已采用服务器版本");
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
      wx.setStorageSync(this._draftKey(), {
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
