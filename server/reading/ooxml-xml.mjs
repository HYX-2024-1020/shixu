import sax from "sax";
const { parser } = sax;
const fail = (code) => {
  throw Error(code);
};
function decode(bytes, prefix) {
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const declared = text
      .match(/^\s*<\?xml[^?]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]
      .toLowerCase();
    if (
      declared &&
      !(encoding === "utf-8"
        ? ["utf-8", "utf8"].includes(declared)
        : ["utf-16", encoding].includes(declared))
    )
      fail(prefix + "_XML_ENCODING");
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail(prefix + "_XML_UNSAFE");
    return text;
  } catch (e) {
    if (e.message === prefix + "_XML_UNSAFE") throw e;
    fail(prefix + "_XML_ENCODING");
  }
}
export function parseXml(
  bytes,
  open,
  close = () => {},
  text = () => {},
  prefix = "DOCX",
) {
  const p = parser(true, {
    xmlns: true,
    strictEntities: true,
    trim: false,
    normalize: false,
  });
  let depth = 0;
  p.ondoctype = () => fail(prefix + "_XML_UNSAFE");
  p.onerror = () => fail(prefix + "_XML_MALFORMED");
  p.onopentag = (node) => {
    if (++depth > 128) fail(prefix + "_XML_DEPTH");
    open(node);
  };
  p.onclosetag = () => {
    close();
    depth--;
  };
  p.ontext = text;
  p.oncdata = text;
  p.write(decode(bytes, prefix)).close();
}
