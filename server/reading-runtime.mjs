import {
  mkdirSync,
  existsSync,
  lstatSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  createMultiUserService,
  wechatCodeExchange,
} from "./sync-multi-user.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { readingAuthorityFloor } from "./data-versions.mjs";
import { processIdentity } from "./data-control.mjs";
import { createBrokerClient } from "./reading/broker-service.mjs";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "./reading/deepseek.mjs";
import { AdminBackend } from "./admin-backend.mjs";
import { createAdminService } from "./admin-service.mjs";
import { pricePeriod } from "./reading/price-calendar.mjs";

const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};
const invalid = () => { throw Error("READING_RUNTIME_CONFIGURATION_REQUIRED"); };

// Explicit opt-in entry, separate from the unchanged v3 service. Importing this
// module never reads credentials, opens a database or starts a network listener.
export function createReadingRuntime(
  config,
  {
    secret,
    apiKey,
    wechat = null,
    fetcher = fetch,
    now = Date.now,
    admin = null,
    tariffAt = () => config.tariff,
  } = {},
) {
  if (
    !config ||
    Object.keys(config).some(
      (key) =>
        ![
          "directory",
          "ledgerPath",
          "brokerSocket",
          "origin",
          "enabled",
          "pdfVisual",
          "tariff",
          "trustedAuthorityFloor",
          "trustedAccountBaseline",
          "trustedTenantBaselines",
        ].includes(key),
    ) ||
    ![config.directory, config.ledgerPath].every(
      (path) => typeof path === "string" && isAbsolute(path),
    ) ||
    typeof config.enabled !== "boolean" ||
    typeof config.pdfVisual !== "boolean" ||
    typeof secret !== "string" ||
    secret.length < 32
  )
    invalid();
  if (
    Object.hasOwn(config, "trustedAccountBaseline") &&
    (typeof config.trustedAccountBaseline !== "string" ||
      !/^[a-f0-9]{64}$/.test(config.trustedAccountBaseline) ||
      !Array.isArray(config.trustedAuthorityFloor))
  )
    invalid();
  if (Object.hasOwn(config, "trustedTenantBaselines")) {
    const baselines = config.trustedTenantBaselines;
    if (!baselines || typeof baselines !== "object" || Array.isArray(baselines) ||
        !Array.isArray(config.trustedAuthorityFloor) ||
        Object.entries(baselines).some(([account, hash]) =>
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(account) ||
          typeof hash !== "string" ||
          !/^[a-f0-9]{64}$/.test(hash),
      )
    )
      invalid();
  }
  const tariff = config.tariff;
  if (
    !tariff ||
    Object.keys(tariff).sort().join(",") !== "id,validUntil,verifiedAt" ||
    !Number.isSafeInteger(tariff.verifiedAt) ||
    !Number.isSafeInteger(tariff.validUntil) ||
    tariff.verifiedAt < 1 ||
    tariff.validUntil <= tariff.verifiedAt ||
    tariff.validUntil - tariff.verifiedAt > 86400000
  )
    invalid();
  const price = deepseekPriceSnapshots(tariff.verifiedAt).find(
    (row) => row.id === tariff.id,
  );
  if (!price) invalid();
  const priceAt = () => {
    const current=tariffAt();
    if (!current || !Number.isSafeInteger(current.verifiedAt) || !Number.isSafeInteger(current.validUntil) || current.validUntil-current.verifiedAt>86400000 || current.validUntil<=current.verifiedAt || now()<current.verifiedAt || now()>=current.validUntil)
      throw Error("VERIFIED_PRICE_EXPIRED");
    if (
      !deepseekPriceSnapshots(current.verifiedAt).some(
        (p) => p.id === current.id,
      )
    )
      invalid();
    return current.id;
  };
  if (config.enabled) priceAt();
  const reader = createBrokerClient(config.brokerSocket, {
    pdfVisualWindows: config.pdfVisual,
  });
  let provider;
  if (apiKey) provider = createDeepSeekReadingProvider({ apiKey, priceAt, fetcher, now });
  else {
    if (config.enabled) invalid();
    provider = () => { throw Error("AI_DISABLED"); };
  }
  // Independent billing must never be included in a mutable account-data tree.
  const directory = resolve(config.directory), ledgerPath = resolve(config.ledgerPath);
  if (inside(directory, ledgerPath) || inside(dirname(ledgerPath), directory)) invalid();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() ||
      (existsSync(ledgerPath) && (lstatSync(ledgerPath).isSymbolicLink() || !lstatSync(ledgerPath).isFile() || lstatSync(ledgerPath).nlink !== 1))) invalid();
  const realData = realpathSync(directory), realLedgerParent = realpathSync(dirname(ledgerPath));
  if (inside(realData, realLedgerParent) || inside(realLedgerParent, realData)) invalid();
  if (Object.hasOwn(config, "trustedAuthorityFloor")) {
    if (!Array.isArray(config.trustedAuthorityFloor)) invalid();
    readingAuthorityFloor(ledgerPath, config.trustedAuthorityFloor);
  }
  const ledger = new ReadingLedger(ledgerPath, { now });
  let service, adminBackend, adminService;
  try {
    const prior = ledger.db.prepare("SELECT body FROM reading_prices WHERE id=?").get(price.id);
    // Re-verifying the same tariff does not rewrite its immutable price snapshot.
    const frozen = prior ? JSON.parse(prior.body) : price;
    if (
      Object.keys(price).some(
        (key) => key !== "verifiedAt" && price[key] !== frozen[key],
      )
    )
      invalid();
    ledger.freezePrice(frozen);
    for (const other of deepseekPriceSnapshots(tariff.verifiedAt))
      if (other.id !== price.id) {
        const prior = ledger.db
          .prepare("SELECT body FROM reading_prices WHERE id=?")
          .get(other.id);
        ledger.freezePrice(prior ? JSON.parse(prior.body) : other);
      }
    service = createMultiUserService({
      directory,
      secret,
      ...(config.origin ? { origin: config.origin } : {}),
      wechat,
      reading: {
        enabled: config.enabled,
        credentials: true,
        accountSafety: true,
        tenantSafety: true,
        materialNoticeRequired: true,
        requireReconciledAccounts: true,
        ledger,
        reader,
        provider,
        maintenanceAuthorize: ({ actor, operation }) =>
          !!admin &&
          actor === admin.username &&
          operation === "extend-root-time",
        executorIdentity: config.enabled ? processIdentity() : undefined,
        trustedAccountBaseline: config.trustedAccountBaseline,
        trustedTenantBaselines: config.trustedTenantBaselines,
        priceId: price.id,
        modelVersion: price.model,
      },
    });
    if (admin) {
      adminBackend = new AdminBackend({
        path: admin.statePath,
        registry: service.registry,
        credentials: service.credentials,
        ledger,
        routes: service.readingRoutes,
        directory,
        now,
        pricingHealth: () => {
          try {
            priceAt();
            return null;
          } catch (e) {
            return e.message;
          }
        },
      });
      ledger.dispatchGuard = (account) => adminBackend.assertDispatch(account);
      service.setUploadGuard(() => adminBackend.assertUpload());
      adminService = createAdminService({ ...admin, backend: adminBackend });
    }
  } catch (error) { ledger.close(); throw error; }
  let closing;
  const close = () =>
    (closing ||= (async () => {
      await adminService?.close();
      if (service.server.listening) await service.quiesce();
      else {
        await new Promise((done) => {
          service.server.once("close", done);
          service.server.close();
        });
        await service.drained();
      }
      ledger.close();
      adminBackend?.close();
    })());
  return {
    service,
    ledger,
    adminBackend,
    adminService,
    close,
    async listen(port = 8788) {
      if (closing || !Number.isInteger(port) || port < 0 || port > 65535)
        invalid();
      await new Promise((done, reject) => {
        service.server.once("error", reject);
        service.server.listen(port, "127.0.0.1", () => {
          service.server.removeListener("error", reject);
          done();
        });
      });
      if (adminService) await adminService.listen(admin.port || 8789);
      return service.server.address();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.umask(0o077);
  if (!process.env.SYNC_V4_CONFIG || !isAbsolute(process.env.SYNC_V4_CONFIG))
    invalid();
  if (process.env.SHIXU_AUTHORITY_FLOOR) {
    if (!isAbsolute(process.env.SHIXU_AUTHORITY_FLOOR)) invalid();
    const config = JSON.parse(readFileSync(process.env.SYNC_V4_CONFIG, "utf8"));
    readingAuthorityFloor(
      config.ledgerPath,
      JSON.parse(readFileSync(process.env.SHIXU_AUTHORITY_FLOOR, "utf8")),
    );
  }
  const runtime = createReadingRuntime(
    JSON.parse(readFileSync(process.env.SYNC_V4_CONFIG, "utf8")),
    {
      secret: process.env.SYNC_ACCOUNT_SECRET,
      apiKey: process.env.DEEPSEEK_API_KEY,
      tariffAt: () => ({
        ...JSON.parse(readFileSync(process.env.SYNC_V4_CONFIG, "utf8")).tariff,
        id: `deepseek-flash-1017-20261028-${pricePeriod(Date.now())}`,
      }),
      admin: process.env.SHIXU_ADMIN_STATE
        ? {
            statePath: process.env.SHIXU_ADMIN_STATE,
            username: process.env.SHIXU_ADMIN_USERNAME,
            passwordHash: process.env.SHIXU_ADMIN_PASSWORD_HASH,
            origin: process.env.SHIXU_ADMIN_ORIGIN || undefined,
            port: Number(process.env.SHIXU_ADMIN_PORT || 8789),
            staticDirectory: resolve(
              dirname(fileURLToPath(import.meta.url)),
              "../dist",
            ),
          }
        : null,
      wechat:
        process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET
          ? wechatCodeExchange(
              process.env.WECHAT_APP_ID,
              process.env.WECHAT_APP_SECRET,
            )
          : null,
    },
  );
  try {
    await runtime.listen(Number(process.env.SYNC_PORT || 8788));
  } catch (error) {
    await runtime.close();
    throw error;
  }
  const stop = () => {
    runtime.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
