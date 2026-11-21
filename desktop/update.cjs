const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const { mkdir, rename, rm } = require("node:fs/promises");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const repo = "HYX-2024-1020/shixu";
const latest = "https://api.github.com/repos/" + repo + "/releases/latest";
const releases = "https://github.com/" + repo + "/releases/";
const checksums = releases + "latest/download/SHA256SUMS.txt";
const checksumLine =
  /^([a-fA-F0-9]{64})[ \t]+\*?(Shixu-Setup-(\d+\.\d+\.\d+)\.exe)$/;
const maximumInstallerBytes = 2 ** 31 - 1;

function isNewer(tag, current) {
  const version = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    tag,
  );
  const installed = /^(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?$/.exec(current);
  if (!version || !installed) throw Error("发行信息无法验证");
  const difference = [1, 2, 3]
    .map((index) => Number(version[index]) - Number(installed[index]))
    .find((difference) => difference !== 0);
  return difference === undefined ? Boolean(installed[4]) : difference > 0;
}

function selectUpdate(release, current) {
  if (release?.draft !== false || release.prerelease !== false)
    throw Error("发行信息无法验证");
  if (!isNewer(release.tag_name, current)) return null;
  const version = release.tag_name.slice(1);
  const name = "Shixu-Setup-" + version + ".exe";
  const url = releases + "download/" + release.tag_name + "/" + name;
  const asset = release.assets?.find((asset) => asset.name === name);
  if (
    asset?.state !== "uploaded" ||
    asset.browser_download_url !== url ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  )
    throw Error("新版安装包或校验信息尚不可用");
  return {
    version,
    url,
    size: asset.size,
    digest: asset.digest.slice(7),
  };
}

function selectChecksumUpdate(manifest, current) {
  const entries = manifest
    .split(/\r?\n/)
    .map((line) => checksumLine.exec(line))
    .filter(Boolean);
  if (entries.length !== 1) throw Error("安装包校验信息无法验证");
  const [, digest, name, version] = entries[0];
  const tag = "v" + version;
  if (!isNewer(tag, current)) return null;
  return {
    version,
    url: releases + "download/" + tag + "/" + name,
    digest: digest.toLowerCase(),
  };
}

class DesktopUpdate {
  constructor({ version, cache, supported, fetcher = fetch }) {
    this.version = version;
    this.cache = cache;
    this.fetcher = fetcher;
    this.phase = supported ? "idle" : "unavailable";
    this.candidate = null;
    this.progress = 0;
    this.error = "";
    this.file = path.join(cache, "Shixu-Setup.exe");
  }

  status() {
    return {
      version: this.version,
      phase: this.phase,
      available: this.candidate?.version,
      progress: this.progress,
      error: this.error,
    };
  }

  async check() {
    if (
      ["unavailable", "checking", "downloading", "installing"].includes(
        this.phase,
      )
    )
      return this.status();
    this.phase = "checking";
    this.candidate = null;
    this.error = "";
    try {
      try {
        // Public release assets do not count toward the anonymous API quota.
        const response = await this.fetcher(checksums, {
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw Error("发行校验文件不可用");
        this.candidate = selectChecksumUpdate(await response.text(), this.version);
      } catch {
        const response = await this.fetcher(latest, {
          headers: { Accept: "application/vnd.github+json" },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        }).catch(() => {
          throw Error("无法连接更新服务，请检查网络后重试");
        });
        if (!response.ok) throw Error("暂时无法读取发行信息，请稍后重试");
        this.candidate = selectUpdate(await response.json(), this.version);
      }
      this.phase = this.candidate ? "available" : "current";
    } catch (error) {
      this.phase = "idle";
      this.error = error.message;
    }
    return this.status();
  }

  async download() {
    if (this.phase !== "available") return this.status();
    this.phase = "downloading";
    this.progress = 0;
    this.error = "";
    const { url, size, digest } = this.candidate;
    const partial = this.file + ".part";
    try {
      const signal = AbortSignal.timeout(600000);
      const response = await this.fetcher(url, {
        redirect: "follow",
        signal,
      }).catch(() => {
        throw Error("无法连接安装包下载地址，请检查网络后重试");
      });
      if (!response.ok || !response.body) throw Error("暂时无法下载安装包");
      const length = Number(response.headers.get("content-length"));
      const expectedSize =
        size ?? (Number.isSafeInteger(length) && length > 0 ? length : undefined);
      const limit =
        size ?? Math.min(expectedSize ?? maximumInstallerBytes, maximumInstallerBytes);
      await mkdir(this.cache, { recursive: true });
      const hash = createHash("sha256");
      let count = 0;
      const track = new Transform({
        transform: (chunk, _encoding, callback) => {
          count += chunk.length;
          if (count > limit) return callback(Error("安装包大小校验失败"));
          hash.update(chunk);
          if (expectedSize)
            this.progress = Math.min(99, Math.floor((100 * count) / expectedSize));
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        track,
        createWriteStream(partial),
        { signal },
      );
      if (
        (expectedSize !== undefined && count !== expectedSize) ||
        hash.digest("hex") !== digest
      )
        throw Error("安装包校验失败，请重新下载");
      await rename(partial, this.file);
      this.progress = 100;
      this.phase = "ready";
    } catch (error) {
      this.phase = "available";
      this.error = error.message;
      await rm(partial, { force: true }).catch(() => {});
    }
    return this.status();
  }

  async install({ prepare, launch, quit }) {
    if (this.phase !== "ready") return this.status();
    this.phase = "installing";
    this.error = "";
    try {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(this.file)) hash.update(chunk);
      if (hash.digest("hex") !== this.candidate.digest) {
        this.phase = "available";
        throw Error("安装包校验失败，请重新下载");
      }
      await prepare();
      await launch(this.file);
      quit();
    } catch (error) {
      if (error.code === "ENOENT") {
        this.phase = "available";
        this.error = "安装包已被移除，请重新下载";
      } else {
        if (this.phase === "installing") this.phase = "ready";
        this.error = error.message;
      }
    }
    return this.status();
  }
}

module.exports = { DesktopUpdate, selectUpdate };
