const {createHash,timingSafeEqual}=require('node:crypto');
const {exportContacts}=require('./thrive-export.cjs');
const {syncMembers}=require('./member-sync.cjs');
const {readWorkbook}=require('./member-roster.cjs');
const messages={DATABASE_NOT_CONFIGURED:'The Dynamo account database is not connected yet. No records were changed.',ROSTER_MAPPING_REQUIRED:'The export identity and active membership columns must be configured first. No records were changed.',INVALID_ROSTER:'The Excel export could not be validated. No records were changed.',EMPTY_ROSTER:'The export is empty. Existing memberships were preserved.',ROSTER_REVIEW_REQUIRED:'A class label needs review. Existing memberships were preserved.',SNAPSHOT_REVIEW_REQUIRED:'The export is substantially smaller than the last sync. Existing memberships were preserved pending review.',STALE_SNAPSHOT:'A newer sync already completed. Existing memberships were preserved.',IDENTITY_REVIEW_REQUIRED:'A gymnast identity needs review: missing or invalid birth date, duplicate details, or changed name/owner. Existing records were preserved.',SYNC_STORAGE_FAILED:'The database update could not be completed. No partial membership update was applied.',STEP_TIMEOUT:'The current automation step timed out. Check the reported step below.',BROWSER_CONNECTION_REJECTED:'Browserless rejected the browser connection. Check your API token and account endpoint.',NOT_CONFIGURED:'Browserless and Thrive4 credentials have not been configured.',INVALID_EXPORT:'The downloaded file was not recognised as an Excel export.',EXPORT_TIMEOUT:'Thrive4 did not finish the export in time.',SESSION_TIMEOUT:'The free-plan test exceeded its time limit.',BROWSER_UNAVAILABLE:'A browser session could not be started.',AUTOMATION_FAILED:'The login or export flow could not be completed. Extra verification or changed page controls may need attention.'};
const checks=['Contacts page navigation','Thrive4 sign-in','enable download transfer','download Excel export','browser connection','organisation chooser or club menu','select Dynamo organisation','club navigation after selection','expand Contact management','open Contacts menu','Contacts Export button'];
function authorised(header,key){
 if(typeof key!=='string'||key.length<32||typeof header!=='string'||header.length>1024)return false;
 return timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+key).digest());
}
function makeHandler(env=process.env,run=exportContacts){return async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
 if(!authorised(req.headers.authorization,env.SYNC_TEST_KEY))return res.status(401).json({error:'UNAUTHORISED',message:'An administrator test key is required.'});
 // Requests cannot supply credentials, URLs, organisation names, selectors or export actions.
 try{
  const mode=req.body?.mode||'test';
  if(!['test','inspect','sync'].includes(mode))return res.status(400).json({error:'INVALID_MODE'});
  if(mode==='sync')return res.status(200).json(await syncMembers(env));
  const result=await run(env,{includeWorkbook:mode==='inspect'});
  if(mode==='inspect'){
   if(result.format!=='xlsx')throw Object.assign(new Error('INVALID_ROSTER'),{code:'INVALID_ROSTER'});
   const workbook=await readWorkbook(result.workbook);
   const {workbook:discarded,...summary}=result;
   return res.status(200).json({ok:true,...summary,columns:workbook.columns.map(c=>c.label),rowCount:workbook.rows.length,message:'Export structure checked. No records were changed or emails sent.'});
  }
  return res.status(200).json({ok:true,...result,message:'Excel download test completed. Membership records were not changed.'});
 }
 catch(e){const code=Object.hasOwn(messages,e.code)?e.code:'AUTOMATION_FAILED';console.warn('Thrive export check failed:',checks.includes(e.check)?e.check:'unknown');console.warn('Thrive export test:',code,'stage:', ['setup','connect','login','organisation','contacts','download','validation'].includes(e.stage)?e.stage:'unknown');return res.status(code==='NOT_CONFIGURED'?503:502).json({ok:false,error:code,review:code==='ROSTER_REVIEW_REQUIRED'&&Array.isArray(e.review)?e.review.slice(0,20).map(item=>({row:Number.isInteger(item.row)?item.row:undefined,label:String(item.label||'').slice(0,200)})):undefined,stage:['setup','connect','login','organisation','contacts','download','validation'].includes(e.stage)?e.stage:'unknown',diagnostic:e.diagnostic&&typeof e.diagnostic.reason==='string'?{reason:e.diagnostic.reason,image:typeof e.diagnostic.image==='string'&&e.diagnostic.image.length<1000000?e.diagnostic.image:undefined}:undefined,message:messages[code]+(checks.includes(e.check)?' Check: '+e.check+'.':'')});}
};}
module.exports={makeHandler,authorised};
