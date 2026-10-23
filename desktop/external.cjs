function externalWebUrl(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
module.exports = { externalWebUrl };
