const {createHash}=require('node:crypto');
const {database}=require('./database.cjs');
const {exportContacts}=require('./thrive-export.cjs');
const {readWorkbook,prepareRoster,RosterError}=require('./member-roster.cjs');
const {sourceConfigurations,sourceMapping,mergeRosters,sourceSummary}=require('./roster-sources.cjs');
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
async function syncMembers(env,{onProgress=()=>{},dryRun=false}={},services={exportContacts,readWorkbook,prepareRoster,fetch:(...args)=>fetch(...args)}){
 const config=settings(env),startedAt=new Date().toISOString();
 const sources=sourceConfigurations(env).map(source=>({...source,config:settings(source.env)}));
 const reports=[];
 // Close each Browserless session before opening the next. All exports must
 // pass validation before the single database transaction can change membership.
 for(let index=0;index<sources.length;index++){
  let sourceProgress=0;
  const source=sources[index],progress=item=>{sourceProgress=Math.max(sourceProgress,Math.floor(5+(index+Math.min(item.percent,80)/80)*75/sources.length));onProgress({percent:sourceProgress,label:source.name+' — '+item.label});};
  let download;
  try{
   const exportOptions={includeWorkbook:true,captureDiagnostics:true,onProgress:progress};
   download=await services.exportContacts(source.env,exportOptions);
   let mapping=source.config.mapping;
   if(source.key==='gymtots'){
    // Per-organisation numeric IDs are not globally unique.
    mapping={...mapping,identityPolicy:'email_name_dob'};delete mapping.id;
   }
   const report={};
   const validate=async()=>{
    if(download.format!=='xlsx'){const error=new RosterError('INVALID_ROSTER');error.validation={reason:'The export is not an XLSX workbook. Export Contacts as Excel XLSX.'};throw error;}
    onProgress({percent:(sourceProgress=Math.max(sourceProgress,Math.floor(5+(index+.95)*75/sources.length))),label:'Checking '+source.name+' memberships'});
    const workbook=await services.readWorkbook(download.workbook,{allowClassHeading:source.key==='gymtots'});
    return services.prepareRoster(workbook,sourceMapping(source,workbook.columns,mapping),report,{source:source.key,skipInvalid:true});
   };
   try{source.owners=await validate();}
   catch(error){
    // Always try the account's saved export first. Column controls must never
    // block a valid export. Only missing headings trigger one repair attempt.
    if(!error.missingColumns)throw error;
    onProgress({percent:(sourceProgress=Math.max(sourceProgress,Math.floor(5+(index+.95)*75/sources.length))),label:'Restoring missing export columns for '+source.name});
    download=await services.exportContacts({...source.env,THRIVE_EXPORT_MAPPING:JSON.stringify(mapping)},{...exportOptions,repairColumns:true});
    source.owners=await validate();
   }
   reports.push({...report,key:source.key,name:source.name});
  }catch(error){error.organisation=source.name;error.stage ||= 'validation';error.diagnostic ||= download?.diagnostic;throw error;}
 }
 const mergeReport={},owners=mergeRosters(sources,{skipInvalid:true,report:mergeReport});
 onProgress({percent:85,label:'Combining accounts and checking both exports'});
 onProgress({percent:90,label:'Saving memberships and retaining account history'});
 const response=await services.fetch(config.url+'/rest/v1/rpc/'+(dryRun?'preview_dynamo_rosters':'apply_dynamo_rosters'),{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({p_hash:snapshotHash(owners),p_started_at:startedAt,p_rows:owners,p_sources:sources.map(source=>({...sourceSummary(source),hash:snapshotHash(source.owners)}))}),signal:AbortSignal.timeout(20000)});
 if(!response.ok){let code;try{code=(await response.json()).message;}catch{}
  throw new RosterError(['SNAPSHOT_REVIEW_REQUIRED','STALE_SNAPSHOT','IDENTITY_REVIEW_REQUIRED','ROSTER_SOURCE_MISSING'].includes(code)?code:'SYNC_STORAGE_FAILED');}
 const result=await response.json();
 if(dryRun)return result;
 return {ok:true,membershipUpdated:true,accounts:result.accounts,members:result.members,staff:result.staff,unchanged:result.unchanged===true,organisations:sources.map(s=>({name:s.name,...sourceSummary(s)})),emailsSent:0,skippedRecords:[...reports.flatMap(r=>(r.skipped||[]).map(item=>({...item,organisation:r.name}))),...(mergeReport.skipped||[]),...(result.skippedRecords||[])],unmappedRows:reports.reduce((n,r)=>n+(r.unmappedRows||0),0),unmappedClasses:reports.flatMap(r=>(r.unmappedClasses||[]).map(c=>({...c,label:r.name+': '+c.label}))),message:'Members synced. Accounts and history retained. No emails sent.'};
}
module.exports={syncMembers,settings,snapshotHash};
