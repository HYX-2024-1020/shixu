import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPdfAnnotationClients } from "../../scripts/reading-pdf-annotation-clients.mjs";
for(const archive of [false,true])test(`annotation sources and rendered appearances survive signed dual-client stop/reupload/reuse ${archive?'ZIP deleted':'PDF temporary'}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'shixu-pdf-annotation-clients-'));
  try{await runPdfAnnotationClients({directory,archive});}
  finally{await rm(directory,{recursive:true,force:true});}
});
