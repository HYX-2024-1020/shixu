import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { AccountRegistry } from "./sync-accounts.mjs";

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
  [resolve(process.argv[1]), realpathSync(process.argv[1])].some(
    (path) => import.meta.url === pathToFileURL(path).href,
  )
) {
  process.umask(0o077);
  const registry = new AccountRegistry(
    resolve(process.env.SYNC_ACCOUNT_DIR || "data/accounts-v3"),
    process.env.SYNC_ACCOUNT_SECRET,
  );
  try {
    console.log(
      JSON.stringify(runAdmin(registry, process.argv.slice(2)), null, 2),
    );
  } finally {
    registry.close();
  }
}
