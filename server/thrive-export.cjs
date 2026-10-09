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
 const config=configuration(env),started=Date.now();let browser,stage='connect',check='browser connection',deadline,page;
 // No traces, screenshots, response bodies, credentials or member files are logged or saved.
 const task=(async()=>{
  chromium ||= require('playwright-core').chromium;
  const endpoint=new URL('wss://production-lon.browserless.io');
  endpoint.searchParams.set('token',config.token);endpoint.searchParams.set('timeout','115000');
  browser=await chromium.connectOverCDP(endpoint.href,{timeout:15000});
  const context=browser.contexts()[0];if(!context)throw new SyncError('BROWSER_UNAVAILABLE',stage);
  page=await context.newPage();await page.setViewportSize({width:1920,height:1080});page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(25000);
  stage='login';check='Thrive4 sign-in';console.info('Thrive export stage: login');await page.goto('https://club.thrive4.com/#/?sector=gymnastics',{waitUntil:'domcontentloaded'});
  await page.locator('#login_email').fill(config.email);await page.locator('#login_password').fill(config.password);
  await page.locator('#login_submit').click();
  await page.waitForURL(url=>url.hash.startsWith('#/app/business/'),{timeout:25000});
  stage='organisation';console.info('Thrive export stage: organisation');
  const navigation=page.getByRole('menuitem',{name:'Contact management',exact:true});
  const organisation=page.getByText('Dynamo School Of Gymnastics',{exact:true});
  check='organisation chooser or club menu';console.info('Thrive export check:',check);
  await navigation.or(organisation).first().waitFor({state:'visible'});
  if(!await navigation.isVisible()){
   check='select Dynamo organisation';console.info('Thrive export check:',check);
   await organisation.click();
  }
  check='club navigation after selection';console.info('Thrive export check:',check);
  await navigation.waitFor({state:'visible'});
  // A chooser card alone does not prove an organisation is selected.
  await organisation.first().waitFor({state:'visible'});
  stage='contacts';console.info('Thrive export stage: contacts');
  check='expand Contact management';console.info('Thrive export check:',check);
  await navigation.click();
  check='open Contacts menu';console.info('Thrive export check:',check);
  await page.locator('#nav-contacts').getByText('Contacts',{exact:true}).click();
  check='Contacts page navigation';console.info('Thrive export check:',check);
  await page.waitForURL(url=>url.hash.split('?')[0].replace(/\/$/,'')==='#/app/business/crm');
  check='Contacts Export button';console.info('Thrive export check:',check);
  await page.getByText('Export',{exact:true}).waitFor({state:'visible',timeout:30000});
  console.info('Thrive export contacts: export control ready');
  // Workbook-column validation belongs to the import stage. This endpoint
  // only tests downloading and never grants membership from visible columns.
  stage='download';check='enable download transfer';console.info('Thrive export stage: download');const cdp=await context.newCDPSession(page);
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
   check='download Excel export';console.info('Thrive export check:',check);
   await page.getByText('Export',{exact:true}).click();
   const result=inspectDownload(await download);
   return {...result,elapsedMs:Date.now()-started,membershipUpdated:false};
  }finally{clearTimeout(downloadTimer);cdp.off('Browserless.fileDownloaded',listener);}
 })();
 try{
  return await Promise.race([task,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new SyncError('SESSION_TIMEOUT',stage)),110000)})]);
 }catch(error){
  if(stage==='contacts'&&page){
   // Only fixed route labels and counts: no page text, contact names or credentials.
   const summary={route:new URL(page.url()).hash.split('?')[0]==='#/app/business/crm'?'contacts':'other',exportTextCount:await page.getByText('Export',{exact:true}).count().catch(()=>0),exportButtonCount:await page.getByRole('button',{name:/export/i}).count().catch(()=>0)};
   console.info('Thrive export controls:',JSON.stringify(summary));
  }
  // Playwright errors may contain credential-bearing connection URLs. Never pass them through.
  if(error instanceof SyncError){error.check=check;throw error;}
  if(error?.name==='TimeoutError'){const failure=new SyncError('STEP_TIMEOUT',stage);failure.check=check;throw failure;}
  if(stage==='connect'&&/Unexpected server response: (401|403)/.test(String(error?.message)))throw new SyncError('BROWSER_CONNECTION_REJECTED',stage);
  const failure=new SyncError('AUTOMATION_FAILED',stage);failure.check=check;throw failure;
 }finally{clearTimeout(deadline);if(browser){let cleanupTimer;try{await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,5000)})])}finally{clearTimeout(cleanupTimer)}}}
}
module.exports={SyncError,configuration,inspectDownload,exportContacts};
