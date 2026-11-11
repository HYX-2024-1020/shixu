import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync, readFileSync, existsSync } from "node:fs";
import { AccountRegistry } from "./sync-accounts.mjs";
import {acquireDataLease,resolveDataVersion,readingAuthorityFloor} from './data-versions.mjs';
import { ReadingLedger } from './reading/ledger.mjs';
import { AccountsV4 } from './accounts-v4.mjs';
import { AccountSafety } from './account-safety.mjs';

// Local privileged CLI only; no administrator credential or endpoint in clients.
// Run as the service user/root with the private environment file, never place
// secrets in command arguments. Invitations are printed once to the operator.
export function runAdmin(registry, [command, userId, argument, amount]) {
  switch (command) {
    case "generate":
      return registry.generate(userId === undefined ? 20 : Number(userId));
    case "disable":
      registry.enable(userId, false);
      return { ok: true };
    case "enable":
      registry.enable(userId, true);
      return { ok: true };
    case "revoke":
      registry.revoke(userId, argument);
      return { ok: true };
    case "limit":
      registry.limits(userId, { [argument]: Number(amount) });
      return { ok: true };
    case "usage":
      return registry.usage(userId);
    case "ai-pause":
      registry.pauseAI(true);
      return { ok: true };
    case "ai-resume":
      registry.pauseAI(false);
      return { ok: true };
    default:
      throw Error(
        "Usage: generate [20] | disable USER | enable USER | revoke USER windows|wechat | limit USER dailyJobs|requestsPerMinute|storageBytes VALUE | usage USER",
      );
  }
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  [resolve(process.argv[1]), realpathSync(process.argv[1])].some(
    (path) => import.meta.url === pathToFileURL(path).href,
  )
) {
  process.umask(0o077);
  const config=process.env.SYNC_V4_CONFIG?JSON.parse(readFileSync(process.env.SYNC_V4_CONFIG,'utf8')):null;
  let ledger,credentials;
  if(config){
    const floorPath=process.env.SHIXU_AUTHORITY_FLOOR||'/var/lib/shixu-cloud-authority/latest.json';
    const floor=existsSync(floorPath)?JSON.parse(readFileSync(floorPath,'utf8')):config.trustedAuthorityFloor;
    if(!Array.isArray(floor))throw Error('CURRENT_AUTHORITY_FLOOR_REQUIRED');
    readingAuthorityFloor(config.ledgerPath,floor);
    ledger=new ReadingLedger(config.ledgerPath);ledger.audit();
  }
  const lease=acquireDataLease(resolve(config?.directory||process.env.SYNC_ACCOUNT_DIR || "data/accounts-v3"));
  let registry;
  try {
    registry=new AccountRegistry(resolveDataVersion(lease,{ledgerPath:config?.ledgerPath}).directory,process.env.SYNC_ACCOUNT_SECRET);
    if(ledger){credentials=new AccountsV4(registry);new AccountSafety(registry,ledger);}
    console.log(
      JSON.stringify(runAdmin(registry, process.argv.slice(2)), null, 2),
    );
  } finally {
    credentials?.close();registry?.close();ledger?.close();lease.release();
  }
}
