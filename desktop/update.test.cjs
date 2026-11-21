const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHash } = require("node:crypto");
const { mkdtemp, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DesktopUpdate, selectUpdate } = require("./update.cjs");

const installer = Buffer.from("synthetic Windows installer");
const assetURL =
  "https://github.com/HYX-2024-1020/shixu/releases/download/v0.3.32/Shixu-Setup-0.3.32.exe";
const checksumsURL =
  "https://github.com/HYX-2024-1020/shixu/releases/latest/download/SHA256SUMS.txt";
const apiURL =
  "https://api.github.com/repos/HYX-2024-1020/shixu/releases/latest";
const release = {
  tag_name: "v0.3.32",
  draft: false,
  prerelease: false,
  assets: [
    {
      name: "Shixu-Setup-0.3.32.exe",
      state: "uploaded",
      browser_download_url: assetURL,
      size: installer.length,
      digest: "sha256:" + createHash("sha256").update(installer).digest("hex"),
    },
  ],
};
const checksumLine = release.assets[0].digest.slice(7) + "  Shixu-Setup-0.3.32.exe";
const checksumFile = checksumLine + "\r\n" +
  release.assets[0].digest.slice(7) + "  Shixu-Setup-0.3.32.exe.blockmap\r\n";

async function fixture(t, getAsset, getChecksums = () => new Response(checksumFile), getAPI) {
  const cache = await mkdtemp(path.join(tmpdir(), "shixu-updater-test-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const requests = [];
  const updater = new DesktopUpdate({
    version: "0.3.32-beta.1",
    supported: true,
    cache,
    fetcher: async (url) => {
      requests.push(String(url));
      if (url === assetURL) return getAsset();
      if (url === checksumsURL) return getChecksums();
      assert.equal(url, apiURL);
      return getAPI ? getAPI() : new Response(null, { status: 403 });
    },
  });
  return { updater, requests };
}

test("only a newer official Windows installer with a verified digest is eligible", () => {
  assert.equal(selectUpdate(release, "0.3.32"), null);
  assert.equal(selectUpdate(release, "0.3.40-beta.1"), null);
  assert.equal(selectUpdate(release, "0.3.32-beta.1").url, assetURL);
  assert.throws(() => selectUpdate({ ...release, prerelease: true }, "0.3.31"));
  assert.throws(() => selectUpdate({ ...release, assets: [] }, "0.3.31"));
  assert.throws(() =>
    selectUpdate(
      {
        ...release,
        assets: [{ ...release.assets[0], digest: "" }],
      },
      "0.3.31",
    ),
  );
});

test("downloads only on request, verifies bytes, saves drafts and opens the installer", async (t) => {
  const { updater, requests } = await fixture(t, () => new Response(installer));
  assert.equal((await updater.check()).phase, "available");
  assert.deepEqual(requests, [checksumsURL]);
  assert.equal((await updater.download()).progress, 100);
  assert.deepEqual(requests.slice(1), [assetURL]);
  const events = [];
  await updater.install({
    prepare: async () => {
      events.push("saved");
    },
    launch: async (file) => {
      assert.deepEqual(await readFile(file), installer);
      events.push("opened");
    },
    quit: () => {
      events.push("quit");
    },
  });
  assert.deepEqual(events, ["saved", "opened", "quit"]);
});

test("an older release without a checksum file can still use the API", async (t) => {
  const { updater, requests } = await fixture(
    t,
    () => new Response(installer),
    () => new Response(null, { status: 404 }),
    () => Response.json(release),
  );
  assert.equal((await updater.check()).available, "0.3.32");
  assert.deepEqual(requests, [checksumsURL, apiURL]);
});

test("ambiguous checksums cannot select an installer when the API is rate limited", async (t) => {
  const { updater, requests } = await fixture(
    t,
    () => assert.fail("Installer must not be downloaded"),
    () => new Response(checksumLine + "\n" + checksumLine),
  );
  assert.equal((await updater.check()).phase, "idle");
  assert.equal((await updater.download()).available, undefined);
  assert.deepEqual(requests, [checksumsURL, apiURL]);
});

test("partial or changed files cannot install and leave a download retry", async (t) => {
  let bytes = installer.subarray(1);
  const { updater } = await fixture(t, () => new Response(bytes));
  await updater.check();
  assert.equal((await updater.download()).phase, "available");
  await assert.rejects(readFile(updater.file + ".part"), { code: "ENOENT" });
  bytes = installer;
  assert.equal((await updater.download()).phase, "ready");
  await writeFile(updater.file, "tampered");
  const unexpected = () =>
    assert.fail("Should not run an installer after failed verification");
  const result = await updater.install({
    prepare: unexpected,
    launch: unexpected,
    quit: unexpected,
  });
  assert.equal(result.phase, "available");
  assert.match(result.error, /校验失败/);
});
