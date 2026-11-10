import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  bundle = resolve(process.argv[2] || "");
if (
  process.platform !== "win32" ||
  !bundle.startsWith(join(root, ".private") + "\\")
)
  throw Error("PRIVATE_WINDOWS_BUNDLE_REQUIRED");
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw Error("CLEAN_COMMITTED_SOURCE_REQUIRED");
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const metadata = JSON.parse(readFileSync(join(bundle, "delivery.json")));
if (metadata.pairingRequired) throw Error("LOCAL_AUTHORIZED_BUNDLE_REQUIRED");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checker = join(bundle, "verify-user-install.mjs");
copyFileSync(join(root, "deploy/windows/verify-user-install.mjs"), checker);
const files = metadata.files.map((f) => ({
  ...f,
  source: join(bundle, "payload", f.group, f.path),
}));
files.push({
  group: "console",
  path: "verify-user-install.mjs",
  source: checker,
  sha256: hash(readFileSync(checker)),
});
const note = join(
  process.env.LOCALAPPDATA,
  "Shixu/Connection/Account-Setup.txt",
);
if (existsSync(note))
  files.push({
    group: "connection",
    path: "Account-Setup.txt",
    source: note,
    sha256: hash(readFileSync(note)),
  });
for (const f of files)
  if (hash(readFileSync(f.source)) !== f.sha256) throw Error("PAYLOAD_CHANGED");
const data = {
  ...metadata,
  runtime: {},
  sourceRevision: source,
  files: files.map(({ source, ...f }) => f),
};
const manifest = join(bundle, "native-delivery.json");
writeFileSync(manifest, JSON.stringify(data, null, 2));
const compiler =
  process.argv[3] ||
  join(
    process.env.LOCALAPPDATA,
    "electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe",
  );
const exe = join(bundle, "Install-Shixu-Console.exe");
if (existsSync(exe)) throw Error("NEW_NATIVE_OUTPUT_REQUIRED");
const quote = (s) =>
  '"' + s.replaceAll("$", "$$").replaceAll('"', '$\\"') + '"';
const node = files.find(
  (f) => f.path === "releases/" + metadata.release + "/node.exe",
)?.source;
if (!node) throw Error("NODE_PAYLOAD_REQUIRED");
const lines = [
  "Unicode true",
  '!include "MUI2.nsh"',
  'Name "拾序控制台安装修复"',
  "OutFile " + quote(exe),
  "RequestExecutionLevel user",
  "SetCompressor /SOLID lzma",
  "ShowInstDetails show",
  "!insertmacro MUI_PAGE_INSTFILES",
  '!insertmacro MUI_LANGUAGE "SimpChinese"',
  'Section "Install"',
  "System::Call 'kernel32::GetCurrentPackageFullName(*i 0, p 0) i .r0'",
  "IntCmp $0 15700 physical_user",
  'MessageBox MB_ICONSTOP "请从 Windows 桌面运行本安装程序，不能在工具应用的私有环境中安装。"',
  "Abort",
  "physical_user:",
  "SetShellVarContext current",
  "InitPluginsDir",
  'SetOutPath "$PLUGINSDIR"',
  "File /oname=node.exe " + quote(node),
  "File /oname=verify-user-install.mjs " + quote(checker),
  "File /oname=native-delivery.json " + quote(manifest),
  'nsExec::ExecToLog \'"$PLUGINSDIR\\node.exe" "$PLUGINSDIR\\verify-user-install.mjs" --preflight "$PLUGINSDIR\\native-delivery.json"\'',
  "Pop $0",
  "${If} $0 != 0",
  'MessageBox MB_ICONSTOP "安装环境检查失败，请将安装窗口中的错误发给维护者。"',
  "Abort",
  "${EndIf}",
];
for (const f of files) {
  const target =
    "$LOCALAPPDATA\\Shixu\\" +
    (f.group === "console" ? "AdminConsole" : "Connection") +
    "\\" +
    f.path.replaceAll("/", "\\");
  lines.push(
    'SetOutPath "' + dirname(target) + '"',
    "File /oname=" + basename(target) + " " + quote(f.source),
  );
}
lines.push(
  'SetOutPath "$LOCALAPPDATA\\Shixu\\AdminConsole"',
  "File /oname=native-delivery.json " + quote(manifest),
  'CreateShortCut "$DESKTOP\\拾序管理控制台.lnk" "$SYSDIR\\wscript.exe" \'"$LOCALAPPDATA\\Shixu\\AdminConsole\\Cloud-Start.vbs"\' "$LOCALAPPDATA\\Shixu\\AdminConsole\\console-xu-v1.ico"',
  "nsExec::ExecToLog '\"$LOCALAPPDATA\\Shixu\\AdminConsole\\releases\\" +
    metadata.release +
    '\\node.exe" "$LOCALAPPDATA\\Shixu\\AdminConsole\\verify-user-install.mjs" --verify "$LOCALAPPDATA\\Shixu\\AdminConsole\\native-delivery.json"\'',
  "Pop $0",
  "${If} $0 != 0",
  'MessageBox MB_ICONSTOP "安装文件检查或云连接失败，请将安装窗口中的错误发给维护者。"',
  "Abort",
  "${EndIf}",
  'MessageBox MB_OK "安装完成。请从桌面打开拾序管理控制台。"',
  "SectionEnd",
);
const nsi = join(bundle, "native-install.nsi");
writeFileSync(nsi, "\ufeff" + lines.join("\r\n"));
execFileSync(compiler, ["/V2", nsi], { stdio: "inherit", timeout: 300000 });
console.log(
  JSON.stringify({
    installer: realpathSync.native(exe),
    sha256: hash(readFileSync(exe)),
    files: files.length,
    source,
    containsPrivateConnection: true,
  }),
);
