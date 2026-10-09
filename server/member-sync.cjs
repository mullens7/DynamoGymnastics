const {createHash}=require('node:crypto');
const {database}=require('./database.cjs');
const {exportContacts}=require('./thrive-export.cjs');
const {readWorkbook,prepareRoster,RosterError}=require('./member-roster.cjs');
function settings(env){
 const config=database(env);
 let mapping;try{mapping=JSON.parse(env.THRIVE_EXPORT_MAPPING||'');}catch{throw new RosterError('ROSTER_MAPPING_REQUIRED');}
 return {...config,mapping};
}
// Hash classified records so rule changes apply even when the Excel file is unchanged.
function snapshotHash(owners){
 const canonical=owners.map(owner=>({...owner,gymnasts:owner.gymnasts.map(g=>({...g,groups:[...g.groups].sort()})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId))})).sort((a,b)=>a.email.localeCompare(b.email));
 return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
async function syncMembers(env){
 const config=settings(env),startedAt=new Date().toISOString();
 const download=await exportContacts(env,{includeWorkbook:true});
 if(download.format!=='xlsx')throw new RosterError('INVALID_ROSTER');
 const report={},workbook=await readWorkbook(download.workbook),owners=prepareRoster(workbook,config.mapping,report);
 const response=await fetch(config.url+'/rest/v1/rpc/apply_dynamo_roster',{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({p_hash:snapshotHash(owners),p_started_at:startedAt,p_rows:owners}),signal:AbortSignal.timeout(20000)});
 if(!response.ok){let code;try{code=(await response.json()).message;}catch{}
  throw new RosterError(['SNAPSHOT_REVIEW_REQUIRED','STALE_SNAPSHOT','IDENTITY_REVIEW_REQUIRED'].includes(code)?code:'SYNC_STORAGE_FAILED');}
 const result=await response.json();
 return {ok:true,membershipUpdated:true,accounts:result.accounts,members:result.members,staff:result.staff,unchanged:result.unchanged===true,emailsSent:0,unmappedRows:report.unmappedRows,unmappedClasses:report.unmappedClasses,message:'Members synced. Accounts and history retained. No emails sent.'};
}
module.exports={syncMembers,settings,snapshotHash};
