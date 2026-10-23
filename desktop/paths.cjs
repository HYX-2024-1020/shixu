const path = require("node:path");
function resolveAsset(root, input) {
  try {
    const url = new URL(input);
    if (url.protocol !== "shixu:" || url.hostname !== "app") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\\") || pathname.includes("\0")) return null;
    const file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    const relative = path.relative(root, file);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? file
      : null;
  } catch {
    return null;
  }
}
module.exports = { resolveAsset };
