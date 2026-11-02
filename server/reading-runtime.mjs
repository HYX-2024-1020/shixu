import { mkdirSync, existsSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMultiUserService, wechatCodeExchange } from "./sync-multi-user.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { createBrokerClient } from "./reading/broker-service.mjs";
import { createDeepSeekReadingProvider, deepseekPriceSnapshots } from "./reading/deepseek.mjs";

const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};
const invalid = () => { throw Error("READING_RUNTIME_CONFIGURATION_REQUIRED"); };

// Explicit opt-in entry, separate from the unchanged v3 service. Importing this
// module never reads credentials, opens a database or starts a network listener.
export function createReadingRuntime(config, { secret, apiKey, wechat = null, fetcher = fetch, now = Date.now } = {}) {
  if (!config || Object.keys(config).some(key => !["directory", "ledgerPath", "brokerSocket", "origin", "enabled", "pdfVisual", "tariff"].includes(key)) ||
      ![config.directory, config.ledgerPath].every(path => typeof path === "string" && isAbsolute(path)) ||
      typeof config.enabled !== "boolean" || typeof config.pdfVisual !== "boolean" ||
      typeof secret !== "string" || secret.length < 32) invalid();
  const tariff = config.tariff;
  if (!tariff || Object.keys(tariff).sort().join(",") !== "id,validUntil,verifiedAt" ||
      !Number.isSafeInteger(tariff.verifiedAt) || !Number.isSafeInteger(tariff.validUntil) ||
      tariff.verifiedAt < 1 || tariff.validUntil <= tariff.verifiedAt ||
      tariff.validUntil - tariff.verifiedAt > 86400000) invalid();
  const price = deepseekPriceSnapshots(tariff.verifiedAt).find(row => row.id === tariff.id);
  if (!price) invalid();
  const priceAt = () => {
    if (now() < tariff.verifiedAt || now() >= tariff.validUntil) throw Error("VERIFIED_PRICE_EXPIRED");
    return price.id;
  };
  if (config.enabled) priceAt();
  const reader = createBrokerClient(config.brokerSocket, { pdfVisualWindows: config.pdfVisual });
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
  const ledger = new ReadingLedger(ledgerPath, { now });
  let service;
  try {
    const prior = ledger.db.prepare("SELECT body FROM reading_prices WHERE id=?").get(price.id);
    // Re-verifying the same tariff does not rewrite its immutable price snapshot.
    const frozen = prior ? JSON.parse(prior.body) : price;
    if (Object.keys(price).some(key => key !== "verifiedAt" && price[key] !== frozen[key])) invalid();
    ledger.freezePrice(frozen);
    service = createMultiUserService({
      directory, secret, ...(config.origin ? { origin: config.origin } : {}), wechat,
      reading: { enabled: config.enabled, credentials: true, materialNoticeRequired: true, requireReconciledAccounts: true, ledger, reader, provider,
        priceId: price.id, modelVersion: price.model },
    });
  } catch (error) { ledger.close(); throw error; }
  let closing;
  const close = () => closing ||= (async () => {
    if (service.server.listening) await service.quiesce();
    else {
      await new Promise(done => { service.server.once("close", done); service.server.close(); });
      await service.drained();
    }
    ledger.close();
  })();
  return { service, ledger, close, async listen(port = 8788) {
    if (closing || !Number.isInteger(port) || port < 0 || port > 65535) invalid();
    await new Promise((done, reject) => {
      service.server.once("error", reject);
      service.server.listen(port, "127.0.0.1", () => { service.server.removeListener("error", reject); done(); });
    });
    return service.server.address();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  if (!process.env.SYNC_V4_CONFIG || !isAbsolute(process.env.SYNC_V4_CONFIG)) invalid();
  const runtime = createReadingRuntime(JSON.parse(readFileSync(process.env.SYNC_V4_CONFIG, "utf8")), {
    secret: process.env.SYNC_ACCOUNT_SECRET, apiKey: process.env.DEEPSEEK_API_KEY,
    wechat: process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET
      ? wechatCodeExchange(process.env.WECHAT_APP_ID, process.env.WECHAT_APP_SECRET) : null,
  });
  try { await runtime.listen(Number(process.env.SYNC_PORT || 8788)); }
  catch (error) { await runtime.close(); throw error; }
  const stop = () => { runtime.close().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
