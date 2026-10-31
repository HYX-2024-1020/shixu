import { deflateSync } from "node:zlib";

// Project synthetic scans. Pixels are specified independently of PDF.js/Skia;
// 108 dpi maps one input sample to one output pixel, including rotation/crop.
export function scannedPdfBytes(pages) {
  const objects = [],
    put = (b) => (
      objects.push(Buffer.isBuffer(b) ? b : Buffer.from(b)),
      objects.length
    );
  const stream = (bytes, dict = "") =>
    Buffer.concat([
      Buffer.from(`<< /Length ${bytes.length} ${dict} >>\nstream\n`),
      bytes,
      Buffer.from("\nendstream"),
    ]);
  put("<< /Type /Catalog /Pages 2 0 R >>");
  put("");
  const kids = [];
  for (const {
    width,
    height,
    pixels,
    rotation = 0,
    cropBox,
    broken = false,
    jpeg,
  } of pages) {
    const image = put(
      stream(
        jpeg || (broken ? Buffer.from("broken") : deflateSync(pixels)),
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${jpeg ? "DCTDecode" : "FlateDecode"}`,
      ),
    );
    const content = put(
      stream(
        Buffer.from(`q ${width / 1.5} 0 0 ${height / 1.5} 0 0 cm /Scan Do Q`),
      ),
    );
    const page = put(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width / 1.5} ${height / 1.5}] ${cropBox ? `/CropBox [${cropBox.join(" ")}]` : ""} /Rotate ${rotation} /Resources << /XObject << /Scan ${image} 0 R >> >> /Contents ${content} 0 R >>`,
    );
    kids.push(`${page} 0 R`);
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >>`,
  );
  const parts = [Buffer.from("%PDF-1.7\n")],
    offsets = [0];
  let size = parts[0].length;
  for (let n = 0; n < objects.length; n++) {
    offsets.push(size);
    const part = Buffer.concat([
      Buffer.from(`${n + 1} 0 obj\n`),
      objects[n],
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    size += part.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
export function scanPattern(width = 96, height = 60) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      pixels[p] = (x * 17 + y * 3) % 256;
      pixels[p + 1] = (x * 5 + y * 13) % 256;
      pixels[p + 2] = (x * 11 + y * 19) % 256;
    }
  return { width, height, pixels };
}
