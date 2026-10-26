import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const outputs = new Map();
// These are the actual desktop rules, adapted only for native element names and units.
// Keep the supported subset explicit: no browser-only hover/media selectors in WXSS.
const motion = await readFile(
  path.join(root, "src/bucket/skin-motion.css"),
  "utf8",
);
const desktopStyle = await readFile(
  path.join(root, "src/bucket/desktop.css"),
  "utf8",
).then((css) => css.replace(/\/\*[\s\S]*?\*\//g, ""));
const sharedSelectors = new Map([
  [".result-card", ".item-card"],
  [".result-card.is-pinned", ".item-card.is-pinned"],
  [".result-card:nth-child(4n + 2)", ".item-card.shadow-1"],
  [".result-card:nth-child(4n + 4)", ".item-card.shadow-3"],
  [".result-card:nth-child(4n + 3)", ".item-card.shadow-2"],
  [".card-kind", ".item-card .kind-label"],
  [".card-open h2", ".item-card .item-title"],
  [".card-open p", ".item-card .item-summary"],
  [".card-bottom", ".item-card .card-foot"],
  [".card-source-link", ".item-card .card-source-link"],
  [".world-heading h1", ".world .world-title"],
  [".world-heading h1 span", ".world .hero-highlight"],
]);
// Exclude media blocks before selecting top-level rules; platform layout stays native.
let depth = 0,
  topLevel = "",
  blockStart = 0;
for (let i = 0; i < desktopStyle.length; i++) {
  if (desktopStyle[i] === "{") depth++;
  if (desktopStyle[i] === "}" && --depth === 0) {
    const block = desktopStyle.slice(blockStart, i + 1).trim();
    if (!block.startsWith("@")) topLevel += block + "\n";
    blockStart = i + 1;
  }
}
let visuals = "";
const seen = new Set();
for (const match of topLevel.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  for (const selector of match[1].split(",").map((s) => s.trim())) {
    if (sharedSelectors.has(selector)) {
      seen.add(selector);
      visuals += `.page ${sharedSelectors.get(selector)} {${match[2]}}\n`;
    }
  }
}
for (const selector of sharedSelectors.keys()) {
  if (!seen.has(selector))
    throw new Error(
      `Desktop selector missing: ${selector}; update the native UI mapping.`,
    );
}
// 1 CSS px maps to 2 rpx at the 375px phone design width.
// WeChat data-* values belong to event datasets, not reliable CSS attributes.
// Target native image classes directly; the desktop still uses data-motion.
const nativeMotion = motion
  .replace(
    /\.skin-mascot\[data-motion="(\w+)"\] \.skin-body/g,
    ".skin-body.skin-motion-$1",
  )
  .replace(
    '.skin-mascot:not([data-motion="idle"])',
    ".skin-mascot.skin-interacting",
  );
const palette = await readFile(
  path.join(root, "src/bucket/card-palette.css"),
  "utf8",
);
const nativeCSS = (nativeMotion + visuals + palette)
  .replace(/touch-action:\s*[^;]+;/g, "")
  .replace(/[ \t]+$/gm, "")
  .replace(/(-?[\d.]+)px\b/g, (_, n) => `${Number(n) * 2}rpx`);
outputs.set(
  "miniprogram/lib/generated/client-ui.wxss",
  Buffer.from(
    "/* Generated from Windows skin-motion.css and desktop.css. Run mini:build. */\n" +
      nativeCSS,
  ),
);
// Native WeChat animation commands derived from the same desktop keyframes.
const nativeSkinMotions = {};
for (const name of ["bounce", "wiggle", "spin", "float"]) {
  const body = motion.match(
    new RegExp(`@keyframes skin-${name} \\{([\\s\\S]*?)\\n\\}`, "m"),
  )?.[1];
  const duration =
    Number(
      motion.match(new RegExp(`animation: skin-${name} ([\\d.]+)s`))?.[1],
    ) * 1000;
  if (!body || !duration)
    throw new Error(`Missing native motion source: ${name}`);
  const frames = [];
  for (const frame of body.matchAll(
    /([\d%,\s]+|from|to)\s*\{\s*transform:\s*([^;]+);/g,
  )) {
    const commands = [...frame[2].matchAll(/(\w+)\(([^)]+)\)/g)].map((m) => [
      m[1],
      ...m[2].split(",").map((v) => parseFloat(v)),
    ]);
    for (const percent of frame[1].trim().split(","))
      frames.push({
        at:
          percent.trim() === "from"
            ? 0
            : percent.trim() === "to"
              ? 100
              : parseFloat(percent),
        commands,
      });
  }
  nativeSkinMotions[name] = {
    duration,
    frames: frames.sort((a, b) => a.at - b.at),
  };
}
const bundled = await build({
  stdin: {
    contents: `export const NATIVE_SKIN_MOTIONS = ${JSON.stringify(nativeSkinMotions)};
    export { categories, SKIN_INTERACTION } from './src/bucket/client-ui';
    export { BUILTIN_SKINS, ICE_VOICES, skinSound, SKIN_MOTIONS, MAX_CUSTOM_SKINS, parseSkinCollection, isSkinImage } from './src/bucket/skins';
    export { deadlineCountdown } from './src/bucket/deadline-countdown';
    export { itemDeadlineTime } from './shared/deadline-time.mjs';
    export { absoluteItem, absoluteText, deadlineLabel, setDeadline, parseDeadline, deadlineSections } from './shared/deadlines.mjs';
    export { compareItems, habitCheckin } from './src/bucket/management';
    export { cardCopy } from './src/bucket/card-copy';
    export { mergeCardOrder } from './src/bucket/card-order';
    export { buildGroups, itemRef } from './shared/relations.mjs';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "neutral",
  target: "es2018",
  define: { "Object.hasOwn": "Object.prototype.hasOwnProperty.call" },
  legalComments: "none",
  charset: "utf8",
});
outputs.set(
  "miniprogram/lib/generated/desktop.js",
  Buffer.from(
    "// Generated by npm run mini:build. Edit the desktop/shared source instead.\n" +
      bundled.outputFiles[0].text,
  ),
);
const ai = await build({
  stdin: {
    contents: `export { organizePacket, DEFAULT_MODEL } from './shared/bucket-engine.mjs'; export { chatWithItem } from './src/bucket/item-chat';`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node24",
  charset: "utf8",
  legalComments: "none",
});
outputs.set(
  "server/generated/ai-core.mjs",
  Buffer.from(
    "// Generated from the same desktop organizer/chat code.\n" +
      ai.outputFiles[0].text,
  ),
);
outputs.set(
  "desktop/generated/sync-client.cjs",
  await readFile(path.join(root, "miniprogram/lib/sync-client.js")),
);
// Artwork and single-utterance audio are copied byte-for-byte from desktop assets.
for (const name of ["ice.png", "ice-voice-1.mp3", "ice-voice-2.mp3"])
  outputs.set(
    `miniprogram/assets/${name}`,
    await readFile(path.join(root, "public", name)),
  );
outputs.set(
  "miniprogram/assets/mascot.png",
  await readFile(path.join(root, "public/mascot.png")),
);
outputs.set(
  "miniprogram/assets/laugh.mp3",
  await readFile(path.join(root, "public/laugh.mp3")),
);
const hashes = Object.fromEntries(
  [...outputs].map(([name, bytes]) => [
    name,
    createHash("sha256").update(bytes).digest("hex"),
  ]),
);
outputs.set(
  "miniprogram/lib/generated/manifest.json",
  Buffer.from(
    JSON.stringify({ source: "desktop/shared", files: hashes }, null, 2) + "\n",
  ),
);
let stale = false;
for (const [name, bytes] of outputs) {
  const target = path.join(root, name);
  if (check) {
    const current = await readFile(target).catch(() => null);
    if (!current?.equals(bytes)) {
      console.error(`Outdated: ${name}; run npm run mini:build`);
      stale = true;
    }
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
if (stale) process.exitCode = 1;
else
  console.log(
    `Mini shared code and desktop artwork ${check ? "verified" : "generated"} (${outputs.size} files).`,
  );
