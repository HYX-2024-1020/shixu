// Project-authored PDF containers and text; no external document or font copy.
export const BASE14_FONTS = [
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Symbol", "ZapfDingbats",
];
export function fontPdfBytes({ baseFont="Helvetica", text="Hello 0123 PDF", cmap=false, pages=1 }={}) {
  if(!Number.isInteger(pages)||pages<1||pages>16)throw Error('FIXTURE_PAGES');
  const content = cmap ? "BT /F1 24 Tf 10 24 Td <4e2d6587> Tj ET" : `BT /F1 24 Tf 10 24 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 256 72] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    cmap ? "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>" :
      `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} ${["Symbol","ZapfDingbats"].includes(baseFont)?"":"/Encoding /WinAnsiEncoding"} >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...(cmap ? ["<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>"] : []),
  ];
  const kids=['3 0 R'];
  for(let i=1;i<pages;i++){objects.push(objects[2]);kids.push(`${objects.length} 0 R`);}
  objects[1]=`<< /Type /Pages /Count ${pages} /Kids [${kids.join(' ')}] >>`;
  return pdfObjectsBytes(objects);
}
export function pdfObjectsBytes(objects) {
  const parts=[Buffer.from("%PDF-1.7\n")], offsets=[0]; let size=parts[0].length;
  for(const [i,object] of objects.entries()) {
    offsets.push(size);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),Buffer.isBuffer(object)?object:Buffer.from(object),Buffer.from('\nendobj\n')]);parts.push(b);size+=b.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(parts);
}
