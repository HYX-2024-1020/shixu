import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (b, algorithm = "sha256") =>
  createHash(algorithm)
    .update(b)
    .digest(algorithm === "sha512" ? "base64" : "hex");
const packages = {
  canvas: [
    "canvas",
    "b87ugZpQ5ViwqVBkjervxpwa0GmJPsKHLBNoZN6GpjWeHzTbDUGryriq+2DYW2XbB+xCqSIINQysC0/I87nPbw==",
  ],
  "win32-x64": [
    "canvas-win32-x64-msvc",
    "DUlW3lZPz63kYsf8mxgyyZuevhlH0T3/BGP9l+NazhB0F1+gL6D4hqZdnhZpw24DlWmTpATDcyYSZlJOi+DdfQ==",
  ],
  "linux-x64": [
    "canvas-linux-x64-gnu",
    "lc48IwknVHBsNzXn9Xs5OkUsRX38Ml3Z1aOybQ51mMEzZckm8+4A0qROlyYHEoBPzr1kL3IU8ZUAqDb7wtdX8w==",
  ],
};
const change = (text, before, after) => {
  if (text.split(before).length !== 2)
    throw Error("PDF_VISUAL_PATCH_REVIEW_REQUIRED");
  return text.replace(before, after);
};
function compat(source) {
  source = source.replace(
    /([\w.]+)\.toHex\(\)/g,
    "Array.from($1,b=>b.toString(16).padStart(2,'0')).join('')",
  );
  source = source.replace("map?.getOrInsertComputed(", "shixuOptionalMap(map,");
  source = source.replace(
    "(bCache ??= new Map()).getOrInsertComputed(",
    "shixuMap((bCache ??= new Map()),",
  );
  source = source.replace(/([\w.$#]+)\.getOrInsertComputed\(/g, "shixuMap($1,");
  source = source.replace(/([\w.$#]+)\.getOrInsert\(/g, "shixuMapValue($1,");
  if (/getOrInsertComputed|getOrInsert\(/.test(source))
    throw Error("PDF_VISUAL_COMPAT_REVIEW_REQUIRED");
  return (
    "function shixuMap(m,k,f){if(m.has(k))return m.get(k);const v=f(k);m.set(k,v);return v;}\nfunction shixuOptionalMap(m,k,f){return m==null?undefined:shixuMap(m,k,f);}\nfunction shixuMapValue(m,k,v){if(m.has(k))return m.get(k);m.set(k,v);return v;}\n" +
    source
  );
}
export async function buildPdfVisual(
  platform = process.platform + "-" + process.arch,
) {
  if (!packages[platform] || platform === "canvas")
    throw Error("PDF_VISUAL_PLATFORM_UNSUPPORTED");
  const pdf = JSON.parse(
    await readFile(join(root, "node_modules/pdfjs-dist/package.json")),
  );
  if (pdf.version !== "6.2.108")
    throw Error("PDF_VISUAL_UPGRADE_REVIEW_REQUIRED");
  const cache = join(
    tmpdir(),
    "shixu-pdf-visual-" + sha(root).slice(0, 12) + "-" + platform,
  );
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const lock = await open(join(cache, "build.lock"), "wx");
  try {
    const archives = [];
    for (const kind of ["canvas", platform]) {
      const [name, integrity] = packages[kind],
        filename = name + "-1.0.13.tgz",
        path = join(cache, filename);
      let body;
      try {
        body = await readFile(path);
      } catch {
        const response = await fetch(
          `https://registry.npmjs.org/@napi-rs/${name}/-/${filename}`,
          { redirect: "error", signal: AbortSignal.timeout(60000) },
        );
        if (!response.ok) throw Error("PDF_VISUAL_SOURCE_FETCH_FAILED");
        const chunks = [];
        let n = 0;
        for await (const chunk of response.body) {
          n += chunk.length;
          if (n > 32 * 1024 * 1024) throw Error("PDF_VISUAL_SOURCE_LIMIT");
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
        if (sha(body, "sha512") !== integrity)
          throw Error("PDF_VISUAL_SOURCE_INTEGRITY");
        await writeFile(path, body, { flag: "wx" });
      }
      if (sha(body, "sha512") !== integrity)
        throw Error("PDF_VISUAL_SOURCE_INTEGRITY");
      const paths = execFileSync("tar", ["-tf", path], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      })
        .trim()
        .split(/\r?\n/);
      if (
        paths.some(
          (p) =>
            !p.startsWith("package/") ||
            p.includes("\\") ||
            p.split("/").includes("..") ||
            /[\x00-\x1f]/.test(p),
        )
      )
        throw Error("PDF_VISUAL_SOURCE_PATH");
      const directory = join(cache, kind);
      await mkdir(directory, { recursive: true });
      execFileSync("tar", ["-xf", path, "-C", directory], {
        windowsHide: true,
      });
      archives.push({
        path,
        filename,
        integrity,
        sha256: sha(body),
        directory: join(directory, "package"),
      });
    }
    const output = join(root, "server/reading/generated-pdf-visual", platform);
    await mkdir(join(output, "source"), { recursive: true });
    const base = archives[0].directory,
      native = archives[1].directory;
    let source = await readFile(join(base, "index.js"), "utf8");
    source = change(
      source,
      "require('./js-binding')",
      "require('./skia.node')",
    );
    source = change(
      source,
      "const loadImage = require('./load-image')",
      "const loadImage = () => { throw Error('PDF_IMAGE_LOADER_DISABLED'); }",
    );
    source = change(
      source,
      "if (!process.env.DISABLE_SYSTEM_FONTS_LOAD)",
      "if (false)",
    );
    const canvas = await build({
      absWorkingDir: base,
      stdin: {
        contents: source,
        resolveDir: base,
        sourcefile: "canvas-index.js",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["./skia.node"],
      write: false,
      legalComments: "inline",
    });
    await writeFile(join(output, "canvas.cjs"), canvas.outputFiles[0].contents);
    const binary =
      platform === "win32-x64"
        ? "skia.win32-x64-msvc.node"
        : "skia.linux-x64-gnu.node";
    await copyFile(join(native, binary), join(output, "skia.node"));
    if (platform === "win32-x64")
      await copyFile(join(native, "icudtl.dat"), join(output, "icudtl.dat"));
    await copyFile(
      join(native, "sbom.cdx.json"),
      join(output, "sbom.cdx.json"),
    );
    await copyFile(join(base, "LICENSE"), join(output, "canvas.LICENSE"));
    await copyFile(
      join(root, "server/reading/pdf-canvas-notices.LICENSE"),
      join(output, "third-party.LICENSE"),
    );
    const licenseSources = {};
    for (const name of [
      "cssparser-0.38.0.crate",
      "cssparser-macros-0.7.0.crate",
      "dtoa-short-0.3.5.crate",
      "selectors-0.41.0.crate",
      "provenance.json",
      "upstream-notices.json",
    ]) {
      const source = join(root, "server/reading/pdf-canvas-sources", name),
        target = join(output, "source", name);
      await copyFile(source, target);
      licenseSources[name] = sha(await readFile(target));
    }
    await copyFile(
      join(root, "node_modules/pdfjs-dist/LICENSE"),
      join(output, "pdf.LICENSE"),
    );
    for (const a of archives)
      await copyFile(a.path, join(output, "source", a.filename));
    await copyFile(
      fileURLToPath(import.meta.url),
      join(output, "source/build-reading-pdf-visual.mjs"),
    );
    let api = await readFile(
      join(root, "node_modules/pdfjs-dist/build/pdf.mjs"),
      "utf8",
    );
    api = change(
      api,
      'warn("Please use the `legacy` build in Node.js environments.");',
      "",
    );
    api = change(
      api,
      "function warn(msg) {",
      "function warn(msg) { SHIXU_RENDER_WARNINGS++;",
    );
    api = change(
      api,
      '  const fs = process.getBuiltinModule("fs/promises");\n  const data = await fs.readFile(url);\n  return new Uint8Array(data);',
      '  throw Error("PDF_EXTERNAL_RESOURCE_DISABLED");',
    );
    const rgbStart = api.indexOf("function convertRGBToRGBA({"),
      rgbEnd = api.indexOf("function grayToRGBA(", rgbStart);
    if (
      rgbStart < 0 ||
      rgbEnd < 0 ||
      api.split("function convertRGBToRGBA({").length !== 2
    )
      throw Error("PDF_RGB_PATCH_REVIEW_REQUIRED");
    api =
      api.slice(0, rgbStart) +
      `function convertRGBToRGBA({src,srcPos=0,dest,destPos=0,width,height}){
      const pixels=width*height,end=srcPos+pixels*3;
      if(!Number.isSafeInteger(pixels)||pixels<0||srcPos<0||end>src.length||destPos<0||destPos+pixels>dest.length)throw Error("PDF_VISUAL_RGB_BOUNDS");
      const little=FeatureTest.isLittleEndian;
      for(;srcPos<end;srcPos+=3){
        const r=src[srcPos],g=src[srcPos+1],b=src[srcPos+2];
        dest[destPos++]=little?(r|(g<<8)|(b<<16)|0xff000000):((r<<24)|(g<<16)|(b<<8)|0xff);
      }
      return {srcPos,destPos};
    }\n` +
      api.slice(rgbEnd);
    api = compat(api);
    api =
      'import { canvas as shixuCanvas } from "../../pdf-canvas.mjs";\nconst {DOMMatrix,Path2D,ImageData}=shixuCanvas;\nlet SHIXU_RENDER_WARNINGS=0;\nexport function takeRenderWarningCount(){const n=SHIXU_RENDER_WARNINGS;SHIXU_RENDER_WARNINGS=0;return n;}\n' +
      api;
    const bundle = await build({
      stdin: { contents: api, resolveDir: output, sourcefile: "pdf.mjs" },
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["../../pdf-canvas.mjs"],
      minify: true,
      write: false,
      legalComments: "inline",
    });
    await writeFile(join(output, "api.mjs"), bundle.outputFiles[0].contents);
    let workerSource = compat(
      await readFile(
        join(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
        "utf8",
      ),
    );
    workerSource = change(
      workerSource,
      "function warn(msg) {",
      "function warn(msg) { SHIXU_WORKER_WARNINGS++;",
    );
    workerSource =
      "let SHIXU_WORKER_WARNINGS=0;export function takeWorkerWarningCount(){const n=SHIXU_WORKER_WARNINGS;SHIXU_WORKER_WARNINGS=0;return n;}\n" +
      workerSource;
    const worker = await build({
      stdin: {
        contents: workerSource,
        resolveDir: output,
        sourcefile: "pdf.worker.mjs",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      minify: true,
      write: false,
      legalComments: "inline",
    });
    await writeFile(join(output, "core.mjs"), worker.outputFiles[0].contents);
    const files = {};
    for (const name of [
      "canvas.cjs",
      "skia.node",
      ...(platform === "win32-x64" ? ["icudtl.dat"] : []),
      "sbom.cdx.json",
      "canvas.LICENSE",
      "pdf.LICENSE",
      "third-party.LICENSE",
      "api.mjs",
      "core.mjs",
    ])
      files[name] = sha(await readFile(join(output, name)));
    const manifest = {
      protocol: "shixu-pdf-visual/1",
      platform,
      pdfjs: "6.2.108",
      canvas: "1.0.13",
      builderSha256: sha(await readFile(fileURLToPath(import.meta.url))),
      licenseSources,
      archives: archives.map(({ filename, integrity, sha256 }) => ({
        filename,
        integrity,
        sha256,
      })),
      files,
    };
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(JSON.stringify({ phase: "pdf-visual-built", platform, files }));
    return manifest;
  } finally {
    await lock.close();
    await import("node:fs/promises").then((fs) =>
      fs.unlink(join(cache, "build.lock")),
    );
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const at = process.argv.indexOf("--target");
  await buildPdfVisual(at < 0 ? undefined : process.argv[at + 1]);
}
