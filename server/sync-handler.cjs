const {createHash,timingSafeEqual}=require('node:crypto');
const {exportContacts}=require('./thrive-export.cjs');
const messages={STEP_TIMEOUT:'The current automation step timed out. Check the reported step below.',BROWSER_CONNECTION_REJECTED:'Browserless rejected the browser connection. Check your API token and account endpoint.',NOT_CONFIGURED:'Browserless and Thrive4 credentials have not been configured.',INVALID_EXPORT:'The downloaded file was not recognised as an Excel export.',EXPORT_TIMEOUT:'Thrive4 did not finish the export in time.',SESSION_TIMEOUT:'The free-plan test exceeded its time limit.',BROWSER_UNAVAILABLE:'A browser session could not be started.',AUTOMATION_FAILED:'The login or export flow could not be completed. Extra verification or changed page controls may need attention.'};
function authorised(header,key){
 if(typeof key!=='string'||key.length<32||typeof header!=='string'||header.length>1024)return false;
 return timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+key).digest());
}
function makeHandler(env=process.env,run=exportContacts){return async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
 if(!authorised(req.headers.authorization,env.SYNC_TEST_KEY))return res.status(401).json({error:'UNAUTHORISED',message:'An administrator test key is required.'});
 // Requests cannot supply credentials, URLs, organisation names, selectors or export actions.
 try{const result=await run(env);return res.status(200).json({ok:true,...result,message:'Excel download test completed. Membership records were not changed.'});}
 catch(e){const code=Object.hasOwn(messages,e.code)?e.code:'AUTOMATION_FAILED';console.warn('Thrive export test:',code,'stage:', ['setup','connect','login','organisation','contacts','download'].includes(e.stage)?e.stage:'unknown');return res.status(code==='NOT_CONFIGURED'?503:502).json({ok:false,error:code,stage:['setup','connect','login','organisation','contacts','download'].includes(e.stage)?e.stage:'unknown',message:messages[code]});}
};}
module.exports={makeHandler,authorised};
