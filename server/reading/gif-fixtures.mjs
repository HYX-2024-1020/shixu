// Project-authored minimal literal/clear-code writer; advanced dictionary-width
// goldens are independently encoded and composited by Pillow in fixtures/.
const palette = Buffer.from([255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255]);
function subBlocks(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 255)
    parts.push(
      Buffer.from([Math.min(255, bytes.length - i)]),
      bytes.subarray(i, i + 255),
    );
  return Buffer.concat([...parts, Buffer.from([0])]);
}
export function gifBytes({
  width = 9,
  height = 11,
  frames = [{}],
  version = "GIF89a",
} = {}) {
  const header = Buffer.alloc(13);
  header.write(version);
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0x81;
  const parts = [header, palette];
  for (const [index, frame] of frames.entries()) {
    const w = frame.width || width,
      h = frame.height || height,
      values =
        frame.indices ||
        Buffer.from(Array.from({ length: w * h }, (_, i) => (i + index) % 4));
    const gce = Buffer.from([
      0x21,
      0xf9,
      4,
      ((frame.disposal || 1) << 2) | (frame.transparent !== undefined ? 1 : 0),
      0,
      0,
      frame.transparent || 0,
      0,
    ]);
    gce.writeUInt16LE(frame.delay ?? index + 1, 4);
    parts.push(gce);
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(frame.x || 0, 1);
    descriptor.writeUInt16LE(frame.y || 0, 3);
    descriptor.writeUInt16LE(w, 5);
    descriptor.writeUInt16LE(h, 7);
    descriptor[9] = frame.interlace ? 64 : 0;
    const ordered = frame.interlace ? [] : Array.from(values);
    if (frame.interlace)
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let y = start; y < h; y += step)
          for (let x = 0; x < w; x++) ordered.push(values[y * w + x]);
    const codes = ordered.flatMap((v) => [4, v]);
    codes.push(5);
    const data = Buffer.alloc(Math.ceil((codes.length * 3) / 8));
    let bit = 0;
    for (const code of codes) {
      for (let b = 0; b < 3; b++)
        data[(bit + b) >>> 3] |= ((code >>> b) & 1) << ((bit + b) & 7);
      bit += 3;
    }
    parts.push(descriptor, Buffer.from([2]), subBlocks(data));
  }
  return Buffer.concat([...parts, Buffer.from([0x3b])]);
}
