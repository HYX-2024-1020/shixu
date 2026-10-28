import { spawn } from "node:child_process";
import { mkdtemp, mkdir, chown, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  createBrokerService,
  createBrokerClient,
} from "../server/reading/broker-service.mjs";
import { createMultiUserService } from "../server/sync-multi-user.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
const root = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(root)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDirectory = "/run/shixu-bcd-v4-session",
  staging = "/run/shixu-bcd-v4-session-input";
if (process.argv[3] === "client") {
  if (process.getuid() !== 65534) throw Error("SYNTHETIC_UID_REQUIRED");
  const directory = process.argv[4],
    ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic isolated UI session",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  let calls = 0;
  const service = createMultiUserService({
    directory: join(directory, "server"),
    secret: "synthetic-remote-session-secret-32-characters",
    wechat: async (code) => "synthetic-" + code,
    reading: {
      ledger,
      enabled: true,
      reader: createBrokerClient(socketDirectory + "/reader.sock"),
      priceId: "synthetic",
      modelVersion: "synthetic/1",
      provider: async (sources, signal) => {
        if (++calls === 1)
          await new Promise((done) =>
            signal.addEventListener("abort", () => setTimeout(done, 30), {
              once: true,
            }),
          );
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: {
            summary: "合成Linux整理",
            warnings: [],
            items: [
              {
                kind: "note",
                title: "服务器原件整理事项",
                summary: "合成资料与来源",
                facts: [],
                nextSteps: [],
                uncertainties: [],
                due: null,
                evidence: [
                  {
                    sourceId: sources[0].id,
                    quote: sources[0].text.slice(0, 10),
                  },
                ],
              },
            ],
          },
        };
      },
    },
  });
  const invitation = service.registry.generate(1)[0];
  ledger.grantInitial(invitation.userId);
  service.registry.limits(invitation.userId, { requestsPerMinute: 1000 });
  await new Promise((done) => service.server.listen(18884, "127.0.0.1", done));
  console.log(
    JSON.stringify({ synthetic: true, port: 18884, invite: invitation.invite }),
  );
  process.once("SIGTERM", () =>
    service.server.close(async () => {
      await service.drained();
      ledger.close();
      process.exit(0);
    }),
  );
} else {
  if (process.getuid() !== 0) throw Error("ROOT_REQUIRED");
  await mkdir(socketDirectory, { mode: 0o750 });
  await chown(socketDirectory, 0, 65534);
  await mkdir(staging, { mode: 0o700 });
  const directory = await mkdtemp(join(root, "remote-session-"));
  await chown(directory, 65534, 65534);
  const broker = await createBrokerService({
    socketPath: socketDirectory + "/reader.sock",
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const child = spawn(
    process.execPath,
    [process.argv[1], root, "client", directory],
    {
      cwd: root,
      uid: 65534,
      gid: 65534,
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
  };
  process.stdin.resume();
  process.stdin.on("data", stop);
  process.stdin.on("end", stop);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  child.once("exit", async (code) => {
    await new Promise((done) => broker.close(done));
    await rm(directory, { recursive: true, force: true });
    await rm(socketDirectory, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
    process.exit(code || 0);
  });
}
