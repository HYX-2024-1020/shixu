export const PDF_ANNOTATION_TYPES = new Set([
  "Text","Link","FreeText","Line","Square","Circle","Polygon","PolyLine",
  "Highlight","Underline","Squiggly","StrikeOut","Stamp","Caret","Ink",
  "Popup","FileAttachment","Sound","Movie","Widget","Screen","PrinterMark",
  "TrapNet","Watermark","3D","Redact","Other",
]);
export function validAnnotationRange(range) {
  if (range.annotation === undefined && range.annotationType === undefined && range.annotationRect === undefined) return true;
  const rect=range.annotationRect;
  return Number.isSafeInteger(range.annotation) && range.annotation>=1 && range.annotation<=1000 &&
    PDF_ANNOTATION_TYPES.has(range.annotationType) && Array.isArray(rect) && rect.length===4 &&
    rect.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e9) && rect[2]>=rect[0] && rect[3]>=rect[1];
}
export function annotationRange(annotation,index) {
  const range={annotation:index+1,annotationType:PDF_ANNOTATION_TYPES.has(annotation.subtype)?annotation.subtype:"Other",annotationRect:annotation.rect};
  if(!validAnnotationRange(range))throw Error("PDF_ANNOTATION_INVALID");
  return range;
}
export function annotationText(annotation) {
  // A password widget's stored value is not its visible masked appearance.
  if(annotation.password)return {text:"",unread:true};
  let unread=['FileAttachment','Sound','Movie','Screen','3D','Redact','Other'].includes(annotation.subtype) || !PDF_ANNOTATION_TYPES.has(annotation.subtype);
  const string=value=>{
    if(value==null)return "";
    if(typeof value!=="string" || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)){unread=true;return "";}
    return value.replace(/\r\n?/g,"\n");
  };
  const content=string(annotation.contentsObj?.str),title=string(annotation.titleObj?.str);
  let text=(title?`批注署名：${title}\n`:"")+(content?`批注内容：${content}\n`:"");
  if(annotation.richText && !content)unread=true;
  if(annotation.subtype==="Widget") {
    const field=string(annotation.fieldName);
    if(field)text+=`表单字段：${field}\n`;
    const value=annotation.fieldValue;
    if(value!=null) {
      if(typeof value==='string')text+=`保存值：${string(value)}\n`;
      else if(Array.isArray(value)&&value.every(v=>typeof v==='string'))text+=`保存值：${value.map(string).join("\n")}\n`;
      else unread=true;
    }
    if(annotation.fieldType==='Ch') {
      if(!Array.isArray(annotation.options))unread=true;
      else for(const option of annotation.options) {
        const display=string(option?.displayValue),exported=string(option?.exportValue);
        text+=`可选值：${display}${exported!==display?`（保存值：${exported}）`:''}\n`;
      }
    }
    if(!['Tx','Ch','Btn'].includes(annotation.fieldType))unread=true;
  }
  return {text,unread};
}
