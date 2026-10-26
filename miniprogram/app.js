App({
  globalData: { version: "0.2.0", updateReady: false },
  onLaunch() {
    if (typeof wx.getUpdateManager !== "function") return;
    this.updateManager = wx.getUpdateManager();
    this.updateManager.onUpdateReady(() => {
      this.globalData.updateReady = true;
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current) current.setData({ updateReady: true });
    });
    this.updateManager.onUpdateFailed(() => {
      wx.showToast({ title: "更新下载失败，下次打开重试", icon: "none" });
    });
  },
});
