const prepared = new Set();

function packedWebp(source, name) {
  const target = `${wx.env.USER_DATA_PATH}/shixu-skin-${name}.webp`;
  if (!prepared.has(target)) {
    const fs = wx.getFileSystemManager();
    // WeChat's packager drops .webp files. Restore the original bytes from
    // the packaged binary before handing the path to the image decoder.
    fs.writeFileSync(target, fs.readFileSync(source));
    prepared.add(target);
  }
  return target;
}

module.exports = { packedWebp };
