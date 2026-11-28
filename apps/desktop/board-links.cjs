// Identify source packets requiring cross-window compare-and-swap without
// changing the write semantics of unrelated captures and legacy attachments.
function boardSourceIds(packets) {
  const ids=new Set();
  for(const p of packets) if(p?.recordType==='board-workspace') for(const t of p.board?.tasks||[]) {
    if(t.origin!=='source')continue;
    try {const refs=JSON.parse(t.sourceId);if(Array.isArray(refs)&&refs.length===2&&refs.every(v=>typeof v==='string'))ids.add(refs[0]);}catch{}
  }
  return ids;
}
module.exports={boardSourceIds};
