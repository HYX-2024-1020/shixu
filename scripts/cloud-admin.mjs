import { CloudOperations } from "../server/cloud-operations.mjs";
import { randomUUID } from "node:crypto";
// Protected host fallback; never accepts a command or destination from HTTP.
if (
  process.getuid?.() !== 0 ||
  process.env.SHIXU_ADMIN_STATE !==
    "/var/lib/shixu-cloud-ledger/operations.sqlite"
)
  throw Error("HOST_ADMIN_REQUIRED");
process.umask(0o077);
const ops = new CloudOperations(process.env.SHIXU_ADMIN_STATE);
try {
  const [command, kind, target, reason] = process.argv.slice(2);
  if (command === "status")
    console.log(
      JSON.stringify(
        {
          maintenance: ops.maintenance(),
          jobs: ops.jobs(),
          inventory: ops.inventory(),
        },
        null,
        2,
      ),
    );
  else if (command === "queue") {
    const args = ["restore", "rollback"].includes(kind)
      ? {
          reason,
          ...(kind === "restore"
            ? { snapshotId: target }
            : { releaseId: target }),
        }
      : { reason: target };
    console.log(
      JSON.stringify(
        ops.request(kind, args, "host-" + randomUUID(), "host-cli"),
      ),
    );
  } else
    throw Error(
      "Usage: status | queue backup|cleanup|restart|resume REASON | queue restore|rollback ID REASON",
    );
} finally {
  ops.close();
}
