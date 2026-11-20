const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const sizes = {
  strip: { width: 340, height: 300 },
  rail: { width: 370, height: 660 },
  panel: { width: 680, height: 660 },
  ddl: { width: 640, height: 590 },
};
const documentExtensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".pdf",
  ".docx",
  ".doc",
  ".rtf",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".odt",
  ".ods",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".mp3",
  ".wav",
  ".mp4",
]);
const resizeEdges = new Set(["n", "s", "w", "e", "nw", "ne", "sw", "se"]);

const defaults = () => ({
  mode: "rail",
  locked: false,
  top: true,
  density: "compact",
  opacity: 1,
  restore: false,
  zoom: 1,
  fontSize: 14,
  modeBounds: {},
  bounds: { x: 60, y: 60, width: 370, height: 660 },
});
function windowSettings(value) {
  const s = { ...defaults(), ...value };
  if (
    !["strip", "rail", "panel", "ddl"].includes(s.mode) ||
    typeof s.locked !== "boolean" ||
    typeof s.top !== "boolean" ||
    typeof s.restore !== "boolean" ||
    !["compact", "comfortable"].includes(s.density) ||
    !Number.isFinite(s.opacity) ||
    s.opacity < 0.65 ||
    s.opacity > 1 ||
    !Number.isFinite(s.zoom) ||
    s.zoom < 0.65 ||
    s.zoom > 2 ||
    !Number.isInteger(s.fontSize) ||
    s.fontSize < 11 ||
    s.fontSize > 24
  )
    throw Error("窗口设置无效");
  const validBounds = (bounds) =>
    bounds &&
    ["x", "y", "width", "height"].every((k) => Number.isFinite(bounds[k])) &&
    bounds.width >= 200 &&
    bounds.height >= 30;
  s.bounds = validBounds(s.bounds) ? s.bounds : defaults().bounds;
  s.modeBounds = Object.fromEntries(
    Object.entries(s.modeBounds || {}).filter(
      ([mode, bounds]) => Object.hasOwn(sizes, mode) && validBounds(bounds),
    ),
  );
  if (!s.modeBounds[s.mode]) {
    s.modeBounds[s.mode] =
      s.mode === "strip" && s.bounds.height < 120
        ? { ...s.bounds, height: sizes.strip.height }
        : s.bounds;
  }
  return s;
}
class BoardWindow {
  constructor({
    BrowserWindow,
    screen,
    globalShortcut,
    root,
    quitting,
    mainWindow,
    service,
    openPath,
  }) {
    Object.assign(this, {
      BrowserWindow,
      screen,
      globalShortcut,
      root,
      quitting,
      mainWindow,
      service,
      openPath,
    });
    this.originalCopies = new Map();
    this.settings = windowSettings();
    try {
      this.settings = windowSettings(
        JSON.parse(fs.readFileSync(this.file(), "utf8")),
      );
    } catch {}
  }
  file() {
    return path.join(this.root, "board-window.json");
  }
  save() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.file() + ".next", JSON.stringify(this.settings));
    fs.renameSync(this.file() + ".next", this.file());
  }
  valid(event) {
    if (
      ![this.mainWindow(), this.win].some(
        (w) =>
          w &&
          !w.isDestroyed() &&
          event.senderFrame === w.webContents.mainFrame,
      ) ||
      !/^shixu:\/\/app\/(?:\?|$)/.test(event.senderFrame.url)
    )
      throw Error("看板来源无效");
  }
  clamp(bounds) {
    const area = this.screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(bounds.width, area.width),
      height = Math.min(bounds.height, area.height);
    return {
      width,
      height,
      x: Math.round(
        Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
      ),
      y: Math.round(
        Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
      ),
    };
  }
  get stripCollapsed() {
    return this.settings.mode === "strip" && !this.stripExpanded;
  }
  minimum() {
    return {
      width: Math.max(200, Math.ceil(164 * this.settings.zoom)),
      height: this.stripCollapsed ? Math.ceil(54 * this.settings.zoom) : 120,
    };
  }
  boundsForMode() {
    const bounds = this.settings.modeBounds[this.settings.mode] || {
      ...this.settings.bounds,
      ...sizes[this.settings.mode],
    };
    const min = this.minimum();
    return this.clamp({
      ...bounds,
      width: Math.max(min.width, bounds.width),
      height: this.stripCollapsed
        ? min.height
        : Math.max(min.height, bounds.height),
    });
  }
  remember() {
    if (!this.win || this.win.isDestroyed()) return;
    const bounds = this.win.getBounds();
    const mode = this.settings.mode;
    this.settings.bounds = bounds;
    this.settings.modeBounds[mode] = this.stripCollapsed
      ? {
          ...bounds,
          height: this.settings.modeBounds.strip?.height || sizes.strip.height,
        }
      : bounds;
    this.save();
  }
  apply() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(this.settings.top, "screen-saver");
    this.win.setMovable(!this.settings.locked);
  }
  async show() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.showInactive();
      return;
    }
    const bounds = this.boundsForMode();
    this.win = new this.BrowserWindow({
      ...bounds,
      title: "拾序看板",
      resizable: false,
      frame: false,
      transparent: true,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "board-preload.cjs"),
        backgroundThrottling: false,
      },
    });
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.win.on("page-title-updated", (event) => event.preventDefault());
    this.win.webContents.on("will-navigate", (e, url) => {
      if (url !== "shixu://app/?board=1") e.preventDefault();
    });
    this.win.on("close", (e) => {
      if (!this.quitting()) {
        e.preventDefault();
        this.win.hide();
      }
    });
    this.win.on("moved", () => {
      if (!this.resize) this.remember();
    });
    const finishResize = () => {
      if (!this.resize) return;
      this.resize = undefined;
      this.remember();
    };
    this.win.on("hide", finishResize);
    this.win.on("blur", finishResize);
    this.win.once("ready-to-show", () => {
      this.apply();
      this.win.showInactive();
    });
    await this.win.loadURL("shixu://app/?board=1");
  }
  broadcast() {
    for (const w of [this.mainWindow(), this.win])
      if (w && !w.isDestroyed()) w.webContents.send("board-changed");
  }
  configure(value) {
    if (
      !value ||
      Object.keys(value).some(
        (key) =>
          ![
            "mode",
            "locked",
            "top",
            "density",
            "opacity",
            "restore",
            "fontSize",
            "zoom",
          ].includes(key),
      )
    )
      throw Error("窗口设置无效");
    const previous = this.settings;
    const nextMode = value.mode ?? previous.mode;
    const modeBounds = { ...previous.modeBounds };
    if (Object.hasOwn(sizes, nextMode) && !modeBounds[nextMode])
      modeBounds[nextMode] = { ...previous.bounds, ...sizes[nextMode] };
    this.settings = windowSettings({ ...previous, ...value, modeBounds });
    this.resize = undefined;
    if (
      this.win &&
      !this.win.isDestroyed() &&
      (previous.mode !== this.settings.mode ||
        previous.zoom !== this.settings.zoom)
    ) {
      if (previous.mode !== this.settings.mode) this.stripExpanded = false;
      this.win.setBounds(this.boundsForMode());
      this.remember();
    }
    this.apply();
    this.save();
    this.broadcast();
    return this.settings;
  }
  resizeWindow(action, edge) {
    if (!this.win || this.win.isDestroyed() || this.settings.locked) return;
    if (action === "resizeStart") {
      if (
        !resizeEdges.has(edge) ||
        (this.stripCollapsed && !["w", "e"].includes(edge))
      )
        throw Error("缩放方向无效");
      if (this.resize) return;
      this.resize = {
        edge,
        cursor: this.screen.getCursorScreenPoint(),
        bounds: this.win.getBounds(),
      };
      return;
    }
    if (!this.resize) return;
    const { edge: direction, cursor, bounds } = this.resize;
    const point = this.screen.getCursorScreenPoint();
    const dx = point.x - cursor.x,
      dy = point.y - cursor.y;
    const min = this.minimum();
    const area = this.screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(
      area.width,
      Math.max(
        min.width,
        bounds.width +
          (direction.includes("w") ? -dx : direction.includes("e") ? dx : 0),
      ),
    );
    const height = Math.min(
      area.height,
      Math.max(
        min.height,
        bounds.height +
          (direction.includes("n") ? -dy : direction.includes("s") ? dy : 0),
      ),
    );
    this.win.setBounds({
      x: direction.includes("w") ? bounds.x + bounds.width - width : bounds.x,
      y: direction.includes("n") ? bounds.y + bounds.height - height : bounds.y,
      width,
      height,
    });
    if (action === "resizeEnd") {
      this.resize = undefined;
      this.remember();
    }
  }
  async openOriginal(id, lease) {
    const original = await this.service.cloud.serial(() =>
      this.service.resource(id, lease, true),
    );
    const extension = path.extname(original.name).toLowerCase();
    if (!documentExtensions.has(extension))
      throw Error("此文件类型暂不支持从看板直接打开");
    // A fresh directory and a fixed basename keep attachment names away from
    // Windows path parsing, including device names and alternate streams.
    const dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "shixu-board-original-"),
    );
    const basename = original.name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 180);
    const target = path.join(
      dir,
      `拾序-${path.parse(basename).name}${extension}`,
    );
    try {
      await fs.promises.writeFile(target, Buffer.from(original.bytes), {
        flag: "wx",
        mode: 0o600,
      });
      if (process.platform === "win32")
        await fs.promises.writeFile(
          target + ":Zone.Identifier",
          "[ZoneTransfer]\r\nZoneId=3\r\n",
        );
      if (lease !== this.service.lease())
        throw Error("账号已切换，请重新打开看板");
      if (await this.openPath(target))
        throw Error("无法用默认应用打开，请检查文件关联");
      // Let the receiving app read the copy asynchronously. Remove it later
      // when possible, without touching the retained original.
      const cleanup = setTimeout(() => {
        void fs.promises
          .rm(dir, { recursive: true, force: true })
          .then(() => this.originalCopies.delete(dir))
          .catch(() => {});
      }, 600_000);
      cleanup.unref();
      this.originalCopies.set(dir, cleanup);
    } catch (error) {
      await fs.promises
        .rm(dir, { recursive: true, force: true })
        .catch(() => {});
      throw error;
    }
  }
  cleanOriginalCopies() {
    for (const [dir, timer] of this.originalCopies) {
      clearTimeout(timer);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may keep the copy open in the receiving app.
      }
    }
    this.originalCopies.clear();
  }
  async action(action, value, lease, floating) {
    if (lease !== this.service.lease())
      throw Error("账号已切换，请关闭并重新打开看板");
    if (action === "windowState")
      return {
        ...this.settings,
        shortcutAvailable: this.shortcutRegistered !== false,
      };
    if (action === "show") {
      if (floating) throw Error("请在主程序打开看板");
      if (value !== undefined) this.configure({ mode: value?.mode });
      await this.show();
      return this.settings;
    }
    if (action === "hide") {
      this.win?.hide();
      return;
    }
    if (action === "configureWindow") {
      if (
        floating &&
        (!value || Object.keys(value).some((key) => key !== "top"))
      )
        throw Error("请在主程序调整悬浮窗口");
      return this.configure(value);
    }
    if (
      ["resizeStart", "resizeMove", "resizeEnd", "stripExpanded"].includes(
        action,
      )
    ) {
      if (!floating) throw Error("仅限悬浮看板");
      if (action !== "stripExpanded")
        return this.resizeWindow(action, value?.edge);
      if (
        this.settings.mode === "strip" &&
        typeof value?.expanded === "boolean" &&
        Boolean(this.stripExpanded) !== value.expanded &&
        this.win
      ) {
        this.stripExpanded = value.expanded;
        this.win.setBounds(this.boundsForMode());
        this.remember();
      }
      return;
    }
    if (action === "openResource") return this.openOriginal(value?.id, lease);
    if (action === "openSource") {
      let refs;
      try {
        refs = JSON.parse(value.id);
      } catch {
        throw Error("来源无效");
      }
      const view = await this.service.cloud.serial(() =>
        this.service.load(lease),
      );
      if (
        !view.snapshot.sourceTasks.some((s) => s.id === value.id) ||
        !Array.isArray(refs)
      )
        throw Error("来源不可用");
      const main = this.mainWindow();
      main.webContents.send("board-source", refs[0]);
      main.show();
      main.focus();
      return;
    }
    const result = await this.service.cloud.serial(async () => {
      if (action === "load") return this.service.load(lease);
      if (action === "save") return this.service.save(value, lease);
      if (action === "addFiles") return this.service.addFiles(value, lease);
      if (action === "resource")
        return this.service.resource(value?.id, lease, true);
      throw Error("不支持的看板操作");
    });
    if (["save", "addFiles"].includes(action)) this.broadcast();
    return result;
  }
  async start() {
    this.shortcutRegistered = this.globalShortcut.register(
      "CommandOrControl+Alt+B",
      () => {
        if (this.win?.isVisible()) this.win.hide();
        else void this.show();
      },
    );
    if (this.settings.restore) await this.show();
  }
}
module.exports = { BoardWindow, windowSettings };
