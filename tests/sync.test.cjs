const {test}=require('node:test');const assert=require('node:assert/strict');const {makeHandler,authorised}=require('../server/sync-handler.cjs');const {inspectDownload,configuration}=require('../server/thrive-export.cjs');
const key='fictional-test-key-with-at-least-32-characters';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(b){this.body=b;return this}};}
test('auth fails closed before connecting, including short/missing keys',async()=>{
 assert.equal(authorised('Bearer '+key,key),true);assert.equal(authorised('Bearer wrong',key),false);assert.equal(authorised('Bearer short','short'),false);
 let calls=0;const h=makeHandler({SYNC_TEST_KEY:key},async()=>{calls++});
 for(const method of ['GET','POST']){const r=response();await h({method,headers:{}},r);assert.equal(r.code,method==='GET'?405:401);assert.equal(r.headers['Cache-Control'],'no-store');}assert.equal(calls,0);
});
test('no credential values, filenames or file bytes returned by handler',async()=>{
 const result={format:'xlsx',bytes:1234,sha256:'hash',elapsedMs:5000,membershipUpdated:false};const r=response();
 await makeHandler({SYNC_TEST_KEY:key},async()=>result)({method:'POST',headers:{authorization:'Bearer '+key}},r);assert.equal(r.code,200);assert.equal(r.body.membershipUpdated,false);assert.equal(r.body.bytes,1234);
});
test('underlying errors are sanitised, no connection URL leakage',async()=>{
 const r=response();await makeHandler({SYNC_TEST_KEY:key},async()=>{throw new Error('wss://secret.example?token=DO-NOT-EXPOSE')})({method:'POST',headers:{authorization:'Bearer '+key}},r);
 assert.equal(r.code,502);assert.equal(JSON.stringify(r.body).includes('DO-NOT-EXPOSE'),false);
});
test('missing config stops before login; file identification rejects HTML and empty exports',()=>{
 assert.throws(()=>configuration({}),{code:'NOT_CONFIGURED'});
 assert.throws(()=>inspectDownload({filename:'contacts.xlsx',data:Buffer.from('<html>login</html>').toString('base64')}),{code:'INVALID_EXPORT'});
 const b=Buffer.alloc(120);Buffer.from([0x50,0x4b,0x03,0x04]).copy(b);assert.equal(inspectDownload({filename:'contacts.xlsx',data:b.toString('base64')}).bytes,120);
 assert.throws(()=>inspectDownload({filename:'contacts.html',data:b.toString('base64')}));
});
test('worker follows verified navigation and always closes the remote browser',async()=>{
 const {EventEmitter}=require('node:events');const {exportContacts}=require('../server/thrive-export.cjs');
 const cdp=new EventEmitter();cdp.send=async()=>{};const actions=[];let closed=0;
 const buffer=Buffer.alloc(200);Buffer.from([0x50,0x4b,0x03,0x04]).copy(buffer);
 const node=name=>({fill:async()=>actions.push(name),click:async()=>{actions.push(name);if(name==='Export')cdp.emit('Browserless.fileDownloaded',{filename:'contacts.xlsx',data:buffer.toString('base64')})},waitFor:async()=>{},first(){return this}});
 const page={setDefaultTimeout(){},setDefaultNavigationTimeout(){},goto:async()=>{},url:()=> 'https://club.thrive4.com/#/app/business/dashboard',waitForURL:async()=>{},locator:node,getByText:node,getByRole:(role,{name})=>node(name)};
 const browser={contexts:()=>[{newPage:async()=>page,newCDPSession:async()=>cdp}],close:async()=>{closed++}};
 const env={BROWSERLESS_TOKEN:'fixture-token',THRIVE_EMAIL:'fixture@example.invalid',THRIVE_PASSWORD:'fixture-password'};
 const result=await exportContacts(env,{chromium:{connectOverCDP:async()=>browser}});assert.equal(result.membershipUpdated,false);assert.equal(result.bytes,200);assert.equal(closed,1);assert.deepEqual(actions,['#login_email','#login_password','#login_submit','#nav-contactManagement','#nav-contacts','Export']);
 closed=0;page.goto=async()=>{throw new Error('secret error')};await assert.rejects(exportContacts(env,{chromium:{connectOverCDP:async()=>browser}}),{code:'AUTOMATION_FAILED',stage:'login'});assert.equal(closed,1);
});
