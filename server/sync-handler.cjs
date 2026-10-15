const {createHash,timingSafeEqual}=require('node:crypto');
const {authorizeAdmin}=require('./admin-auth.cjs');
const {confirmPin,performSync}=require('./sync-operation.cjs');
const {exportContacts}=require('./thrive-export.cjs');
const {readWorkbook,prepareRoster,RosterError}=require('./member-roster.cjs');
const {sourceConfigurations,sourceMapping}=require('./roster-sources.cjs');
const messages={COLUMN_SETUP_FAILED:'Thrive4 export columns could not be configured. Check the details and masked screenshot below. No records were changed.',GYMTOTS_NOT_CONFIGURED:'Complete both Gymtots Thrive4 login settings before syncing. No memberships were changed.',ROSTER_SOURCE_MISSING:'A previously connected organisation is missing. Restore its sync settings; existing memberships were preserved.',PIN_NOT_CONFIGURED:'The staff confirmation code has not been configured.',PIN_INCORRECT:'The four-digit confirmation code is incorrect.',PIN_LOCKED:'Too many incorrect codes. Please wait five minutes before trying again.',SYNC_BUSY:'A member sync is already running. Please wait for it to finish.',DATABASE_NOT_CONFIGURED:'The Dynamo account database is not connected yet. No records were changed.',ROSTER_MAPPING_REQUIRED:'The export identity and active membership columns must be configured first. No records were changed.',INVALID_ROSTER:'The Excel export could not be validated. No records were changed.',EMPTY_ROSTER:'The export is empty. Existing memberships were preserved.',ROSTER_REVIEW_REQUIRED:'A class label needs review. Existing memberships were preserved.',SNAPSHOT_REVIEW_REQUIRED:'The export is substantially smaller than the last sync. Existing memberships were preserved pending review.',STALE_SNAPSHOT:'A newer sync already completed. Existing memberships were preserved.',IDENTITY_REVIEW_REQUIRED:'A gymnast identity needs review: missing or invalid birth date, duplicate details, or changed name/owner. Existing records were preserved.',SYNC_STORAGE_FAILED:'The database update could not be completed. No partial membership update was applied.',STEP_TIMEOUT:'The current automation step timed out. Check the reported step below.',BROWSER_CONNECTION_REJECTED:'Browserless rejected the browser connection. Check your API token and account endpoint.',NOT_CONFIGURED:'Browserless and Thrive4 credentials have not been configured.',INVALID_EXPORT:'The downloaded file was not recognised as an Excel export.',EXPORT_TIMEOUT:'Thrive4 did not finish the export in time.',SESSION_TIMEOUT:'The free-plan test exceeded its time limit.',BROWSER_UNAVAILABLE:'A browser session could not be started.',AUTOMATION_FAILED:'The login or export flow could not be completed. Extra verification or changed page controls may need attention.'};
const checks=['configure required export columns','Contacts page navigation','Thrive4 sign-in','enable download transfer','download Excel export','browser connection','organisation chooser or club menu','select Dynamo organisation','select configured organisation','club navigation after selection','expand Contact management','open Contacts menu','Contacts Export button'];
function failureDetails(error){
 const details={};
 if(['Dynamo Gymnastics','Gymtots R OK'].includes(error.organisation))details.organisation=error.organisation;
 if(['setup','connect','login','organisation','contacts','download','validation'].includes(error.stage))details.stage=error.stage;
 if(error.validation&&typeof error.validation.reason==='string')details.validation={reason:error.validation.reason.slice(0,240),...(Number.isInteger(error.validation.row)?{row:error.validation.row}:{}),...(typeof error.validation.column==='string'?{column:error.validation.column.slice(0,60)}:{})};
 if(error.diagnostic&&typeof error.diagnostic.reason==='string')details.diagnostic={reason:error.diagnostic.reason.slice(0,240),...(typeof error.diagnostic.image==='string'&&error.diagnostic.image.length<1000000&&/^[A-Za-z0-9+/=]+$/.test(error.diagnostic.image)?{image:error.diagnostic.image}:{}),...(typeof error.diagnostic.screenshotUnavailable==='string'?{screenshotUnavailable:error.diagnostic.screenshotUnavailable.slice(0,200)}:{})};
 return details;
}
function authorised(header,key){
 if(typeof key!=='string'||key.length<32||typeof header!=='string'||header.length>1024)return false;
 return timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+key).digest());
}
function makeHandler(env=process.env,run=exportContacts,ops={confirmPin,performSync}){return async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
 if(!await authorizeAdmin(req,env))return res.status(401).json({error:'UNAUTHORISED',message:'Sign in to management.'});
 // Requests cannot supply credentials, URLs, organisation names, selectors or export actions.
 try{
  const mode=req.body?.mode||'test';
  if(!['test','inspect','sync'].includes(mode))return res.status(400).json({error:'INVALID_MODE'});
  if(mode==='sync'){
   await ops.confirmPin(env,req.body?.pin);
   res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('X-Accel-Buffering','no');res.status(200);res.flushHeaders?.();
   const send=item=>res.write(JSON.stringify(item)+'\n');
   try{const result=await ops.performSync(env,{onProgress:progress=>send({type:'progress',...progress})});send({type:'complete',result});}
   catch(error){const code=Object.hasOwn(messages,error.code)?error.code:'AUTOMATION_FAILED';console.warn('Member sync:',code);send({type:'error',error:code,message:messages[code],...failureDetails(error)});}
   finally{res.end();}return;
  }
  const sourceKey=req.body?.source||'dynamo';
  if(!['dynamo','gymtots'].includes(sourceKey))return res.status(400).json({error:'INVALID_SOURCE'});
  const source=sourceConfigurations(env).find(item=>item.key===sourceKey);
  if(!source)throw Object.assign(new Error('GYMTOTS_NOT_CONFIGURED'),{code:'GYMTOTS_NOT_CONFIGURED'});
  let result;
  try{result=await run(source.env,{includeWorkbook:mode==='inspect',captureDiagnostics:true});}
  catch(error){error.organisation=source.name;throw error;}
  if(mode==='inspect'){
   if(result.format!=='xlsx')throw Object.assign(new Error('INVALID_ROSTER'),{code:'INVALID_ROSTER'});
   let workbook;try{workbook=await readWorkbook(result.workbook,{allowClassHeading:source.key==='gymtots'});}catch(error){error.organisation=source.name;error.diagnostic=result.diagnostic;throw error;}
   let classification;
   if(req.body?.validateRoster===true){
    try{
     let mapping;try{mapping=JSON.parse(source.env.THRIVE_EXPORT_MAPPING||'');}catch{throw new RosterError('ROSTER_MAPPING_REQUIRED');}
     if(source.key==='gymtots'){mapping={...mapping,identityPolicy:'email_name_dob'};delete mapping.id;}
     const report={},owners=prepareRoster(workbook,sourceMapping(source,workbook.columns,mapping),report,{source:source.key});
     const counts={};for(const owner of owners)for(const child of owner.gymnasts)for(const group of child.groups)counts[group]=(counts[group]||0)+1;
     classification={accounts:owners.length,members:owners.filter(owner=>owner.member).length,gymnasts:owners.reduce((n,owner)=>n+owner.gymnasts.length,0),groups:counts,unmappedRows:report.unmappedRows,unmappedClasses:report.unmappedClasses};
    }catch(error){error.organisation=source.name;error.diagnostic=result.diagnostic;throw error;}
   }
   const {workbook:discarded,diagnostic:discardedDiagnostic,...summary}=result;
   return res.status(200).json({ok:true,...summary,...(classification?{classification}:{}),columns:workbook.columns.map(c=>c.label),rowCount:workbook.rows.length,message:'Export structure checked. No records were changed or emails sent.'});
  }
  return res.status(200).json({ok:true,...result,message:'Excel download test completed. Membership records were not changed.'});
 }
 catch(e){const code=Object.hasOwn(messages,e.code)?e.code:'AUTOMATION_FAILED';console.warn('Thrive export check failed:',checks.includes(e.check)?e.check:'unknown');console.warn('Thrive export test:',code,'stage:', ['setup','connect','login','organisation','contacts','download','validation'].includes(e.stage)?e.stage:'unknown');return res.status(code==='PIN_INCORRECT'?403:code==='PIN_LOCKED'?429:code==='NOT_CONFIGURED'?503:502).json({ok:false,error:code,review:code==='ROSTER_REVIEW_REQUIRED'&&Array.isArray(e.review)?e.review.slice(0,20).map(item=>({row:Number.isInteger(item.row)?item.row:undefined,label:String(item.label||'').slice(0,200)})):undefined,stage:['setup','connect','login','organisation','contacts','download','validation'].includes(e.stage)?e.stage:'unknown',...failureDetails(e),message:messages[code]+(checks.includes(e.check)?' Check: '+e.check+'.':'')});}
};}
module.exports={makeHandler,authorised,messages};
