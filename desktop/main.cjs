const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  protocol,
  net,
  session,
  dialog,
  ipcMain,
  safeStorage,
  screen,
} = require("electron");
const fs = require("node:fs/promises");
const { DesktopStore } = require("./storage.cjs");
const { exportBackup, importBackup } = require("./backup.cjs");
const { readArchive } = require("./archive.cjs");
const { readOffice } = require("./office.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveAsset } = require("./paths.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "shixu",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
app.setName("拾序");
// Dedicated desktop profile. Existing browser test data is left in its browser.
app.setPath(
  "userData",
  process.env.SHIXU_DATA_DIR && path.isAbsolute(process.env.SHIXU_DATA_DIR)
    ? process.env.SHIXU_DATA_DIR
    : path.join(app.getPath("appData"), "ShixuDesktop"),
);
let mainWindow,
  tray,
  quitting = false;
const show = () => {
  mainWindow?.show();
  mainWindow?.focus();
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", show);
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    (async () => {
      try {
        await mainWindow?.webContents.executeJavaScript(
          "window.flushDesktopDraft?.()",
        );
      } catch (e) {
        dialog.showErrorBox("退出前保存失败", e.message);
        return;
      }
      quitting = true;
      app.quit();
    })();
  });
  app
    .whenReady()
    .then(async () => {
      const store = new DesktopStore(
        path.join(app.getPath("userData"), "workspace"),
      );
      await store.cleanup();
      const cleanupTimer = setInterval(
        () => store.cleanup().catch(() => {}),
        60 * 60 * 1000,
      );
      cleanupTimer.unref();
      const validSender = (event) => {
        if (
          event.senderFrame !== mainWindow?.webContents.mainFrame ||
          !event.senderFrame.url.startsWith("shixu://app/")
        )
          throw new Error("来源无效");
      };
      ipcMain.handle("store", async (event, method, value) => {
        validSender(event);
        return method === "cleanup"
          ? store.cleanup()
          : store.call(method, value);
      });
      ipcMain.handle("archive", async (event, bytes, extension) => {
        validSender(event);
        return readArchive(bytes, extension, store.file("cache/archives"));
      });
      ipcMain.handle("office", async (event, bytes, extension) => {
        validSender(event);
        return readOffice(bytes, extension);
      });
      const keyFile = path.join(app.getPath("userData"), "api-key.enc");
      ipcMain.handle("key", async (event, action, value) => {
        validSender(event);
        if (action === "remove") return fs.rm(keyFile, { force: true });
        if (action === "read") {
          try {
            return (
              await safeStorage.decryptStringAsync(await fs.readFile(keyFile))
            ).result;
          } catch (e) {
            if (e.code === "ENOENT") return "";
            throw new Error("系统无法解密密钥，请重新填写");
          }
        }
        if (
          action !== "save" ||
          typeof value !== "string" ||
          value.length > 1024
        )
          throw new Error("密钥无效");
        const encrypted = await safeStorage.encryptStringAsync(value);
        await fs.writeFile(keyFile + ".next", encrypted);
        await fs.rename(keyFile + ".next", keyFile);
      });
      ipcMain.handle("backup", async (event, action) => {
        validSender(event);
        if (action === "export") {
          const result = await dialog.showSaveDialog(mainWindow, {
            title: "备份拾序资料",
            defaultPath: "拾序备份.zip",
            filters: [{ name: "拾序备份", extensions: ["zip"] }],
          });
          return result.canceled
            ? "已取消备份"
            : exportBackup(store, result.filePath);
        }
        if (action !== "import") throw new Error("操作无效");
        const result = await dialog.showOpenDialog(mainWindow, {
          title: "恢复拾序备份（已有记录优先保留）",
          properties: ["openFile"],
          filters: [{ name: "拾序备份", extensions: ["zip"] }],
        });
        return result.canceled
          ? "已取消恢复"
          : importBackup(store, result.filePaths[0]);
      });
      protocol.handle("shixu", (request) => {
        const file = resolveAsset(path.join(__dirname, "../dist"), request.url);
        return file
          ? net.fetch(pathToFileURL(file).href)
          : new Response("Not found", { status: 404 });
      });
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      const workArea = screen.getPrimaryDisplay().workAreaSize;
      if (process.platform === "win32")
        app.setAppUserModelId("cn.shixu.desktop");
      mainWindow = new BrowserWindow({
        title: "拾序",
        width: Math.min(1180, workArea.width),
        height: Math.min(820, workArea.height),
        minWidth: Math.min(720, workArea.width),
        minHeight: Math.min(560, workArea.height),
        backgroundColor: "#faf8f4",
        show: false,
        icon: path.join(__dirname, "../public/desktop-icon.png"),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(__dirname, "preload.cjs"),
          backgroundThrottling: false,
        },
      });
      Menu.setApplicationMenu(null);
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      mainWindow.webContents.on("will-navigate", (event, url) => {
        const target = new URL(url);
        if (target.protocol !== "shixu:" || target.hostname !== "app")
          event.preventDefault();
      });
      mainWindow.on("close", (event) => {
        if (!quitting && tray) {
          event.preventDefault();
          mainWindow.hide();
        }
      });
      mainWindow.once("ready-to-show", show);
      // Keep a strong reference: the tray must survive while the window is hidden.
      try {
        tray = new Tray(
          nativeImage.createFromPath(
            path.join(__dirname, "../public/desktop-icon.png"),
          ),
        );
        tray.setToolTip("拾序 · 关闭窗口后仍在整理");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "打开拾序", click: show },
            { type: "separator" },
            { label: "退出拾序", click: () => app.quit() },
          ]),
        );
        tray.on("double-click", show);
      } catch (error) {
        dialog.showErrorBox(
          "托盘暂不可用",
          "关闭窗口将退出拾序。" + error.message,
        );
      }
      await mainWindow.loadURL("shixu://app/");
    })
    .catch((error) => {
      dialog.showErrorBox("拾序启动失败", error.message);
      app.quit();
    });
}
