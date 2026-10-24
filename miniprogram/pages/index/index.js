const { createSyncClient, makeId } = require("../../lib/sync-client");
const { createTransport, normalizeServiceURL } = require("../../lib/transport");
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
    draft: "",
    rows: [],
    count: 0,
    pending: 0,
    conflicts: 0,
    serverUrl: "",
    password: "",
    connected: false,
    connecting: false,
    syncing: false,
    error: "",
    notice: "",
    showDeleted: false,
    expandedId: "",
    updateReady: false,
  },
  onLoad() {
    try {
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
    } catch (error) {
      this._error(error);
    }
    this._network = (result) => {
      if (result.isConnected) this.syncQuietly();
    };
    wx.onNetworkStatusChange(this._network);
  },
  onShow() {
    this.setData({ updateReady: getApp().globalData.updateReady });
    this.syncQuietly();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.syncQuietly(), 8000);
  },
  onHide() {
    clearInterval(this._timer);
  },
  onUnload() {
    clearInterval(this._timer);
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
    this._transport = transport;
    this._client = client;
    this.setData({ connected: true, serverUrl: base });
    this._refresh();
  },
  _refresh() {
    if (!this._client) return;
    const all = this._client.records().filter((row) => !row.purged && row.data);
    const rows = all
      .filter((row) => !!row.deletedAt === this.data.showDeleted)
      .sort((a, b) =>
        (b.data.capturedAt || "").localeCompare(a.data.capturedAt || ""),
      )
      .map((row) => ({
        id: row.id,
        text: row.data.text,
        title: (row.data.text.split("\n")[0] || "文字投递").slice(0, 32),
        date: row.data.captureDate || "",
        deleted: !!row.deletedAt,
        conflict: !!row.conflict,
        state: row.conflict ? "需处理冲突" : row.pending ? "待同步" : "已同步",
      }));
    this.setData({
      rows,
      count: all.filter((row) => !row.deletedAt).length,
      pending: this._client.pendingCount(),
      conflicts: this._client.conflicts().length,
    });
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
    this.setData({ tab: event.currentTarget.dataset.tab, notice: "" });
    this._refresh();
  },
  toggleDeleted() {
    this.setData({ showDeleted: !this.data.showDeleted });
    this._refresh();
  },
  expand(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedId: this.data.expandedId === id ? "" : id });
  },
  async connect() {
    if (this.data.connecting || this.data.syncing) return;
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
        token: device.token,
        deviceId: device.deviceId,
        expiresAt: device.expiresAt,
      };
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
    if (!this._client || this.data.syncing) return;
    this.setData({ syncing: true });
    try {
      const result = await this._client.sync();
      this.setData({
        error: "",
        notice: result.conflicts ? "有修改冲突，本机副本已保留" : "资料已同步",
      });
    } catch (error) {
      this._error(error);
    } finally {
      this.setData({ syncing: false });
      this._refresh();
    }
  },
  syncQuietly() {
    if (this._client) return this.sync();
  },
  submit() {
    if (!this.data.draft.trim()) return;
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
      this._client.put(id, {
        id,
        text,
        ...dateInfo(),
        sources: [{ id: "input", name: "随手输入", text }],
        attachments: [],
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
        notice: "文字已保存；当前预览尚未接入 AI 整理",
      });
      this._refresh();
      this.syncQuietly();
    } catch (error) {
      this._error(error);
    }
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
    if (this.data.syncing || this.data.connecting) {
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
        if (this.data.syncing || this.data.connecting) {
          wx.showToast({ title: "正在同步，稍后再更新", icon: "none" });
          return;
        }
        getApp().updateManager.applyUpdate();
      },
    });
  },
});
