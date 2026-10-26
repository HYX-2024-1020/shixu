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
  mini = process.env.WECHAT_PROJECT_DIR
    ? resolve(process.env.WECHAT_PROJECT_DIR)
    : join(root, "miniprogram");
const exe = process.platform === "win32" ? ".exe" : "";
execFileSync(
  join(directory, "wcc" + exe),
  [
    "-o",
    join(temporary, "page.js"),
    "pages/index/index.wxml",
    "lib/drag-gesture.wxs",
  ],
  { cwd: mini, stdio: "pipe" },
);
execFileSync(
  join(directory, "wcsc" + exe),
  [
    "-o",
    join(temporary, "style.js"),
    "app.wxss",
    "lib/generated/client-ui.wxss",
    "pages/index/index.wxss",
    "pages/index/cards.wxss",
    "pages/index/card-visuals.wxss",
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
  setData(value, callback) {
    Object.assign(this.data, value);
    callback?.();
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
  view().some((node) => node.attr?.class?.includes("xc-card")),
  "item template rendered",
);
assert.ok(
  view().some((node) => node.attr?.bindchange === "chooseScope"),
  "native scope picker rendered",
);
assert.ok(
  !view().some((node) =>
    /scope-tabs|category-nav|group-strip/.test(node.attr?.class || ""),
  ),
  "no persistent scope/category button strips",
);
assert.ok(
  !readFileSync(join(mini, "lib/generated/client-ui.wxss"), "utf8").includes(
    "[data-motion=",
  ),
  "native motion must not depend on dataset CSS attributes",
);
assert.ok(
  !view().some((node) => node.attr?.bindchange === "setSort"),
  "advanced filters collapsed initially",
);
assert.ok(
  view().some((node) => node.attr?.class === "world-grid"),
  "native single-column list container exists",
);
assert.ok(
  view().some(
    (n) =>
      n.attr?.class?.includes("xc-card") &&
      n.attr?.class?.includes("kind-task"),
  ),
  "native card carries its semantic palette",
);
assert.ok(
  view().some((n) => n.attr?.["data-action"] === "openItem"),
  "detail is available before expanding",
);
page.toggleCard({ currentTarget: { dataset: { id: page.data.items[0].id } } });
assert.ok(
  view().some(
    (node) =>
      node.attr?.bindlongpress === "startDrag" &&
      typeof node.attr?.["$wxs:bindtouchmove"] === "function",
  ),
  "long press and tracked movement compiled",
);
assert.ok(
  view().some(
    (node) =>
      node.attr?.["data-action"] === "confirmRemoveItem" &&
      node.attr?.bindtap === "onCardAction",
  ),
  "discoverable deletion keeps an independent tap route",
);
const compactId = page.data.items[0].id;
const compactNode = view().find((n) => n.attr?.class?.includes("xc-card"));
assert.equal(compactNode.attr.bindtap, undefined);
assert.equal(compactNode.attr.bindlongpress, "startDrag");
assert.equal(
  compactNode.attr.bindtouchstart,
  "dragTouchStart",
  "whole card arms a hold candidate without intercepting taps",
);
for (const node of view().filter((n) => n.attr?.bindtap === "onCardAction")) {
  assert.equal(node.attr.catchtouchend, undefined);
  assert.equal(node.attr.catchtouchstart, undefined);
  assert.equal(node.attr.catchlongpress, undefined);
}
assert.ok(!view().some((n) => n.attr?.["data-direction"]));
const starNode = view().find((n) => n.attr?.["data-action"] === "toggleStar");
assert.equal(starNode.attr["data-id"], compactId);
page[starNode.attr.bindtap]({
  currentTarget: {
    dataset: { id: compactId, action: starNode.attr["data-action"] },
  },
});
assert.equal(page._detail(compactId).starred, true);
assert.equal(page.data.selected, null);
const materialRow = page._detail(compactId);
page._client.put(materialRow.packetId, {
  attachments: [
    {
      id: "synthetic-file",
      name: "合成.pdf",
      size: 3,
      type: "application/pdf",
    },
  ],
});
page._refresh();
assert.ok(
  view().some(
    (n) =>
      n.attr?.class === "card-file" && JSON.stringify(n).includes("合成.pdf"),
  ),
  "attachment filenames remain on the card surface",
);
assert.ok(view().some((n) => n.attr?.["data-action"] === "openMaterials"));
page.openMaterials({ currentTarget: { dataset: { id: compactId } } });
assert.equal(page.data.detailAnchor, "detail-materials");
assert.ok(view().some((n) => n.attr?.id === "detail-materials"));
assert.ok(
  view().some(
    (n) =>
      n.attr?.bindtap === "openAttachment" &&
      n.attr["data-id"] === "synthetic-file" &&
      n.attr["data-packet"] === materialRow.packetId,
  ),
);
page.setData({ error: "合成附件打开失败" });
assert.ok(
  view().some(
    (n) =>
      n.attr?.class === "error" &&
      JSON.stringify(n).includes("合成附件打开失败"),
  ),
);
page.closeItem();
page.setData({
  dragId: compactId,
  dragGhost: { left: 20, top: 40, width: 180, title: "合成拖动" },
});
assert.ok(
  view().some((node) => node.attr?.class?.includes("drag-placeholder")),
  "drag placeholder compiled",
);
assert.ok(
  view().some((node) => node.attr?.class?.split(/\s+/).includes("drag-ghost")),
  "drag preview compiled",
);
page.setData({ dragId: "", dragGhost: null });
page.toggleFilters();
assert.ok(
  view().some((node) => node.attr?.bindchange === "setSort"),
  "sort picker rendered on demand",
);
const row = page.data.items[0];
assert.ok(
  view().some(
    (node) =>
      node.attr?.["data-action"] === "openItem" &&
      node.attr["data-id"] === row.id,
  ),
  "template data/event IDs preserved",
);
page.openItem({ currentTarget: { dataset: { id: row.id } } });
assert.ok(
  view().some((node) => node.attr?.bindtap === "beginEdit"),
  "detail actions rendered",
);
assert.ok(
  view().some(
    (node) =>
      node.attr?.class?.includes("detail-close") &&
      node.attr?.bindtap === "closeItem",
  ),
  "right-aligned detail close control compiled",
);
assert.ok(
  view().some((node) => node.attr?.class?.includes("detail-actions")),
  "wrapping detail actions compiled",
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
  view().some((node) => node.attr?.["data-action"] === "verifyDdl"),
  "DDL verification action compiled",
);
const ddlRow = page.data.ddlSections.flatMap((section) => section.rows)[0];
page.setData({ tab: "world", expandedCardId: ddlRow.id });
const worldNodes = view();
assert.ok(
  worldNodes.some((node) => node.attr?.class?.includes("xc-title")),
  "native world renders the unified card text block",
);
assert.ok(
  worldNodes.some(
    (node) =>
      node.attr?.class?.includes("xc-due") &&
      JSON.stringify(node).includes(ddlRow.date.slice(5)),
  ),
  "deadline stays in its dedicated metadata strip",
);
assert.ok(
  worldNodes.some(
    (node) =>
      node.attr?.class?.includes("xc-detail") &&
      node.attr["data-action"] === "openItem" &&
      node.attr["data-id"],
  ),
  "compact detail control retains the accessible original/material entry",
);
page.setData({ tab: "ddl" });

const countdownNode = view().find((node) =>
  node.attr?.class?.includes("ddl-countdown"),
);
assert.ok(
  countdownNode?.attr.class.includes(`cd-${ddlRow.countdownStatus}`),
  "compiled countdown state class matches the DDL row",
);
assert.ok(
  JSON.stringify(countdownNode).includes(ddlRow.countdown),
  "compiled countdown text matches the shared calendar result",
);
assert.equal(
  view().filter((node) => node.attr?.class === "nav-icon").length,
  3,
  "all dock icons compile",
);
const activeSkin = page.data.activeSkin;
page.setData({ activeSkin: { ...activeSkin, image: "/assets/ice.png" } });
assert.ok(
  view().some((node) => node.attr?.src === "/assets/ice.png"),
  "DDL header follows the selected skin",
);
page.setData({ activeSkin });
const verify = view().find((node) => node.attr?.class === "ddl-verify-button");
assert.ok(
  verify && verify.attr["data-action"] === "verifyDdl",
  "explicit native time verification button exists",
);
page.verifyDdl({ currentTarget: { dataset: { id: ddlRow.id } } });
assert.equal(
  page.data.editing,
  true,
  "verification directly opens time editing",
);
assert.equal(page.data.selected.id, ddlRow.id);
page.closeItem();
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
  view().some((node) =>
    node.attr?.class?.includes("skin-motion-" + page.data.activeSkin.motion),
  ),
  "native mascot receives the shared active motion",
);
page._stopSkinInteraction();
assert.ok(
  view().some((node) => node.attr?.class?.includes("skin-motion-idle")),
  "native mascot resets to idle",
);
page.openSkins();
assert.equal(
  view().filter((node) => node.attr?.bindtap === "previewSkin").length,
  2,
  "all desktop presets rendered",
);
page.previewSkin({ currentTarget: { dataset: { id: "ice" } } });
assert.equal(
  view().filter((node) => node.attr?.bindtap === "changeIceVoice").length,
  2,
  "both voice controls render for ice",
);
page.changeIceVoice({ currentTarget: { dataset: { voice: "voice-2" } } });
assert.ok(
  view().some(
    (node) =>
      node.attr?.["data-voice"] === "voice-2" &&
      node.attr?.class?.includes("voice-selected"),
  ),
  "selected voice is visible in the compiled native template",
);
console.log(
  "Official WXML/WXSS compilation and compiled template rendering passed (world, detail, edit, 2 presets). Not an IDE or real-device test.",
);
console.log(`Compiled source project: ${mini}`);
console.log(`Compiler output: ${resolve(temporary)}`);
