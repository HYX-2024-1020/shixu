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

async function fixture(t, getAsset) {
  const cache = await mkdtemp(path.join(tmpdir(), "shixu-updater-test-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const requests = [];
  const updater = new DesktopUpdate({
    version: "0.3.32-beta.1",
    supported: true,
    cache,
    fetcher: async (url, options) => {
      requests.push(String(url));
      if (url === assetURL) return getAsset(options);
      assert.equal(
        url,
        "https://api.github.com/repos/HYX-2024-1020/shixu/releases/latest",
      );
      return Response.json(release);
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
  const { updater, requests } = await fixture(t, ({ headers }) => {
    assert.equal(headers.Range, "bytes=0-" + (installer.length - 1));
    return new Response(installer, {
      status: 206,
      headers: {
        "Content-Range":
          "bytes 0-" + (installer.length - 1) + "/" + installer.length,
      },
    });
  });
  assert.equal((await updater.check()).phase, "available");
  assert.equal(requests.length, 1);
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
