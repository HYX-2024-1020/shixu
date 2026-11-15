const fs = require("node:fs");
const path = require("node:path");
const defaults = () => ({
  mode: "rail",
  locked: false,
  top: true,
  density: "compact",
  opacity: 1,
  restore: false,
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
    s.opacity > 1
  )
    throw Error("窗口设置无效");
  if (
    !s.bounds ||
    !["x", "y", "width", "height"].every((k) => Number.isFinite(s.bounds[k])) ||
    s.bounds.width < 200 ||
    s.bounds.height < 30
  )
    s.bounds = defaults().bounds;
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
  }) {
    Object.assign(this, {
      BrowserWindow,
      screen,
      globalShortcut,
      root,
      quitting,
      mainWindow,
      service,
    });
    this.settings = defaults();
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
  apply() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(this.settings.top, "screen-saver");
    this.win.setMovable(!this.settings.locked);
    this.win.setResizable(
      !this.settings.locked && this.settings.mode !== "strip",
    );
    this.win.setMinimumSize(250, this.settings.mode === "strip" ? 40 : 240);
  }
  async show() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.showInactive();
      return;
    }
    const bounds = this.clamp(this.settings.bounds);
    this.win = new this.BrowserWindow({
      ...bounds,
      title: "拾序看板",
      minWidth: 250,
      minHeight: 40,
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
    let timer;
    const remember = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!this.win || this.win.isDestroyed()) return;
        this.settings.bounds = this.win.getBounds();
        this.save();
      }, 200);
    };
    this.win.on("moved", remember);
    this.win.on("resized", remember);
    this.win.on("will-move", (e, b) => {
      if (this.settings.locked) return;
      const before = b.x;
      const area = this.screen.getDisplayMatching(b).workArea;
      if (Math.abs(b.x - area.x) < 16) b.x = area.x;
      if (Math.abs(b.x + b.width - area.x - area.width) < 16)
        b.x = area.x + area.width - b.width;
      if (b.x !== before) {
        e.preventDefault();
        this.win.setBounds(this.clamp(b));
      }
    });
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
  async action(action, value, lease) {
    if (lease !== this.service.lease())
      throw Error("账号已切换，请关闭并重新打开看板");
    if (action === "windowState")
      return {
        ...this.settings,
        shortcutAvailable: this.shortcutRegistered !== false,
      };
    if (action === "show") {
      await this.show();
      return this.settings;
    }
    if (action === "hide") {
      this.win?.hide();
      return;
    }
    if (action === "configureWindow") {
      if (
        !value ||
        Object.keys(value).some(
          (k) =>
            ![
              "mode",
              "locked",
              "top",
              "density",
              "opacity",
              "restore",
            ].includes(k),
        )
      )
        throw Error("窗口设置无效");
      const previous = this.settings.mode;
      this.settings = windowSettings({ ...this.settings, ...value });
      if (
        this.win &&
        !this.win.isDestroyed() &&
        previous !== this.settings.mode
      ) {
        const size =
          this.settings.mode === "strip"
            ? [258, 110]
            : this.settings.mode === "rail"
              ? [370, 660]
              : [680, 660];
        this.win.setResizable(true);
        this.win.setMinimumSize(250, 40);
        this.win.setBounds(
          this.clamp({
            ...this.win.getBounds(),
            width: size[0],
            height: size[1],
          }),
        );
      }
      this.apply();
      this.save();
      this.broadcast();
      return this.settings;
    }
    if (action === "stripHeight") {
      if (
        this.settings.mode === "strip" &&
        Number.isFinite(value?.height) &&
        value.height >= 30 &&
        value.height <= 1200 &&
        this.win
      ) {
        this.win.setSize(
          258,
          Math.min(
            Math.ceil(value.height),
            this.screen.getDisplayMatching(this.win.getBounds()).workArea
              .height,
          ),
          false,
        );
      }
      return;
    }
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
      if (action === "resource") return this.service.resource(value.id, lease);
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
