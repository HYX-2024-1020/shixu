import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPdfAnnotationTextClients } from "../../scripts/reading-pdf-text-annotation-clients.mjs";
for(const archive of [false,true])test(`text-only annotation sources and explicit unread appearances survive signed dual-client stop/reupload/reuse ${archive?'ZIP deleted':'PDF temporary'}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'shixu-pdf-text-annotation-clients-'));
  try{await runPdfAnnotationTextClients({directory,archive});}
  finally{await rm(directory,{recursive:true,force:true});}
});
