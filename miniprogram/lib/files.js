const { makeId } = require("./sync-client");
const KEY = "shixu:mini:originals:v1";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const types = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
const extension = (name) => {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : "bin";
};
function createFileLibrary({ read, write, fs, root, newId = makeId }) {
  const saved = read();
  if (saved && (saved.version !== 1 || !Array.isArray(saved.entries)))
    throw new Error("本机原件索引无法读取，请保留资料联系开发者");
  let entries = saved ? JSON.parse(JSON.stringify(saved.entries)) : [];
  const volatile = new Map();
  const commit = (next) => {
    const durable = next.filter((e) => !e.volatile);
    if (
      JSON.stringify(durable) !==
      JSON.stringify(entries.filter((e) => !e.volatile))
    )
      write({ version: 1, entries: durable });
    entries = JSON.parse(JSON.stringify(next));
  };
  const safePath = (id, name) => {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error("附件 ID 无效");
    return `${root}/${id}.${extension(name)}`;
  };
  const checkPath = (entry) => {
    if (entry.volatile && volatile.has(entry.id)) return;
    if (entry.path !== safePath(entry.diskId || entry.id, entry.name))
      throw new Error("原件路径无效，本机资料已保留");
  };
  const ensure = () => {
    try {
      fs.accessSync(root);
    } catch {
      fs.mkdirSync(root, true);
    }
  };
  const basic = (entry) => ({
    id: entry.id,
    name: entry.name,
    size: entry.size,
    type: entry.type,
  });
  const key = (e) => `${e.space}|${e.packetId}|${e.id}`;
  const confirmation = (entry, remote) => {
    if (
      !remote ||
      remote.id !== entry.id ||
      remote.name !== entry.name ||
      remote.size !== entry.size ||
      remote.type !== entry.type ||
      !/^[a-f\d]{64}$/.test(remote.hash)
    )
      throw new Error("原件上传确认不完整，原件保留待重试");
    return { ...basic(remote), hash: remote.hash };
  };
  return {
    entries: (packetId, space) =>
      entries
        .filter(
          (e) =>
            (!packetId || e.packetId === packetId) &&
            (space === undefined || e.space === space),
        )
        .map((e) => ({ ...e })),
    add(source, packetId, space = "draft") {
      const name = String(
        source.name ||
          source.originalFileName ||
          `图片.${extension(source.tempFilePath || source.path || "image.jpg")}`,
      );
      if (!name.trim() || name.length > 200 || /[\x00-\x1f\x7f\\/]/.test(name))
        throw new Error("文件名无效");
      if (!source.size || source.size > MAX_FILE_BYTES)
        throw new Error("请选择非空且不超过 10 MB 的原件");
      if (
        entries.filter((e) => e.packetId === packetId && e.space === space)
          .length >= 20
      )
        throw new Error("一次投递最多 20 份原件");
      const id = newId(),
        path = safePath(id, name);
      const entry = {
        id,
        diskId: id,
        packetId,
        space,
        name,
        size: source.size,
        type: types[extension(name)] || "application/octet-stream",
        path,
        remote: null,
      };
      try {
        ensure();
        fs.copyFileSync(source.path || source.tempFilePath, path);
        if (fs.statSync(path).size !== source.size)
          throw Error("原件未完整保存，请重新选择");
        commit([...entries, entry]);
      } catch (e) {
        let bytes;
        try {
          bytes = fs.readFileSync(source.path || source.tempFilePath);
        } catch {
          throw e;
        }
        if (
          bytes.byteLength !== source.size ||
          [...volatile.values()].reduce((n, b) => n + b.byteLength, 0) +
            bytes.byteLength >
            20 * 1024 * 1024
        )
          throw e;
        volatile.set(entry.id, bytes);
        entry.volatile = true;
        entries = [...entries, entry];
      }
      return { ...basic(entry), localSaved: !entry.volatile };
    },
    metadata: basic,
    confirmation,
    forgetPacket(packetId, space) {
      const removed = entries.filter(
        (e) => e.packetId === packetId && e.space === space,
      );
      if (!removed.length) return;
      const remaining = entries.filter(
        (e) => !(e.packetId === packetId && e.space === space),
      );
      for (const entry of removed) {
        checkPath(entry);
        if (remaining.some((e) => e.path === entry.path)) continue;
        let exists = true;
        try {
          fs.accessSync(entry.path);
        } catch {
          exists = false;
        }
        if (exists) fs.unlinkSync(entry.path);
      }
      // A failed manifest write leaves purge references for another cleanup attempt.
      commit(remaining);
      for (const entry of removed)
        if (!remaining.some((e) => e.id === entry.id)) {
          const bytes = volatile.get(entry.id);
          if (bytes?.fill) bytes.fill(0);
          volatile.delete(entry.id);
        }
    },
    assign(packetId, space, draftSpace = "draft") {
      commit(
        entries.map((e) =>
          e.packetId === packetId && e.space === draftSpace
            ? { ...e, space }
            : e,
        ),
      );
    },
    copySpace(packetId, from, to) {
      const additions = entries
        .filter((e) => e.packetId === packetId && e.space === from)
        .map((e) => ({ ...e, space: to, remote: null }));
      commit([
        ...entries,
        ...additions.filter((e) => !entries.some((old) => key(old) === key(e))),
      ]);
    },
    markUploaded(entry, remote) {
      remote = confirmation(entry, remote);
      commit(
        entries.map((e) => (key(e) === key(entry) ? { ...e, remote } : e)),
      );
    },
    bytes(entry) {
      checkPath(entry);
      const bytes = volatile.get(entry.id) || fs.readFileSync(entry.path);
      if (
        (bytes.byteLength === undefined ? bytes.length : bytes.byteLength) !==
        entry.size
      )
        throw new Error("本机原件缺失或不完整，请保留资料后核对");
      return bytes;
    },
    path(entry) {
      checkPath(entry);
      if (entry.volatile)
        throw Error("本机原件尚未保存，可在本次会话上传；请重新选择以预览");
      if (fs.statSync(entry.path).size !== entry.size)
        throw new Error("本机原件不完整");
      return entry.path;
    },
    cache(file, packetId, space, bytes) {
      if (bytes.byteLength !== file.size || file.size > MAX_FILE_BYTES)
        throw new Error("下载原件不完整，未替换本机原件");
      const diskId = newId(),
        path = safePath(diskId, file.name);
      ensure();
      fs.writeFileSync(path, bytes);
      const entry = {
        ...basic(file),
        diskId,
        packetId,
        space,
        path,
        remote: file,
      };
      commit([...entries.filter((e) => key(e) !== key(entry)), entry]);
      return path;
    },
    removeDraft(id, packetId, draftSpace = "draft") {
      // Only remove the manifest reference. Original bytes are retained for recovery.
      commit(
        entries.filter(
          (e) =>
            !(e.id === id && e.packetId === packetId && e.space === draftSpace),
        ),
      );
    },
  };
}
function createFileTransport(
  base,
  getToken,
  runtime = wx,
  protocolVersion = 2,
) {
  function request(method, url, data, header = {}) {
    return new Promise((resolve, reject) =>
      runtime.request({
        url:
          base +
          (protocolVersion === 3
            ? url.replace(/^\/api\/v2\//, "/api/v3/")
            : url),
        method,
        ...(data ? { data } : {}),
        responseType: method === "GET" ? "arraybuffer" : "text",
        timeout: 60000,
        header: { Authorization: `Bearer ${getToken()}`, ...header },
        success(response) {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(
              `原件请求失败（${response.statusCode}），本机原件已保留`,
            );
            error.status = response.statusCode;
            // Keep the machine reason for action replay without reflecting an
            // arbitrary response body into the UI or losing local originals.
            try {
              const payload =
                typeof response.data === "string"
                  ? JSON.parse(response.data)
                  : response.data;
              if (
                typeof payload?.code === "string" &&
                /^[A-Z_]{1,80}$/.test(payload.code)
              )
                error.code = payload.code;
            } catch {
              /* The HTTP status remains authoritative. */
            }
            reject(error);
            return;
          }
          if (method === "GET") {
            resolve(response.data);
            return;
          }
          try {
            resolve(
              typeof response.data === "string"
                ? JSON.parse(response.data)
                : response.data,
            );
          } catch {
            reject(new Error("原件上传确认无效，请保留本机原件后重试"));
          }
        },
        fail() {
          reject(new Error("原件暂时传不上去，本机原件已保留"));
        },
      }),
    );
  }
  return {
    verifyOriginal: (packetId, entry, bytes) =>
      request(
        "PUT",
        `/api/v4/originals/${packetId}/${entry.id}/verify`,
        bytes,
        { "Content-Type": "application/octet-stream" },
      ),
    uploadSubmission: (submissionId, entry, bytes) =>
      request(
        "PUT",
        `/api/v4/submissions/${submissionId}/files/${entry.id}`,
        bytes,
        { "Content-Type": "application/octet-stream" },
      ),
    upload: (entry, bytes, epoch) =>
      request(
        "PUT",
        `/api/v2/attachments/${entry.packetId}/${entry.id}?epoch=${encodeURIComponent(epoch)}`,
        bytes,
        {
          "Content-Type": "application/octet-stream",
          "X-Shixu-File-Name": encodeURIComponent(entry.name),
          "X-Shixu-File-Type": entry.type,
        },
      ),
    download: (packetId, id, epoch) =>
      request(
        "GET",
        `/api/v2/attachments/${packetId}/${id}?epoch=${encodeURIComponent(epoch)}`,
      ),
  };
}
module.exports = {
  KEY,
  MAX_FILE_BYTES,
  extension,
  createFileLibrary,
  createFileTransport,
};
