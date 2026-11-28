const { localSkinAsset } = require("../../lib/skin-images");

Component({
  properties: { position: { type: String, value: "left:0%;top:0%" } },
  data: { source: "" },
  lifetimes: {
    attached() {
      try {
        this.setData({ source: localSkinAsset(wx, "/assets/fox/atlas.bin", "fox-atlas.webp") });
      } catch {
        this.triggerEvent("error");
      }
    },
  },
  methods: {
    ready() {
      this.triggerEvent("ready");
    },
    failed() {
      this.triggerEvent("error");
    },
  },
});
