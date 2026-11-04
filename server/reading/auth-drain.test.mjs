import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { AccountRegistry } from "../sync-accounts.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { readMaterial } from "./material.mjs";
const require = createRequire(import.meta.url),
  { AccountWorkspace } = require("../../desktop/accounts.cjs"),
  { DesktopStore } = require("../../desktop/storage.cjs");
for (const shortGrace of [false, true])
  test(
    shortGrace
      ? "registration KDF exceeding shutdown grace cannot write credentials or grant after registry closure"
      : "an aborted registration request drains its KDF and durable grant before the v4 registry closes",
    { timeout: 15000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "shixu-auth-drain-")),
        directory = join(root, "server"),
        secret = "synthetic-auth-drain-secret-32-characters",
        ledger = new ReadingLedger(join(root, "ledger.sqlite"));
      ledger.freezePrice({
        id: "fixture",
        model: "fixture",
        currency: "CNY",
        source: "synthetic",
        verifiedAt: 1,
        inputMicrosPerMillion: 1000000,
        cachedMicrosPerMillion: 100000,
        outputMicrosPerMillion: 1000000,
      });
      const service = createMultiUserService({
        directory,
        secret,
        shutdownGraceMs: shortGrace ? 1 : 30000,
        reading: {
          credentials: true,
          enabled: false,
          ledger,
          priceId: "fixture",
          modelVersion: "fixture",
          reader: async (f) => readMaterial(f),
          provider: async () => {
            throw Error("unexpected call");
          },
        },
      });
      await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
      try {
        const invitation = service.registry.generate(1)[0],
          base = `http://127.0.0.1:${service.server.address().port}`;
        const cloud = new AccountWorkspace({
          root: join(root, "windows"),
          local: new DesktopStore(join(root, "local")),
          serviceOrigin: base,
          seal: async (s) => Buffer.from(s),
          unseal: async (b) => b.toString(),
          fetcher: async (url, init) => {
            const controller = new AbortController(),
              pending = fetch(url, { ...init, signal: controller.signal });
            while (!service.credentials.hashing)
              await new Promise((done) => setImmediate(done));
            controller.abort();
            return pending;
          },
        });
        await cloud.init();
        await assert.rejects(
          cloud.action("register", {
            username: "drain-user",
            password: "synthetic-password",
            invite: invitation.invite,
          }),
        );
        await new Promise((done) => service.server.close(done));
        await service.drained();
        while (service.credentials.hashing)
          await new Promise((done) => setTimeout(done, 10));
        if (shortGrace)
          assert.equal(
            ledger.db.prepare("SELECT COUNT(*) n FROM reading_wallets").get().n,
            0,
          );
        else assert.equal(ledger.wallet(invitation.userId).granted, 20000000);
        assert.equal(ledger.audit().valid, true);
        const registry = new AccountRegistry(directory, secret);
        try {
          assert.equal(
            registry.db
              .prepare("SELECT COUNT(*) n FROM account_credentials")
              .get().n,
            shortGrace ? 0 : 1,
          );
          assert.equal(
            registry.db
              .prepare("SELECT COUNT(*) n FROM account_grant_intents")
              .get().n,
            shortGrace ? 0 : 1,
          );
        } finally {
          registry.close();
        }
      } finally {
        if (service.server.listening) {
          await new Promise((done) => service.server.close(done));
          await service.drained();
        }
        ledger.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
