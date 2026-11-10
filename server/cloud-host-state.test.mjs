import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, chownSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { openHostCloudOperations } from "./cloud-operations.mjs";

test(
  "cold privileged maintenance permits the unprivileged application to share its live WAL",
  {
    skip: process.platform !== "linux" || process.getuid?.() !== 0,
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "shixu-host-wal-"));
    chmodSync(root, 0o755);
    const state = join(root, "state");
    mkdirSync(state, { mode: 0o700 });
    chownSync(state, 65534, 65534);
    const previous = process.umask(0o077);
    let ops;
    try {
      const path = join(state, "operations.sqlite");
      ops = openHostCloudOperations(path);
      const module = new URL("./cloud-operations.mjs", import.meta.url).href;
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {CloudOperations} from ${JSON.stringify(module)};const ops=new CloudOperations(${JSON.stringify(path)});ops.request('restart',{reason:'synthetic cold worker'},'synthetic-host-wal','synthetic-service');ops.close();`,
        ],
        { uid: 65534, gid: 65534, encoding: "utf8", timeout: 10000 },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.equal(ops.jobs()[0].actor, "synthetic-service");
    } finally {
      ops?.close();
      process.umask(previous);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
