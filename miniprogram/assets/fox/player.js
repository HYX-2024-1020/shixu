Component({
  properties: { position: { type: String, value: "left:0%;top:0%" } },
  methods: {
    ready() {
      this.triggerEvent("ready");
    },
    failed() {
      this.triggerEvent("error");
    },
  },
});
