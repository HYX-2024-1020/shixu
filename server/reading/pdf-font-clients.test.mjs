import test from "node:test";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPdfFontClients } from "../../scripts/reading-pdf-font-clients.mjs";
for(const archive of [false,true])test(`standard-font PDF shared by signed Windows and mini clients, stop/reupload/reuse ${archive?'ZIP deleted':'PDF temporary'}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'shixu-pdf-font-clients-'));
  try{await runPdfFontClients({directory,archive});}
  finally{await rm(directory,{recursive:true,force:true});}
});
