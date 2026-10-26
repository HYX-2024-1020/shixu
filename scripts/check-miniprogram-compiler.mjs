import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = process.env.WECHAT_COMPILER_DIR;
if (!directory)
  throw new Error(
    "Set WECHAT_COMPILER_DIR to the installed official wcc-exec directory. This check does not enable IDE security settings.",
  );
const temporary = mkdtempSync(join(tmpdir(), "shixu-wxml-check-")),
  mini = join(root, "miniprogram");
const exe = process.platform === "win32" ? ".exe" : "";
execFileSync(
  join(directory, "wcc" + exe),
  ["-o", join(temporary, "page.js"), "pages/index/index.wxml"],
  { cwd: mini, stdio: "pipe" },
);
execFileSync(
  join(directory, "wcsc" + exe),
  [
    "-o",
    join(temporary, "style.js"),
    "app.wxss",
    "lib/generated/client-ui.wxss",
    "pages/index/card-visuals.wxss",
    "pages/index/index.wxss",
  ],
  { cwd: mini, stdio: "pipe" },
);
let definition;
const store = new Map(),
  pageFile = join(mini, "pages/index/index.js");
vm.runInNewContext(readFileSync(pageFile, "utf8"), {
  Page: (value) => (definition = value),
  require: createRequire(pageFile),
  getApp: () => ({ globalData: { updateReady: false } }),
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  wx: {
    getStorageSync: (key) => store.get(key),
    setStorageSync: (key, value) => store.set(key, structuredClone(value)),
    onNetworkStatusChange() {},
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    showModal: (o) => o.success({ confirm: true, content: "编译器验收事项" }),
  },
});
const page = {
  ...definition,
  data: structuredClone(definition.data),
  setData(value) {
    Object.assign(this.data, value);
  },
};
page.onLoad();
page.onDraft({ detail: { value: "合成编译器测试：明天提交报告" } });
page.submit();
page.createManual({
  currentTarget: { dataset: { id: page.data.currentCaptureId } },
});
const context = { window: {}, console };
vm.runInNewContext(readFileSync(join(temporary, "page.js"), "utf8"), context);
const render = context.$gwx("pages/index/index.wxml");
assert.equal(typeof render, "function");
const nodes = (tree) =>
  typeof tree === "string"
    ? []
    : [tree, ...(tree.children || []).flatMap(nodes)];
function view() {
  const tree = render(page.data, {}, {});
  assert.ok(tree);
  return nodes(tree);
}
page.setData({ tab: "world" });
assert.ok(
  view().some((node) => node.attr?.class?.includes("item-card")),
  "item template rendered",
);
assert.ok(
  view().some(
    (node) =>
      node.attr?.bindtap === "selectCategory" &&
      node.attr["data-kind"] === "task",
  ),
  "counted category rendered with stable key",
);
assert.ok(
  !view().some((node) => node.attr?.bindchange === "setSort"),
  "advanced filters collapsed initially",
);
page.toggleFilters();
assert.ok(
  view().some((node) => node.attr?.bindchange === "setSort"),
  "sort picker rendered on demand",
);
const row = page.data.items[0];
assert.ok(
  view().some(
    (node) =>
      node.attr?.bindtap === "openItem" && node.attr["data-id"] === row.id,
  ),
  "template data/event IDs preserved",
);
page.openItem({ currentTarget: { dataset: { id: row.id } } });
assert.ok(
  view().some((node) => node.attr?.bindtap === "beginEdit"),
  "detail actions rendered",
);
page.beginEdit();
assert.ok(
  view().some((node) => node.attr?.bindtap === "saveEdit"),
  "edit form rendered",
);
page.closeItem();
page.openAiSettings();
assert.ok(
  view().some((node) => node.attr?.bindtap === "toggleAiGuide"),
  "AI setup guide rendered",
);
assert.ok(
  view().some((node) => node.attr?.bindtap === "closeSettings"),
  "explicit return control rendered",
);
page.switchTab({ currentTarget: { dataset: { tab: "settings" } } });
assert.equal(
  page.data.tab,
  "world",
  "second settings tap returns to originating world",
);
page.switchTab({ currentTarget: { dataset: { tab: "ddl" } } });
page.setData({ ddlTitle: "DDL 编译验收", ddlDate: "明天下午三点" });
page.addDdl();
assert.ok(
  view().some((node) => node.attr?.class?.includes("ddl-item")),
  "DDL compiled cards render",
);
assert.ok(
  view().some((node) => node.attr?.bindtap === "verifyDdl"),
  "DDL verification action compiled",
);
const ddlRow = page.data.ddlSections.flatMap((section) => section.rows)[0];
page.setData({ checkingId: ddlRow.id });
const checkingNodes = view();
assert.ok(
  checkingNodes.some(
    (node) =>
      node.attr?.size === "mini" && node.attr?.class?.includes("done-button"),
  ),
  "native completion button explicitly uses mini sizing",
);
assert.ok(
  checkingNodes.some((node) => node.attr?.class === "check-short"),
  "short check stroke renders while checking",
);
assert.ok(
  checkingNodes.some((node) => node.attr?.class === "check-long"),
  "long check stroke renders while checking",
);
page.setData({ checkingId: "" });
await page.toggleDone({ currentTarget: { dataset: { id: ddlRow.id } } });
page.setData({ ddlShowDone: true });
assert.ok(
  view().some(
    (node) =>
      node.attr?.class?.includes("done-button checked") &&
      node.attr?.size === "mini",
  ),
  "completed DDL retains compact native control and strokes",
);
page.switchTab({ currentTarget: { dataset: { tab: "capture" } } });
page.interactSkin();
assert.ok(
  view().some(
    (node) =>
      node.attr?.class?.includes("skin-mascot") &&
      node.attr["data-motion"] === page.data.activeSkin.motion,
  ),
  "native mascot receives the shared active motion",
);
page._stopSkinInteraction();
assert.ok(
  view().some(
    (node) =>
      node.attr?.class?.includes("skin-mascot") &&
      node.attr["data-motion"] === "idle",
  ),
  "native mascot resets to idle",
);
page.openSkins();
assert.equal(
  view().filter((node) => node.attr?.bindtap === "previewSkin").length,
  8,
  "all desktop presets rendered",
);
console.log(
  "Official WXML/WXSS compilation and compiled template rendering passed (world, detail, edit, 8 skins). Not an IDE or real-device test.",
);
console.log(`Compiler output: ${resolve(temporary)}`);
