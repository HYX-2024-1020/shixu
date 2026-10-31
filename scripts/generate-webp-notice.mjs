// Synthetic quality fixture only. No account profile, API key or personal text.
import { Resvg } from "@resvg/resvg-js";
import { mkdir,writeFile,readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve,join } from "node:path";
import { sha256 } from "../server/reading/material.mjs";
const root=new URL("../",import.meta.url),out=resolve("../outputs/webp-notice-20261031");
await mkdir(out,{recursive:true});
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/>
<g fill="black" font-family="Microsoft YaHei" font-size="32"><text x="40" y="70">WebP开发验证：合成通知</text>
<text x="40" y="150">请提交图像实验报告，任务编号9537。</text><text x="40" y="230">截止：2026年11月3日16:45。</text>
<text x="40" y="310">格式：PDF，命名：学号_姓名。</text><text x="40" y="390">要求：说明算法思路与时间复杂度。</text>
<text x="40" y="530">尾部核对：9537，禁止遗漏此编号。</text></g></svg>`;
const png=join(out,"notice.png");await writeFile(png,new Resvg(svg).render().asPng());
const {fileURLToPath}=await import("node:url");
const target=fileURLToPath(new URL("server/reading/fixtures/webp-notice.webp",root));
execFileSync("python",["-c","from PIL import Image; import sys; Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2],lossless=True,method=6)",png,target],{windowsHide:true});
console.log(JSON.stringify({synthetic:true,path:target,inputHash:sha256(await readFile(target))}));
