import {
  readFile,
  open,
  stat,
  rename,
  chmod,
  chown,
  unlink,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";

export function secretValues(value) {
  if (!value || typeof value !== "object") throw Error("Invalid configuration");
  const result = { SYNC_AI_ENABLED: "false" };
  for (const [key, pattern] of Object.entries({
    DEEPSEEK_API_KEY: /^[A-Za-z0-9_-]{16,256}$/,
    WECHAT_APP_ID: /^wx[a-f0-9]{16}$/,
    WECHAT_APP_SECRET: /^[a-fA-F0-9]{32}$/,
  })) {
    if (!value[key]) continue;
    if (typeof value[key] !== "string" || !pattern.test(value[key]))
      throw Error("Invalid configuration");
    result[key] = value[key];
  }
  return result;
}
export async function updateSecrets(file, input) {
  const values = secretValues(input),
    metadata = await stat(file);
  let content = await readFile(file, "utf8");
  if (!/^SYNC_ACCOUNT_SECRET=.+$/m.test(content))
    values.SYNC_ACCOUNT_SECRET = randomBytes(48).toString("base64url");
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp("^" + name + "=.*$", "gm");
    content = pattern.test(content)
      ? content.replace(pattern, () => name + "=" + value)
      : content.trimEnd() + "\n" + name + "=" + value + "\n";
  }
  const next = file + ".next-" + randomBytes(8).toString("hex");
  const handle = await open(next, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    if (process.platform !== "win32")
      await chown(next, metadata.uid, metadata.gid);
    await chmod(next, 0o640);
    await rename(next, file);
  } catch {
    await handle.close().catch(() => {});
    await unlink(next).catch(() => {});
    throw Error("Configuration was not updated");
  }
  return { configured: Object.keys(values), aiEnabled: false };
}
async function remote() {
  let bytes = "";
  for await (const part of process.stdin) {
    bytes += part;
    if (bytes.length > 4096) throw Error();
  }
  await updateSecrets("/etc/shixu-sync/service.env", JSON.parse(bytes));
  process.stdout.write(
    "配置已保存到服务器。AI 仍关闭，未重启服务，未调用模型。\n",
  );
}
if (process.argv.includes("--stdin-update"))
  remote().catch(() => {
    process.stderr.write(
      "配置未完成；请检查 SSH 权限和输入格式。密钥未显示。\n",
    );
    process.exitCode = 1;
  });
