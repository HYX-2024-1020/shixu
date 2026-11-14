const { statSync, createReadStream } = require("node:fs");
const { Readable } = require("node:stream");
const { extname } = require("node:path");
const types = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "video/webm", ".mp4": "video/mp4", ".ogg": "audio/ogg" };
function mediaType(file) { return types[extname(file).toLowerCase()]; }
// Chromium seeks compressed audio/video using byte ranges. Forwarding only
// the URL to file: discards Range and can restart decoding at the wrong byte.
function mediaResponse(file, request) {
  let stat;
  try { stat = statSync(file); } catch { return new Response(null, { status: 404 }); }
  if (!stat.isFile()) return new Response(null, { status: 404 });
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
  const headers = { "Content-Type": mediaType(file), "Accept-Ranges": "bytes" };
  let start = 0, end = stat.size - 1, status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    if (!match || (!match[1] && !match[2]) || !stat.size) return invalid();
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) return invalid();
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers["Content-Length"] = String(Math.max(0, end - start + 1));
  const body = request.method === "HEAD" || !stat.size ? null : Readable.toWeb(createReadStream(file, { start, end }));
  return new Response(body, { status, headers });
}
module.exports = { mediaType, mediaResponse };
