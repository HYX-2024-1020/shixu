import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  readFile,
  writeFile,
  mkdir,
  open,
  copyFile,
  chmod,
  lstat,
} from "node:fs/promises";
import { join, resolve, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { patchReadingWebp } from "./patch-reading-webp.mjs";

export const WEBP_SOURCE = Object.freeze({
  version: "1.6.0",
  url: "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz",
  sha256: "e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564",
  protocol: "shixu-webp/3",
});
const root = fileURLToPath(new URL("../", import.meta.url)),
  hash = (b) => createHash("sha256").update(b).digest("hex");
export async function buildReadingWebp({ sourcePath } = {}) {
  const platform = process.platform + "-" + process.arch;
  if (!["linux-x64", "win32-x64"].includes(platform))
    throw Error("WEBP_BUILD_PLATFORM_UNSUPPORTED");
  const script = fileURLToPath(import.meta.url),
    adapter = join(root, "server/reading/native/webp-reader.c");
  const patchFile = join(root, "scripts/patch-reading-webp.mjs");
  const builderHash = hash(
      Buffer.concat([await readFile(script), await readFile(patchFile)]),
    ),
    adapterHash = hash(await readFile(adapter));
  const output = join(root, "server/reading/generated-webp"),
    name = "reading-webp" + (process.platform === "win32" ? ".exe" : "");
  try {
    const m = JSON.parse(await readFile(join(output, "manifest.json")));
    if (
      m.sourceSha256 === WEBP_SOURCE.sha256 &&
      m.protocol === WEBP_SOURCE.protocol &&
      m.builderSha256 === builderHash &&
      m.adapterSha256 === adapterHash &&
      m.platform === platform &&
      m.toolSha256 === hash(await readFile(join(output, name))) &&
      hash(await readFile(join(output, "source/libwebp-1.6.0.tar.gz"))) ===
        WEBP_SOURCE.sha256
    ) {
      console.log(
        JSON.stringify({
          phase: "webp-reader-cached",
          platform,
          toolSha256: m.toolSha256,
        }),
      );
      return m;
    }
  } catch {}
  const cache = join(
    tmpdir(),
    "shixu-webp-" +
      hash(root).slice(0, 12) +
      "-" +
      platform +
      "-" +
      builderHash.slice(0, 8) +
      "-" +
      adapterHash.slice(0, 8),
  );
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const info = await lstat(cache);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Error("UNSAFE_BUILD_CACHE");
  const lock = await open(join(cache, "build.lock"), "wx");
  try {
    const archive = join(cache, "libwebp-1.6.0.tar.gz");
    if (!existsSync(archive)) {
      let body;
      if (sourcePath) body = await readFile(resolve(sourcePath));
      else {
        const response = await fetch(WEBP_SOURCE.url, {
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw Error("WEBP_SOURCE_DOWNLOAD_FAILED");
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) throw Error("WEBP_SOURCE_LIMIT");
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      if (hash(body) !== WEBP_SOURCE.sha256)
        throw Error("WEBP_SOURCE_INTEGRITY");
      await writeFile(archive, body, { flag: "wx" });
    }
    if (hash(await readFile(archive)) !== WEBP_SOURCE.sha256)
      throw Error("WEBP_SOURCE_INTEGRITY");
    const paths = execFileSync("tar", ["-tf", archive], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
      .trim()
      .split(/\r?\n/);
    if (
      paths.some(
        (p) =>
          !p.startsWith("libwebp-1.6.0/") ||
          p.includes("\\") ||
          p.split("/").includes("..") ||
          /[\x00-\x1f]/.test(p),
      )
    )
      throw Error("UNSAFE_SOURCE_ARCHIVE");
    execFileSync("tar", ["-xf", archive, "-C", cache], { windowsHide: true });
    const src = join(cache, "libwebp-1.6.0"),
      env = { ...process.env };
    await patchReadingWebp(src);
    const upstreamMake = await readFile(join(src, "makefile.unix"), "utf8"),
      marker = "#### Nothing should normally be changed below this line ####";
    if (upstreamMake.split(marker).length !== 2)
      throw Error("WEBP_BUILD_REVIEW_REQUIRED");
    // Use only the pinned library object/target lists. The unused example-tool
    // configuration probes uname, SDL and host image libraries; none is needed.
    await writeFile(
      join(src, "shixu.make"),
      "EXTRA_FLAGS=-O2 -march=x86-64 -mtune=generic\nEXTRA_LIBS=\n" +
        upstreamMake.slice(upstreamMake.indexOf(marker)),
    );
    const pathKey =
      Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
    if (process.platform === "win32") {
      const bin = [
        "C:/mingw64/mingw64/bin",
        "C:/mingw64/bin",
        "C:/msys64/mingw64/bin",
      ].find(
        (p) =>
          existsSync(join(p, "gcc.exe")) &&
          existsSync(join(p, "mingw32-make.exe")),
      );
      if (bin) env[pathKey] = bin + delimiter + env[pathKey];
    }
    console.log(
      JSON.stringify({
        phase: "build-pinned-webp",
        platform,
        sourceSha256: WEBP_SOURCE.sha256,
      }),
    );
    const options = {
      cwd: src,
      env,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    };
    try {
      execFileSync(
        process.platform === "win32" ? "mingw32-make" : "make",
        [
          "-f",
          "shixu.make",
          "-j2",
          "EXTRA_FLAGS=-O2 -march=x86-64 -mtune=generic",
          "EXTRA_LIBS=",
          "src/libwebpdecoder.a",
          "src/demux/libwebpdemux.a",
          "src/utils/bit_writer_utils.o",
        ],
        options,
      );
      execFileSync(
        "gcc",
        [
          "-O2",
          "-march=x86-64",
          "-mtune=generic",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-I.",
          adapter,
          "src/demux/libwebpdemux.a",
          "src/libwebpdecoder.a",
          "src/utils/bit_writer_utils.o",
          "-lm",
          ...(process.platform === "win32"
            ? ["-static-libgcc", "-Wl,--no-insert-timestamp"]
            : []),
          "-o",
          join(cache, name),
        ],
        options,
      );
    } catch (error) {
      await writeFile(
        join(cache, "compile-error.txt"),
        String(error.stderr || error.message),
      );
      throw Error("WEBP_BUILD_FAILED_SEE_OWNED_CACHE: " + cache);
    }
    const manifest = {
      ...WEBP_SOURCE,
      platform,
      sourceSha256: WEBP_SOURCE.sha256,
      builderSha256: builderHash,
      adapterSha256: adapterHash,
      toolSha256: hash(await readFile(join(cache, name))),
      compiler: execFileSync("gcc", ["--version"], {
        ...options,
        encoding: "utf8",
      }).split(/\r?\n/)[0],
    };
    await mkdir(join(output, "source"), { recursive: true });
    await copyFile(join(cache, name), join(output, name));
    await chmod(join(output, name), 0o755);
    for (const file of ["COPYING", "PATENTS", "AUTHORS"])
      await copyFile(join(src, file), join(output, file));
    await copyFile(archive, join(output, "source/libwebp-1.6.0.tar.gz"));
    await copyFile(script, join(output, "source/build-reading-webp.mjs"));
    await copyFile(adapter, join(output, "source/webp-reader.c"));
    await copyFile(patchFile, join(output, "source/patch-reading-webp.mjs"));
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        phase: "webp-reader-built",
        platform,
        toolSha256: manifest.toolSha256,
      }),
    );
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
  const at = process.argv.indexOf("--source");
  await buildReadingWebp({
    sourcePath: at < 0 ? undefined : process.argv[at + 1],
  });
}
