// Internal references are assembled only for the authorized management response.
function adminEvents(rows){
 const codes=new Map(rows.map(r=>[r.id,r.internal_id]));
 return rows.filter(r=>!r.details?.parentId).map(r=>({...r.details,id:r.id,internalId:r.internal_id,
  ...(Array.isArray(r.details?.sessions)?{sessions:r.details.sessions.map(s=>({...s,internalId:codes.get(s.id)}))}:{})}));
}
module.exports={adminEvents};
