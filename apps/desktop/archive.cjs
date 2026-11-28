const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const binary = require("7zip-bin-full").path7z.replace(
  "app.asar",
  "app.asar.unpacked",
);
const limits = {
  files: 120,
  bytes: 96 * 1024 * 1024,
  single: 16 * 1024 * 1024,
};
function archiveError(error) {
  const detail = String(error.stderr || "") + " " + String(error.message || "");
  if (error.code === "ENOENT") return "本机解包组件缺失，请重新安装拾序";
  if (error.killed || error.signal) return "压缩包处理超时，请拆分后重试";
  if (/wrong password|encrypted|password is incorrect/i.test(detail))
    return "压缩包已加密，首版不解密，请解密后投递";
  if (/missing volume|volume.*not found|need.*volume/i.test(detail))
    return "分卷缺失或不支持自动合并，请先在外部合并分卷后投递";
  if (/unsupported|not implemented/i.test(detail))
    return "压缩算法或特性暂不支持，请转换为普通 ZIP 后投递";
  if (/maxBuffer/i.test(detail)) return "读取内容超过缓冲上限，请拆分后投递";
  if (
    /unexpected end|headers error|crc failed|data error|not archive|can not open.*archive/i.test(
      detail,
    )
  )
    return "压缩包损坏或不完整，请重新获取完整文件";
  return error.code
    ? "压缩包读取失败，请检查文件完整性或转换为普通 ZIP"
    : error.message;
}
function safeEntry(name) {
  return (
    !!name &&
    !name.includes("\0") &&
    !/^(?:[a-z]:|[\\/])/i.test(name) &&
    !name.split(/[\\/]/).some((p) => p === "..")
  );
}
function parseListing(text) {
  const content = text
    .split(/----------\r?\n/)
    .slice(1)
    .join("\n");
  if (!content) throw new Error("无法读取目录，压缩包可能加密或损坏");
  const entries = content
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) =>
      Object.fromEntries(
        block
          .split(/\r?\n/)
          .filter((line) => line.includes(" = "))
          .map((line) => {
            const i = line.indexOf(" = ");
            return [line.slice(0, i), line.slice(i + 3)];
          }),
      ),
    );
  return entries.filter(
    (e) => e.Path && e.Folder !== "+" && !/^D/.test(e.Attributes || ""),
  );
}
async function readArchive(
  bytes,
  extension,
  cacheRoot = path.join(os.tmpdir(), "shixu-unpack"),
) {
  if (
    !["zip", "rar", "7z"].includes(extension) ||
    bytes.byteLength > 32 * 1024 * 1024
  )
    throw new Error("压缩包类型无效或超过 32MB");
  await fs.mkdir(cacheRoot, { recursive: true });
  const folder = await fs.mkdtemp(path.join(cacheRoot, "job-")),
    file = path.join(folder, "input." + extension);
  try {
    await fs.writeFile(file, Buffer.from(bytes));
    const options = {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    };
    const { stdout } = await run(
      binary,
      ["l", "-slt", "-sccUTF-8", "-pSHIXU_NO_PASSWORD", "--", file],
      options,
    );
    const entries = parseListing(stdout);
    if (entries.length > limits.files)
      throw new Error(
        `包内 ${entries.length} 个文件，超过 ${limits.files} 个上限，请拆包后投递`,
      );
    if (entries.reduce((n, e) => n + Number(e.Size || 0), 0) > limits.bytes)
      throw new Error("包内解压总量超过 96MB，请拆包后投递");
    const results = [];
    const deadline = Date.now() + 120000;
    let actualTotal = 0;
    for (const e of entries) {
      let error =
        Date.now() > deadline
          ? "压缩包处理超过两分钟，请拆分后重试"
          : !safeEntry(e.Path)
            ? "路径越界，已拒绝读取"
            : e.Encrypted === "+"
              ? "加密文件，请解密后投递"
              : e["Symbolic Link"] || e["Hard Link"]
                ? "不读取符号链接或硬链接"
                : Number(e.Size) > limits.single
                  ? "单文件解压超过 16MB"
                  : /\.(zip|rar|7z)$/i.test(e.Path)
                    ? "嵌套压缩包暂不自动展开，请单独投递"
                    : "";
      if (error) {
        results.push({ name: e.Path, error });
        continue;
      }
      try {
        const { stdout: data } = await run(
          binary,
          ["x", "-so", "-spd", "-y", "-pSHIXU_NO_PASSWORD", "--", file, e.Path],
          { ...options, encoding: "buffer", maxBuffer: limits.single },
        );
        actualTotal += data.length;
        if (actualTotal > limits.bytes) throw new Error("实际解压总量超限");
        results.push({ name: e.Path, bytes: Uint8Array.from(data).buffer });
      } catch (error) {
        results.push({
          name: e.Path,
          error: archiveError(error),
        });
      }
    }
    return results.map((e) => ({ ...e, name: e.name.replaceAll("\\", "/") }));
  } catch (e) {
    throw new Error(archiveError(e));
  } finally {
    if (!path.resolve(folder).startsWith(path.resolve(cacheRoot) + path.sep))
      throw new Error("临时目录校验失败");
    await fs.rm(folder, { recursive: true, force: true });
  }
}
module.exports = { readArchive, parseListing, safeEntry };
