// Explicit user request: generate twenty fictional deliveries through the real UI/API.
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { zipSync, strToU8 } from "fflate";
const require = createRequire(import.meta.url);
const { DesktopStore } = require("../desktop/storage.cjs");
const { exportBackup } = require("../desktop/backup.cjs");
const batch = new Date().toISOString().replace(/[:.]/g, "-");
const root = path.resolve(".private", "demo20-" + batch),
  profile = path.join(root, "profile"),
  materials = path.join(root, "materials");
await mkdir(profile, { recursive: true });
await mkdir(materials, { recursive: true });
const realProfile = path.join(process.env.APPDATA, "ShixuDesktop");
await copyFile(
  path.join(realProfile, "Local State"),
  path.join(profile, "Local State"),
);
await copyFile(
  path.join(realProfile, "api-key.enc"),
  path.join(profile, "api-key.enc"),
);
const scenarios = [
  [
    "数据结构作业",
    "提交链表实验报告，附上测试结果与复杂度分析，PDF格式。",
    "2026-10-26 23:59",
  ],
  [
    "项目例会",
    "产品小组在会议室A讨论新版原型，带上两个交互方案。",
    "2026-10-27 14:30",
  ],
  [
    "摄影出游",
    "周末去青禾公园拍秋叶，集合地点为东门，带相机和水。",
    "2026-10-25 09:00",
  ],
  ["阅读习惯", "希望每天读书20分钟，每天手动记录一次，不设置截止日期。", ""],
  [
    "毕业设计",
    "完成开题PPT初稿，10页以内，技术路线单独一页。",
    "2026-10-30 18:00",
  ],
  [
    "生活灵感",
    "想到做一个宿舍共享冰箱贴，用颜色区分食物归属；只是灵感，还不安排开工。",
    "",
  ],
  [
    "朋友生日",
    "参加虚构朋友小林的生日聚餐，地点为青禾小馆二楼。",
    "2026-10-28 19:00",
  ],
  [
    "图书馆通知",
    "图书馆北区因设备检修临时闭馆一天，不要求回复。",
    "2026-10-29",
  ],
  ["英语学习", "每天跟读10分钟，记录当天是否练习，不自动打卡。", ""],
  [
    "旅行准备",
    "预订秋游车票，核对出发时间，并准备雨衣。此为虚构旅行计划，不实际订票。",
    "2026-11-02 12:00",
  ],
  [
    "读书笔记",
    "摘录：把大任务拆成一个能在15分钟内开始的小动作。只保存笔记，不自动创建行动。",
    "",
  ],
  [
    "社团海报",
    "设计读书分享会海报，A3竖版，须含主题、地点和报名二维码占位。",
    "2026-10-31 20:00",
  ],
  [
    "菜谱购物",
    "周末做番茄炖牛腩：牛腩500克、番茄3个、土豆2个，先检查家里调料。",
    "2026-10-24 17:00",
  ],
  [
    "家居维修",
    "联系物业检查书桌旁松动的插座；只记录事项，不自行拆修或触碰电线。",
    "2026-10-25",
  ],
  [
    "电影放映",
    "校园影社举行《星际漫游》虚构电影放映，教室B204，自愿参加。",
    "2026-10-30 19:30",
  ],
  [
    "编程练习",
    "阅读包内README，实现一个CSV统计脚本；代码仅作为材料，不执行。",
    "2026-10-28 22:00",
  ],
  [
    "科研进度",
    "整理3篇论文的研究问题、方法、局限，用一页对照表发给导师。",
    "2026-11-03 16:00",
  ],
  [
    "快递取件",
    "去校园西门服务站取一个虚构包裹，取件码为演示-0420，不含真实个人信息。",
    "2026-10-24 20:00",
  ],
  [
    "日期待确认",
    "老师说下次课提交实验小结，具体日期没有公布，下午三点或四点也还没定。请保留待确认。",
    "",
  ],
  [
    "周末家务",
    "整理书架、给绿植浇水、把不再使用的纸箱收好。不需要强行安排具体时刻。",
    "2026-10-25",
  ],
];
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
let seed = Date.now() >>> 0;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
function picture(title, content, number) {
  const lines = content.match(/.{1,27}/gu) || [];
  const colors = ["#ffd43b", "#b8a5ff", "#f783ac", "#a7d8c3"];
  return new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#fff9e6"/><rect x="50" y="50" width="1100" height="700" rx="8" fill="white" stroke="#111" stroke-width="6"/><rect x="85" y="85" width="1030" height="110" fill="${colors[number % colors.length]}" stroke="#111" stroke-width="4"/><text x="112" y="157" font-size="43" font-weight="900" font-family="Noto Sans SC">${escape(title)}</text>${lines.map((line, i) => `<text x="100" y="${270 + i * 65}" font-size="32" font-family="Noto Sans SC">${escape(line)}</text>`).join("")}<text x="100" y="710" font-size="23" fill="#666" font-family="Noto Sans SC">虚构演示材料 · 不代表真实安排</text></svg>`,
    {
      font: {
        fontFiles: [path.resolve("public/fonts/NotoSansSC.ttf")],
        loadSystemFonts: false,
      },
    },
  )
    .render()
    .asPng();
}
function pdf(jpeg) {
  const content = "q 1200 0 0 800 0 0 cm /Im0 Do Q";
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
    ),
    Buffer.from(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")],
    offsets = [];
  let length = chunks[0].length;
  for (const [i, obj] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      obj,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}
const manifest = {
  batch,
  profile,
  materials,
  createdAt: new Date().toISOString(),
  scenarios: [],
  packetIds: [],
  backup: "",
  state: "generating",
};
const manifestPath = path.resolve("release/demo20-manifest.json");
const checkpoint = () =>
  writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.join(
    process.env.LOCALAPPDATA,
    "Programs/shixu/拾序.exe",
  ),
  env,
  args: [],
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const input = page.getByRole("textbox", {
    name: "往桶里放入内容",
    exact: true,
  });
  await input.waitFor();
  for (let i = 0; i < scenarios.length; i++) {
    const [name, detail, date] = scenarios[i],
      marker = `演示${String(i + 1).padStart(2, "0")}`;
    const text = `【${marker}·${name}】\n${detail}${date ? "\n时间：" + date : ""}\n以上均为虚构的界面演示，请据原文整理，不实际执行任何事项。`;
    const types = ["png", "docx", "pdf", "md", "csv", "zip", "none"];
    const type =
      i < 3
        ? ["png", "docx", "pdf"][i]
        : types[Math.floor(random() * types.length)];
    const files = [];
    if (type !== "none") {
      const file = path.join(materials, `[${marker}]${name}.${type}`);
      let bytes;
      if (type === "png" || type === "pdf") {
        const png = picture(
          `【${marker}】${name}`,
          detail + (date ? " 时间：" + date : ""),
          i,
        );
        if (type === "png") bytes = png;
        else {
          const jpeg = Buffer.from(
            await app.evaluate(
              ({ nativeImage }, data) =>
                Array.from(
                  nativeImage.createFromBuffer(Buffer.from(data)).toJPEG(92),
                ),
              Array.from(png),
            ),
          );
          bytes = pdf(jpeg);
        }
      } else if (type === "docx")
        bytes = zipSync({
          "[Content_Types].xml": strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          ),
          "_rels/.rels": strToU8(
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
          ),
          "word/document.xml": strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
              text
                .split("\n")
                .map(
                  (t) => "<w:p><w:r><w:t>" + escape(t) + "</w:t></w:r></w:p>",
                )
                .join("") +
              "</w:body></w:document>",
          ),
        });
      else if (type === "zip")
        bytes = zipSync({
          "README.md": strToU8(text),
          "示例代码.py": strToU8(
            "# 演示资料，只读不执行\n# 读取CSV并统计每列非空值的数量\n",
          ),
        });
      else
        bytes = Buffer.from(
          type === "csv"
            ? `类型,内容\n场景,${name}\n要求,${detail}\n时间,${date}\n备注,虚构演示材料\n`
            : text,
        );
      await writeFile(file, bytes);
      files.push(file);
      if (i === 6 || i === 12) {
        const extra = path.join(materials, `[${marker}]补充说明.txt`);
        await writeFile(extra, text);
        files.push(extra);
      }
    }
    const fileOnly = (i === 1 || i === 2 || i === 19) && files.length > 0;
    await input.fill(fileOnly ? "" : text);
    await page.locator("input[type=file]").setInputFiles(files);
    await page.getByRole("button", { name: "丢进去", exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await window.desktop.store("packets")).length,
          ),
        { timeout: 30000 },
      )
      .toBe(i + 1);
    manifest.scenarios.push({ number: i + 1, name, type, fileOnly, files });
    manifest.packetIds = await page.evaluate(async () =>
      (await window.desktop.store("packets")).map((p) => p.id),
    );
    await checkpoint();
    console.log(
      `Submitted ${i + 1}/20: ${name} (${type}${fileOnly ? ", file only" : ""})`,
    );
  }
  manifest.state = "organizing";
  await checkpoint();
  let previous = "";
  for (let attempt = 0; attempt < 1200; attempt++) {
    const status = await page.evaluate(async () =>
      (await window.desktop.store("packets")).map((p) => ({
        id: p.id,
        status: p.status,
        association: p.association?.state,
        error: p.error,
      })),
    );
    const ready = status.filter(
        (p) => p.status === "ready" && p.association !== "pending",
      ).length,
      failed = status.filter((p) => p.status === "error").length;
    const message = `Organized ${ready}/20; failed ${failed}`;
    if (message !== previous) {
      console.log(message);
      previous = message;
    }
    manifest.status = status;
    await checkpoint();
    if (ready + failed === 20) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const packets = await page.evaluate(() => window.desktop.store("packets"));
  for (const p of packets) {
    if (p.status !== "ready")
      throw Error("A demonstration did not finish: " + p.error);
    p.result.items = p.result.items.map((item) => ({
      ...item,
      title: /^\[演示/.test(item.title) ? item.title : "[演示] " + item.title,
    }));
  }
  await page.evaluate(async () => {
    const records = await window.desktop.store("packets");
    for (const record of records) record.result.items = record.result.items.map(item => ({...item,title:item.title.startsWith("[演示]") ? item.title : "[演示] " + item.title}));
    await window.desktop.store("savePackets", records);
  });
  await app.close();
  const store = new DesktopStore(path.join(profile, "workspace"));
  manifest.backup = path.resolve("release", `拾序-20场景演示-${batch}.zip`);
  await exportBackup(store, manifest.backup);
  manifest.itemCount = packets.reduce(
    (sum, p) => sum + p.result.items.length,
    0,
  );
  manifest.attachmentCount = packets.reduce(
    (sum, p) => sum + p.attachments.length,
    0,
  );
  manifest.state = "ready-to-import";
  await checkpoint();
  console.log(
    JSON.stringify({
      backup: manifest.backup,
      deliveries: packets.length,
      items: manifest.itemCount,
      attachments: manifest.attachmentCount,
    }),
  );
} catch (error) {
  manifest.state = "needs-attention";
  manifest.error = error.message;
  await checkpoint();
  throw error;
} finally {
  await app.close().catch(() => {});
  await rm(path.join(profile, "api-key.enc"), { force: true });
  await rm(path.join(profile, "Local State"), { force: true });
}
