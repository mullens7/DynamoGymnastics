const {createHash}=require('node:crypto');
const MAX_BYTES=15*1024*1024;
class SyncError extends Error {constructor(code,stage){super(code);this.code=code;this.stage=stage;}}
function configuration(env){
 const required=['BROWSERLESS_TOKEN','THRIVE_EMAIL','THRIVE_PASSWORD'];
 if(required.some(k=>!env[k]))throw new SyncError('NOT_CONFIGURED','setup');
 return {token:env.BROWSERLESS_TOKEN,email:env.THRIVE_EMAIL,password:env.THRIVE_PASSWORD};
}
function inspectDownload({filename,data}){
 if(typeof data!=='string'||data.length>Math.ceil(MAX_BYTES/3)*4+4)throw new SyncError('INVALID_EXPORT','download');
 const buffer=Buffer.from(data,'base64');
 const xlsx=/\.xlsx$/i.test(filename||'')&&buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));
 const xls=/\.xls$/i.test(filename||'')&&buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));
 if(buffer.length<100||buffer.length>MAX_BYTES||(!xlsx&&!xls))throw new SyncError('INVALID_EXPORT','download');
 return {format:xlsx?'xlsx':'xls',bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};
}
async function exportContacts(env,{chromium}={}){
 const config=configuration(env),started=Date.now();let browser,stage='connect',deadline;
 // No traces, screenshots, response bodies, credentials or member files are logged or saved.
 const task=(async()=>{
  chromium ||= require('playwright-core').chromium;
  const endpoint=new URL('wss://production-lon.browserless.io');
  endpoint.searchParams.set('token',config.token);endpoint.searchParams.set('timeout','115000');
  browser=await chromium.connectOverCDP(endpoint.href,{timeout:15000});
  const context=browser.contexts()[0];if(!context)throw new SyncError('BROWSER_UNAVAILABLE',stage);
  const page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(25000);
  stage='login';console.info('Thrive export stage: login');await page.goto('https://club.thrive4.com/#/?sector=gymnastics',{waitUntil:'domcontentloaded'});
  await page.locator('#login_email').fill(config.email);await page.locator('#login_password').fill(config.password);
  await page.locator('#login_submit').click();
  await page.waitForURL(url=>url.hash.startsWith('#/app/business/'),{timeout:25000});
  stage='organisation';console.info('Thrive export stage: organisation');
  if(page.url().includes('choose-organisation')){
   await page.getByText('Dynamo School Of Gymnastics',{exact:true}).click();
   await page.waitForURL(url=>!url.hash.includes('choose-organisation'),{timeout:20000});
  }
  // Verify the organisation before exporting. Do not accidentally export Gymtots.
  await page.getByText('Dynamo School Of Gymnastics',{exact:true}).first().waitFor({state:'visible'});
  stage='contacts';console.info('Thrive export stage: contacts');await page.locator('#nav-contactManagement').click();await page.locator('#nav-contacts').click();
  await page.waitForURL(url=>url.hash==='#/app/business/crm');
  for(const heading of ['Time and class','Account owner','Owner email','Date of birth']){
   await page.getByRole('columnheader',{name:heading,exact:true}).waitFor({state:'visible'});
  }
  stage='download';console.info('Thrive export stage: download');const cdp=await context.newCDPSession(page);
  await cdp.send('Browserless.setDownloadEnabled',{enabled:true});
  let downloadTimer,listener;
  const download=new Promise((resolve,reject)=>{
   listener=payload=>{clearTimeout(downloadTimer);resolve(payload)};
   cdp.once('Browserless.fileDownloaded',listener);
   downloadTimer=setTimeout(()=>reject(new SyncError('EXPORT_TIMEOUT','download')),35000);
  });
  // Mark rejection handled even if clicking the export button fails first.
  download.catch(()=>{});
  try{
   await page.getByRole('button',{name:'Export',exact:true}).click();
   const result=inspectDownload(await download);
   return {...result,elapsedMs:Date.now()-started,membershipUpdated:false};
  }finally{clearTimeout(downloadTimer);cdp.off('Browserless.fileDownloaded',listener);}
 })();
 try{
  return await Promise.race([task,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new SyncError('SESSION_TIMEOUT',stage)),110000)})]);
 }catch(error){
  // Playwright errors may contain credential-bearing connection URLs. Never pass them through.
  if(error instanceof SyncError)throw error;
  if(error?.name==='TimeoutError')throw new SyncError('STEP_TIMEOUT',stage);
  if(stage==='connect'&&/Unexpected server response: (401|403)/.test(String(error?.message)))throw new SyncError('BROWSER_CONNECTION_REJECTED',stage);
  throw new SyncError('AUTOMATION_FAILED',stage);
 }finally{clearTimeout(deadline);if(browser){let cleanupTimer;try{await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,5000)})])}finally{clearTimeout(cleanupTimer)}}}
}
module.exports={SyncError,configuration,inspectDownload,exportContacts};
