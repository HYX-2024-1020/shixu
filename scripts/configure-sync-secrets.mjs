import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { secretValues } from "../deploy/sync/configure-secrets.mjs";

function hidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error("请在本机 PowerShell 交互终端运行此命令");
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.removeListener("data", receive);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const receive = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          finish(Error("已取消，未提交配置"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (/^[A-Za-z0-9_-]$/.test(character) && value.length < 256) {
          value += character;
          process.stdout.write("*");
        }
      }
    };
    process.stdin.on("data", receive);
  });
}
try {
  console.log(
    "密钥只通过加密 SSH 发往 shixu-ecs，不存到本机文件、命令参数或 Git。回车跳过某项，保留服务器已有配置。",
  );
  const DEEPSEEK_API_KEY = await hidden("DeepSeek API Key（粘贴后回车）：");
  const WECHAT_APP_SECRET = await hidden("微信 AppSecret（粘贴后回车）：");
  if (!DEEPSEEK_API_KEY && !WECHAT_APP_SECRET)
    throw Error("未填写密钥，未提交配置");
  const project = JSON.parse(
    await readFile(
      new URL("../miniprogram/project.config.json", import.meta.url),
      "utf8",
    ),
  );
  const values = secretValues({
    DEEPSEEK_API_KEY,
    WECHAT_APP_SECRET,
    WECHAT_APP_ID: project.appid,
  });
  const program = await readFile(
    new URL("../deploy/sync/configure-secrets.mjs", import.meta.url),
    "utf8",
  );
  const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
  const child = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "shixu-ecs",
      "node --input-type=module -e " + quote(program) + " -- --stdin-update",
    ],
    { stdio: ["pipe", "inherit", "inherit"], windowsHide: true },
  );
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(values));
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(Error("SSH 无法启动")));
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("服务器配置未完成")),
    );
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
