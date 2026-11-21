const prepared = new Set();

function localSkinAsset(runtime, source, name) {
  if (!runtime.env?.USER_DATA_PATH || !runtime.getFileSystemManager) return source;
  const target = `${runtime.env.USER_DATA_PATH}/shixu-skin-${name}`;
  if (!prepared.has(target)) {
    const fs = runtime.getFileSystemManager();
    fs.writeFileSync(target, fs.readFileSync(source));
    prepared.add(target);
  }
  return target;
}

// Keep room for eight images in the existing skin collection.
const MAX_BASE64 = 240000;

async function prepareSkinImage(runtime, source, canvasForImage) {
  const call = (method, options) => new Promise((success, fail) =>
    runtime[method]({ ...options, success, fail }));
  const fs = runtime.getFileSystemManager();
  const read = async (filePath) => {
    if (fs.statSync(filePath).size * 4 / 3 > MAX_BASE64) return "";
    const { data } = await new Promise((success, fail) =>
      fs.readFile({ filePath, encoding: "base64", success, fail }));
    const type = data.startsWith("iVBORw0KGgo") ? "png"
      : data.startsWith("/9j/") ? "jpeg"
      : /^UklGR.{6}XRUJQ/.test(data) ? "webp" : "";
    return type && data.length <= MAX_BASE64 ? `data:image/${type};base64,${data}` : "";
  };
  let info;
  try {
    info = await call("getImageInfo", { src: source });
  } catch {
    if (!runtime.compressImage) throw Error("这张图片无法读取");
    const { tempFilePath } = await call("compressImage", { src: source, quality: 80, compressedWidth: 640 });
    source = tempFilePath;
    info = await call("getImageInfo", { src: source });
  }
  if (!info.width || !info.height) throw Error("这张图片无法读取");
  if (Math.max(info.width, info.height) <= 720) {
    const ready = await read(source);
    if (ready) return ready;
  }
  const preserveAlpha = ["png", "webp", "gif"].includes(info.type?.toLowerCase());
  if (!preserveAlpha && runtime.compressImage) {
    try {
      const bounds = info.width >= info.height ? { compressedWidth: 640 } : { compressedHeight: 640 };
      const { tempFilePath } = await call("compressImage", { src: source, quality: 80, ...bounds });
      const ready = await read(tempFilePath);
      if (ready) return ready;
    } catch {
      // The canvas also converts formats the native compressor cannot write.
    }
  }
  const canvas = await canvasForImage();
  if (!canvas) throw Error("这张图片无法转换，请换一张试试");
  const image = canvas.createImage();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = info.path || source;
  });
  if (!image.width || !image.height) throw Error("这张图片无法读取");
  for (const edge of [640, 480, 320, 200]) {
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const { tempFilePath } = await call("canvasToTempFilePath", {
      canvas, fileType: preserveAlpha ? "png" : "jpg", quality: 0.84,
      width: canvas.width, height: canvas.height,
      destWidth: canvas.width, destHeight: canvas.height,
    });
    const ready = await read(tempFilePath);
    if (ready) return ready;
  }
  throw Error("这张图片处理后仍然太大，请换一张试试");
}

module.exports = { localSkinAsset, prepareSkinImage };
