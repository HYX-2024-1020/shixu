const { Worker } = require("node:worker_threads");
const path = require("node:path");
function readOffice(bytes, extension) {
  if (
    !["doc", "xls", "ppt"].includes(extension) ||
    bytes.byteLength > 16 * 1024 * 1024
  )
    return Promise.reject(new Error("旧 Office 格式或大小不支持"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "office-worker.cjs"), {
      workerData: { bytes, extension },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      error ? reject(error) : resolve(text);
    };
    const timer = setTimeout(
      () => finish(new Error("旧版 Office 读取超时，请转换为现代格式后投递")),
      30000,
    );
    worker.on("message", (value) =>
      finish(value.error ? new Error(value.error) : null, value.text),
    );
    worker.on("error", (error) => finish(error));
    worker.on("exit", (code) => {
      if (!settled) finish(new Error("Office 读取进程退出，原件已保留"));
    });
  });
}
module.exports = { readOffice };
