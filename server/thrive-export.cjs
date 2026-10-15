const {createHash}=require('node:crypto');
const {ensureExportColumns}=require('./thrive-columns.cjs');
const {RosterError}=require('./member-roster.cjs');
const MAX_BYTES=15*1024*1024;
class SyncError extends Error {constructor(code,stage){super(code);this.code=code;this.stage=stage;}}
function configuration(env){
 const required=['BROWSERLESS_TOKEN','THRIVE_EMAIL','THRIVE_PASSWORD'];
 if(required.some(k=>!env[k]))throw new SyncError('NOT_CONFIGURED','setup');
 const organisation=env.THRIVE_ORGANISATION||'Dynamo School Of Gymnastics';if(typeof organisation!=='string'||!organisation.trim()||organisation.length>160||/[\r\n]/.test(organisation))throw new SyncError('NOT_CONFIGURED','setup');
 return {token:env.BROWSERLESS_TOKEN,email:env.THRIVE_EMAIL,password:env.THRIVE_PASSWORD,organisation:organisation.trim()};
}
function inspectDownload({filename,data}){
 if(typeof data!=='string'||data.length>Math.ceil(MAX_BYTES/3)*4+4)throw new SyncError('INVALID_EXPORT','download');
 const buffer=Buffer.from(data,'base64');
 const xlsx=/\.xlsx$/i.test(filename||'')&&buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));
 const xls=/\.xls$/i.test(filename||'')&&buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));
 if(buffer.length<100||buffer.length>MAX_BYTES||(!xlsx&&!xls))throw new SyncError('INVALID_EXPORT','download');
 return {format:xlsx?'xlsx':'xls',bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')};
}
function actionabilityReason(error){
 const message=String(error?.message||'');
 if(/intercepts pointer events/i.test(message))return 'covered by another element';
 if(/element is not enabled|element is disabled/i.test(message))return 'disabled';
 if(/element is outside of the viewport/i.test(message))return 'outside the visible area';
 if(/element is not stable/i.test(message))return 'moving or rerendering';
 return 'not clickable within the time limit';
}
async function clickExportControl(control){
 try{
  await control.evaluate(element=>element.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
  await control.scrollIntoViewIfNeeded({timeout:5000});
  await control.click({timeout:5000});
 }catch(error){
  // Only recover a geometry failure on the already identified Export control.
  // Disabled controls, overlays and verification failures are not bypassed.
  const message=String(error?.message||'');
  if(!/element is outside of the viewport/i.test(message)||/intercepts pointer events|element is not enabled|element is disabled/i.test(message)||!await control.isVisible()||!await control.isEnabled())throw error;
  const activated=await control.evaluate(element=>{
   const rect=element.getBoundingClientRect();
   if(!(element instanceof HTMLElement)||rect.width<=0||rect.height<=0||element.matches(':disabled,[aria-disabled="true"]')||element.closest('[inert]'))return false;
   element.click();return true;
  });
  if(!activated)throw error;
  console.info('Thrive export click: viewport geometry fallback');
 }
}
async function captureDiagnostic(page,reason){
 const diagnostic={reason};
 if(!page)return diagnostic;
 try{
  const route=new URL(page.url()).hash.split('?')[0].replace(/\/$/,'');
  if(route!=='#/app/business/crm')return {...diagnostic,screenshotUnavailable:'A screenshot is available only after the Contacts page opens.'};
  const screenshot=await page.screenshot({type:'jpeg',quality:65,timeout:3000,mask:[page.locator('.ant-table-wrapper,table,[role="rowgroup"],[role="row"],.ag-row,.k-grid-content'),page.locator('input,textarea,[contenteditable="true"]'),page.locator('[class*="avatar"],[class*="profile"],[class*="user-name"]')]});
  if(screenshot.length<750000)diagnostic.image=screenshot.toString('base64');
  else diagnostic.screenshotUnavailable='The masked screenshot exceeded the size limit.';
 }catch{diagnostic.screenshotUnavailable='The browser could not capture a masked screenshot.';}
 return diagnostic;
}
async function exportContacts(env,{chromium,includeWorkbook=false,captureDiagnostics=false,repairColumns=false,onProgress=()=>{}}={}){
 const config=configuration(env),started=Date.now();onProgress({percent:5,label:'Connecting to Thrive4'});let browser,stage='connect',check='browser connection',deadline,page;
 // Diagnostics are transient masked images; no traces, credentials or member files are logged or saved.
 const task=(async()=>{
  chromium ||= require('playwright-core').chromium;
  const endpoint=new URL('wss://production-lon.browserless.io');
  endpoint.searchParams.set('token',config.token);endpoint.searchParams.set('timeout','115000');
  browser=await chromium.connectOverCDP(endpoint.href,{timeout:15000});
  const context=browser.contexts()[0];if(!context)throw new SyncError('BROWSER_UNAVAILABLE',stage);
  page=await context.newPage();await page.setViewportSize({width:2560,height:2160});page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(25000);
  stage='login';onProgress({percent:15,label:'Signing in to Thrive4'});check='Thrive4 sign-in';console.info('Thrive export stage: login');await page.goto('https://club.thrive4.com/#/?sector=gymnastics',{waitUntil:'domcontentloaded'});
  await page.locator('#login_email').fill(config.email);await page.locator('#login_password').fill(config.password);
  await page.locator('#login_submit').click();
  await page.waitForURL(url=>url.hash.startsWith('#/app/business/'),{timeout:25000});
  stage='organisation';onProgress({percent:35,label:'Opening '+config.organisation});console.info('Thrive export stage: organisation');
  const navigation=page.getByRole('menuitem',{name:'Contact management',exact:true});
  const organisation=page.getByText(config.organisation,{exact:true});
  check='organisation chooser or club menu';console.info('Thrive export check:',check);
  await navigation.or(organisation).first().waitFor({state:'visible'});
  if(!await navigation.isVisible()){
   check='select configured organisation';console.info('Thrive export check:',check);
   await organisation.click();
  }
  check='club navigation after selection';console.info('Thrive export check:',check);
  await navigation.waitFor({state:'visible'});
  // A chooser card alone does not prove an organisation is selected.
  await organisation.first().waitFor({state:'visible'});
  stage='contacts';onProgress({percent:50,label:'Opening Contacts'});console.info('Thrive export stage: contacts');
  check='expand Contact management';console.info('Thrive export check:',check);
  await navigation.click();
  check='open Contacts menu';console.info('Thrive export check:',check);
  await page.locator('#nav-contacts').getByText('Contacts',{exact:true}).click();
  check='Contacts page navigation';console.info('Thrive export check:',check);
  await page.waitForURL(url=>url.hash.split('?')[0].replace(/\/$/,'')==='#/app/business/crm');
  check='Contacts Export button';console.info('Thrive export check:',check);
  await page.getByText('Export',{exact:true}).waitFor({state:'visible',timeout:30000});
  console.info('Thrive export contacts: export control ready');
  if(repairColumns){check='configure required export columns';onProgress({percent:55,label:'Checking required export columns'});await ensureExportColumns(page,env);}
  // Validate the downloaded workbook before applying any membership changes.
  stage='download';onProgress({percent:65,label:'Downloading the member export'});check='enable download transfer';console.info('Thrive export stage: download');const cdp=await context.newCDPSession(page);
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
   const exportText=page.getByText('Export',{exact:true});
   // Use the surrounding interactive control, rather than a nested text span.
   const interactive=exportText.locator('xpath=ancestor-or-self::*[self::button or self::a or @role="button"][1]');
   const exportControl=await interactive.count()===1?interactive:exportText;
   await clickExportControl(exportControl);
   const payload=await download;
   const result=inspectDownload(payload);
   return {...result,elapsedMs:Date.now()-started,membershipUpdated:false,...(captureDiagnostics?{diagnostic:await captureDiagnostic(page,'Export downloaded; checking spreadsheet contents.')} :{}),...(includeWorkbook?{workbook:Buffer.from(payload.data,'base64')}:{})};
  }finally{clearTimeout(downloadTimer);cdp.off('Browserless.fileDownloaded',listener);}
 })();
 try{
  return await Promise.race([task,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new SyncError('SESSION_TIMEOUT',stage)),110000)})]);
 }catch(error){
  const reason=stage==='download'&&check==='download Excel export'?actionabilityReason(error):'Automation stopped at '+check+'.';
  const diagnostic=await captureDiagnostic(page,reason);
  if(stage==='contacts'&&page){
   // Only fixed route labels and counts: no page text, contact names or credentials.
   const summary={route:new URL(page.url()).hash.split('?')[0]==='#/app/business/crm'?'contacts':'other',exportTextCount:await page.getByText('Export',{exact:true}).count().catch(()=>0),exportButtonCount:await page.getByRole('button',{name:/export/i}).count().catch(()=>0)};
   console.info('Thrive export controls:',JSON.stringify(summary));
  }
  // Playwright errors may contain credential-bearing connection URLs. Never pass them through.
  if(error instanceof SyncError||error instanceof RosterError){error.check=check;error.diagnostic=diagnostic;throw error;}
  if(error?.name==='TimeoutError'){const failure=new SyncError('STEP_TIMEOUT',stage);failure.check=check;failure.diagnostic=diagnostic;throw failure;}
  if(stage==='connect'&&/Unexpected server response: (401|403)/.test(String(error?.message)))throw new SyncError('BROWSER_CONNECTION_REJECTED',stage);
  const failure=new SyncError('AUTOMATION_FAILED',stage);failure.check=check;failure.diagnostic=diagnostic;throw failure;
 }finally{clearTimeout(deadline);if(browser){let cleanupTimer;try{await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,5000)})])}finally{clearTimeout(cleanupTimer)}}}
}
module.exports={SyncError,configuration,inspectDownload,exportContacts,actionabilityReason,clickExportControl,captureDiagnostic};
