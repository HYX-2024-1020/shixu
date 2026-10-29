import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  chmod,
  open,
  unlink,
  lstat,
} from "node:fs/promises";
import { existsSync, openSync, closeSync } from "node:fs";
import { join, resolve, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const NATIVE_ARCHIVE_SOURCE = Object.freeze({
  version: "26.05",
  protocol: "shixu-raw-path/1",
  url: "https://github.com/ip7z/7zip/releases/download/26.05/7z2605-src.tar.xz",
  sha256: "0b6080b8c3e7a579161d2d495224c0e51c467576cb4c7048b0ab485ef44cc22e",
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const root = fileURLToPath(new URL("../", import.meta.url));
const original = `        if (IsPropId_for_PathString(f.PropID))
          g_StdOut.Normalize_UString_Path(TempWString);
        else
          g_StdOut.Normalize_UString(TempWString);
        if (techMode)
          g_StdOut.PrintUString(TempWString, TempAString);
        else
          PrintUString(f.TextAdjustment, width, TempWString, TempAString);`;
const replacement = `        // Shixu raw-path protocol v1. Preserve each original wchar value.
        // This modification remains under the upstream 7-Zip licenses.
        if (techMode && IsPropId_for_PathString(f.PropID))
        {
          const char * const hex = "0123456789ABCDEF";
          g_StdOut << "SHIXU_U32:";
          for (unsigned j = 0; j < TempWString.Len(); j++)
            for (unsigned n = 8; n != 0;)
              g_StdOut << hex[((UInt32)TempWString[j] >> (--n * 4)) & 15];
        }
        else
        {
${original
  .split("\n")
  .map((line) => "  " + line)
  .join("\n")}
        }`;
// Private property is used ONLY by technical listing. Extraction retains the
// upstream OS-path handling. Raw metadata must precede display normalization.
const handlerPatches = [
  [
    "CPP/7zip/Archive/Rar/Rar5Handler.cpp",
    "    item.Name.SetFrom_CalcLen((const char *)Get_Buf_Data(), (unsigned)len);",
    "    // Shixu: reject NUL before upstream C-string truncation loses identity.\n    if (memchr(Get_Buf_Data(), 0, (size_t)len) != NULL) return false;\n    item.Name.SetFrom_CalcLen((const char *)Get_Buf_Data(), (unsigned)len);",
  ],
  [
    "CPP/7zip/UI/Console/List.cpp",
    "    if (f.PropID == kpidPath)\n    {",
    "    if (f.PropID == kpidPath && !techMode)\n    {",
  ],
  [
    "CPP/7zip/UI/Console/List.cpp",
    "Arc->Archive->GetProperty(index, f.PropID, &prop)",
    "Arc->Archive->GetProperty(index, techMode && f.PropID == kpidPath ? (PROPID)0x7f000001 : f.PropID, &prop)",
  ],
  [
    "CPP/7zip/Archive/Rar/Rar5Handler.cpp",
    "    case kpidPath:\n    {",
    "    case (PROPID)0x7f000001:\n    {\n      UString raw;\n      if (!ConvertUTF8ToUnicode(item.Name, raw)) return E_FAIL;\n      prop = raw;\n      break;\n    }\n    case kpidPath:\n    {",
  ],
  [
    "CPP/7zip/Archive/7z/7zHandler.cpp",
    "    case kpidPath: return _db.GetPath_Prop(index, value);",
    "    case (PROPID)0x7f000001: return _db.GetPath_Prop(index, value, true);\n    case kpidPath: return _db.GetPath_Prop(index, value);",
  ],
  [
    "CPP/7zip/Archive/7z/7zIn.h",
    "HRESULT GetPath_Prop(unsigned index, PROPVARIANT *path) const throw();",
    "HRESULT GetPath_Prop(unsigned index, PROPVARIANT *path, bool shixuRaw = false) const throw();",
  ],
  [
    "CPP/7zip/Archive/7z/7zIn.cpp",
    "HRESULT CDatabase::GetPath_Prop(unsigned index, PROPVARIANT *path) const throw()\n{",
    "HRESULT CDatabase::GetPath_Prop(unsigned index, PROPVARIANT *path, bool shixuRaw) const throw()\n{\n  (void)shixuRaw;",
  ],
  [
    "CPP/7zip/Archive/7z/7zIn.cpp",
    "    if (c == L'/')\n      c = WCHAR_PATH_SEPARATOR;\n    else if (c == L'\\\\')\n      c = WCHAR_IN_FILE_NAME_BACKSLASH_REPLACEMENT; // WSL scheme",
    "    if (!shixuRaw && c == L'/')\n      c = WCHAR_PATH_SEPARATOR;\n    else if (!shixuRaw && c == L'\\\\')\n      c = WCHAR_IN_FILE_NAME_BACKSLASH_REPLACEMENT; // WSL scheme",
  ],
];

function compilerEnvironment() {
  const env = { ...process.env };
  const key =
    Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
  if (process.platform === "win32") {
    const candidates = [
      "C:/mingw64/mingw64/bin",
      "C:/mingw64/bin",
      "C:/msys64/mingw64/bin",
    ];
    const bin = candidates.find(
      (p) =>
        existsSync(join(p, "g++.exe")) &&
        existsSync(join(p, "mingw32-make.exe")),
    );
    if (bin) env[key] = bin + delimiter + env[key];
  }
  return env;
}

export async function buildReadingArchive({ jobs = 2 } = {}) {
  if (!["win32", "linux"].includes(process.platform) || process.arch !== "x64")
    throw Error("NATIVE_BUILD_PLATFORM_UNSUPPORTED");
  if (![1, 2].includes(jobs)) throw Error("INVALID_BUILD_JOBS");
  const platform = process.platform + "-" + process.arch;
  const output = join(root, "server/reading/generated-native");
  const name = "reading-7zz" + (process.platform === "win32" ? ".exe" : "");
  const script = fileURLToPath(import.meta.url),
    builderHash = hash(await readFile(script));
  const source = NATIVE_ARCHIVE_SOURCE;
  try {
    const prior = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    );
    if (
      prior.sourceSha256 === source.sha256 &&
      prior.protocol === source.protocol &&
      prior.builderSha256 === builderHash &&
      prior.platform === platform &&
      prior.toolSha256 === hash(await readFile(join(output, name))) &&
      source.sha256 ===
        hash(await readFile(join(output, "source/7z2605-src.tar.xz")))
    ) {
      console.log(
        JSON.stringify({
          phase: "native-reader-cached",
          platform,
          toolSha256: prior.toolSha256,
        }),
      );
      return prior;
    }
  } catch {
    /* Missing/incomplete generated output must be built, never used by a reader. */
  }
  const cache = join(
    tmpdir(),
    "shixu-7zip-26.05-" + hash(resolve(root)).slice(0, 12) + "-" + platform,
  );
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const info = await lstat(cache);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Error("UNSAFE_BUILD_CACHE");
  const lock = await open(join(cache, "build.lock"), "wx").catch(() => {
    throw Error("NATIVE_BUILD_LOCKED: " + cache);
  });
  await lock.writeFile(JSON.stringify({ pid: process.pid, platform }));
  try {
    const archive = join(cache, "source.tar.xz");
    if (!existsSync(archive)) {
      console.log(
        JSON.stringify({
          phase: "fetch-verified-source",
          version: source.version,
        }),
      );
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw Error("NATIVE_SOURCE_DOWNLOAD_FAILED");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) throw Error("NATIVE_SOURCE_SIZE");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (hash(body) !== source.sha256) throw Error("NATIVE_SOURCE_INTEGRITY");
      await writeFile(archive, body, { flag: "wx", mode: 0o600 });
    }
    if (hash(await readFile(archive)) !== source.sha256)
      throw Error("NATIVE_SOURCE_INTEGRITY");
    const src = join(cache, "src");
    await mkdir(src, { recursive: true, mode: 0o700 });
    const marker = join(cache, "patched.json");
    let patched;
    try {
      patched = JSON.parse(await readFile(marker, "utf8"));
    } catch {}
    const listFile = join(src, "CPP/7zip/UI/Console/List.cpp");
    if (
      patched?.builderSha256 !== builderHash ||
      !existsSync(listFile) ||
      patched.listSha256 !== hash(await readFile(listFile))
    ) {
      const paths = execFileSync("tar", ["-tf", archive], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      })
        .split(/\r?\n/)
        .filter(Boolean);
      if (
        paths.some(
          (p) => /^[\\/]|^[a-z]:/i.test(p) || p.split(/[\\/]/).includes(".."),
        )
      )
        throw Error("UNSAFE_SOURCE_ARCHIVE");
      execFileSync("tar", ["-xf", archive, "-C", src], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const text = (await readFile(listFile, "utf8")).replace(/\r\n/g, "\n");
      if (text.split(original).length !== 2)
        throw Error("NATIVE_PATCH_REVIEW_REQUIRED");
      const updated = text.replace(original, replacement);
      await writeFile(listFile, updated);
      for (const [relative, before, after] of handlerPatches) {
        const path = join(src, relative);
        const text = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
        if (text.split(before).length !== 2)
          throw Error("NATIVE_HANDLER_PATCH_REVIEW_REQUIRED: " + relative);
        await writeFile(path, text.replace(before, after));
      }
      await writeFile(
        marker,
        JSON.stringify({
          builderSha256: builderHash,
          listSha256: hash(await readFile(listFile)),
        }),
      );
    }
    const env = compilerEnvironment();
    const compiler = execFileSync("g++", ["--version"], {
      env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 8192,
    }).split(/\r?\n/)[0];
    const cwd = join(src, "CPP/7zip/Bundles/Alone2"),
      log = join(cache, "compile.log");
    const objects = "shixu-out-" + builderHash.slice(0, 8);
    const target =
      objects + "/shixu-7zz" + (process.platform === "linux" ? "s" : ".exe");
    const args = [
      "-f",
      "makefile.gcc",
      "-j" + jobs,
      "O=" + objects,
      "PROG=shixu-7zz",
      "IS_X64=1",
      "CC=gcc",
      "CXX=g++",
      target,
    ];
    if (process.platform === "win32")
      args.push(
        "LDFLAGS_STATIC_3=-Wl,--no-insert-timestamp",
        // GCC 16 diagnoses upstream's COM multiple-inheritance allocation.
        // Keep the diagnostic visible; all other warnings remain errors.
        "CFLAGS_WARN_WALL=-Werror -Wall -Wextra -Wno-error=array-bounds",
      );
    console.log(
      JSON.stringify({
        phase: "compile-native-reader",
        platform,
        jobs,
        compiler,
        log,
      }),
    );
    const fd = openSync(log, "w", 0o600),
      started = performance.now();
    try {
      await new Promise((done, reject) => {
        const child = spawn(
          process.platform === "win32" ? "mingw32-make" : "make",
          args,
          { cwd, env, windowsHide: true, stdio: ["ignore", fd, fd] },
        );
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? done() : reject(Error("NATIVE_COMPILE_FAILED: " + code)),
        );
      });
    } catch (e) {
      e.message += "\n" + (await readFile(log, "utf8")).slice(-4000);
      throw e;
    } finally {
      closeSync(fd);
    }
    const binary = join(cwd, target);
    const manifest = {
      ...source,
      sourceSha256: source.sha256,
      platform,
      compiler,
      builderSha256: builderHash,
      toolSha256: hash(await readFile(binary)),
      patchSha256: hash(
        original + replacement + JSON.stringify(handlerPatches),
      ),
    };
    await mkdir(join(output, "source"), { recursive: true });
    await copyFile(binary, join(output, name));
    await chmod(join(output, name), 0o755);
    await copyFile(archive, join(output, "source/7z2605-src.tar.xz"));
    await copyFile(script, join(output, "source/build-reading-archive.mjs"));
    await copyFile(join(src, "DOC/License.txt"), join(output, "License.txt"));
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        phase: "native-reader-built",
        platform,
        toolSha256: manifest.toolSha256,
        elapsedMs: performance.now() - started,
      }),
    );
    return manifest;
  } finally {
    await lock.close();
    await unlink(join(cache, "build.lock"));
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await buildReadingArchive({
    jobs: process.argv.includes("--jobs=1") ? 1 : 2,
  });
