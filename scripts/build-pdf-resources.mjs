import { readdir, readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PDF_RESOURCE_CATALOG } from "../server/reading/pdf-resource-catalog.mjs";
export async function copyPdfResources(root, output) {
  const names = Object.keys(PDF_RESOURCE_CATALOG.files).sort();
  const actual = [];
  for (const group of ["cmaps", "standard_fonts"])
    actual.push(...(await readdir(join(root,"node_modules/pdfjs-dist",group))).map(n=>`${group}/${n}`));
  if (actual.sort().join() !== names.join()) throw Error("PDF_RESOURCE_UPGRADE_REVIEW_REQUIRED");
  for (const name of names) {
    const source=join(root,"node_modules/pdfjs-dist",name), expected=PDF_RESOURCE_CATALOG.files[name];
    const info=await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes) throw Error("PDF_RESOURCE_INTEGRITY");
    const data=await readFile(source);
    if (createHash("sha256").update(data).digest("hex") !== expected.sha256) throw Error("PDF_RESOURCE_INTEGRITY");
    await mkdir(join(output,"resources",name.split("/")[0]),{recursive:true});
    await writeFile(join(output,"resources",name),data,{mode:0o644});
  }
  return names.map(n=>"resources/"+n);
}
