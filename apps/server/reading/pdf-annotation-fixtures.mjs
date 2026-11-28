import { pdfObjectsBytes } from "./pdf-font-fixtures.mjs";
const stream=(body,dict='')=>`<< /Length ${Buffer.byteLength(body)} ${dict} >>\nstream\n${body}\nendstream`;
const unicode=s=>'FEFF'+Buffer.from(s,'utf16le').swap16().toString('hex');
export function annotationPdfBytes({rotation=0,crop=false,kind='stamp',contents='合成批注😀',broken=false,flags=4,appearance=true,count=1,pages=1,needAppearances=false,fieldValue,bodyText=''}={}) {
  const widget=['text','choice','checkbox','signature','password'].includes(kind);
  const appearanceBody=broken?'invalid_operator':'1 0 0 rg 0 0 20 10 re f';
  const subtype=widget?'Widget':kind==='link'?'Link':'Stamp';
  const fields=kind==='text'?'/FT /Tx /T (Student) /V (Alice 42) /DA (/Helv 10 Tf 0 g)':kind==='choice'?'/FT /Ch /T (Course) /Opt [(Red) (Blue)] /V (Blue) /DA (/Helv 10 Tf 0 g)':kind==='password'?'/FT /Tx /T (Password) /Ff 8192 /V (never-send-to-model) /DA (/Helv 10 Tf 0 g)':
    kind==='checkbox'?'/FT /Btn /T (Consent) /V /Yes /AS /Yes':kind==='signature'?'/FT /Sig /T (Signature)':'';
  const ap=kind==='link'||!appearance?'':kind==='checkbox'?'/AP << /N << /Yes 7 0 R /Off 8 0 R >> >>':'/AP << /N 7 0 R >>';
  const fieldData=fieldValue===undefined?fields:fields.replace(/\/V \([^)]*\)/,`/V <${unicode(fieldValue)}>`);
  const objects=[
    `<< /Type /Catalog /Pages 2 0 R ${widget?`/AcroForm << /Fields [6 0 R] ${needAppearances?'/NeedAppearances true':''} /DR << /Font << /Helv 4 0 R >> >> >>`:''} >>`,
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 80] /Rotate ${rotation} ${crop?'/CropBox [10 10 110 70]':''} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [${Array(count).fill('6 0 R').join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    stream('0 0 1 rg 0 0 128 80 re f'+(bodyText?` BT /F1 8 Tf 2 70 Td (${bodyText}) Tj ET`:'')),
    `<< /Type /Annot /Subtype /${subtype} /Rect [20 20 60 40] /F ${flags} /Contents <${unicode(contents)}> ${fieldData} ${ap} ${kind==='link'?'/A << /S /URI /URI (https://example.invalid/never-fetch) >>':''} >>`,
    stream(appearanceBody,'/Type /XObject /Subtype /Form /BBox [0 0 20 10] /Resources << >>'),
    stream('','/Type /XObject /Subtype /Form /BBox [0 0 20 10] /Resources << >>'),
  ];
  const kids=['3 0 R'],fieldsList=['6 0 R'];
  for(let n=1;n<pages;n++) {
    const annotation=objects.push(objects[5]);fieldsList.push(`${annotation} 0 R`);
    const page=objects.push(objects[2].replace(/\/Annots \[[^\]]*\]/,`/Annots [${Array(count).fill(annotation+' 0 R').join(' ')}]`));kids.push(`${page} 0 R`);
  }
  objects[1]=`<< /Type /Pages /Count ${pages} /Kids [${kids.join(' ')}] >>`;
  if(widget)objects[0]=objects[0].replace('/Fields [6 0 R]',`/Fields [${fieldsList.join(' ')}]`);
  return pdfObjectsBytes(objects);
}
