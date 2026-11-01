import { open, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PDF_RESOURCE_CATALOG } from "./pdf-resource-catalog.mjs";

export const PDF_RESOURCE_DIRECTORY = new URL(
  `./generated-pdf-visual/${process.platform}-${process.arch}/resources/`, import.meta.url,
);

// Document-supplied names can select a pinned member only, never form a URL or
// host path. This is PDF.js 6's BinaryDataFactory, not obsolete font factories.
export function createPdfResources() {
  const cache = new Map();
  let failure = false;
  const policy = {
    get failed() { return failure; },
    BinaryDataFactory: class {
      async fetch({ kind, filename }) {
        let handle;
        try {
          const group = kind === "cMapUrl" ? "cmaps" : kind === "standardFontDataUrl" ? "standard_fonts" : null;
          if (!group || typeof filename !== "string" || !/^[A-Za-z0-9_-]+\.(?:bcmap|pfb|ttf)$/.test(filename))
            throw Error();
          const name = `${group}/${filename}`;
          if (!Object.hasOwn(PDF_RESOURCE_CATALOG.files, name)) throw Error();
          if (!cache.has(name)) {
            const expected = PDF_RESOURCE_CATALOG.files[name], path = new URL(name, PDF_RESOURCE_DIRECTORY);
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes) throw Error();
            handle = await open(path, "r");
            if ((await handle.stat()).size !== expected.bytes) throw Error();
            // Fixed-size reads prevent a growing/replaced source from causing
            // an unbounded allocation even before its hash can be checked.
            const data = Buffer.alloc(expected.bytes + 1);
            let size = 0;
            while (size < data.length) {
              const { bytesRead } = await handle.read(data, size, data.length - size, size);
              if (!bytesRead) break;
              size += bytesRead;
            }
            if (size !== expected.bytes || createHash("sha256").update(data.subarray(0,size)).digest("hex") !== expected.sha256)
              throw Error();
            cache.set(name, data.subarray(0,size));
          }
          return Uint8Array.from(cache.get(name));
        } catch {
          failure = true;
          throw Error("PDF_RESOURCE_UNAVAILABLE");
        } finally { await handle?.close(); }
      }
    },
  };
  return policy;
}
