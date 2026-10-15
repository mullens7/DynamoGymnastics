const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('server/award-confirmation.cjs','utf8');
function moduleUnderTest(){
 const ctx={module:{exports:{}},Intl,Date,Number,String,Promise,encodeURIComponent,require:path=>{
  if(path==='./email-template.cjs')return {signature:()=>'<footer>Dynamo signature</footer>'};
  if(path==='./login.cjs')return {uuid:s=>/^[a-f0-9-]{36}$/.test(s||'')};
  if(path==='./confirmation.cjs')return {validateSettings:(b,kind)=>{assert.equal(kind,'award');if(!b.subject||/[\r\n]/.test(b.subject))throw Error('Invalid subject');return {...b,qrEnabled:false};}};
  if(['./store.cjs','./email.cjs','./admin-auth.cjs'].includes(path))return {};
  throw Error('Unexpected dependency '+path);
 }};
 vm.runInNewContext(source,ctx);return ctx.module.exports;
}
const {buildAwardConfirmation,deliverAwardConfirmation,makeAwardConfirmationSettingsHandler}=moduleUnderTest();
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const cfg={enabled:true,subject:'Award confirmation',greeting:'Hi {parentName},',intro:'Thank you.',instructions:'Collect at class.'},owner={email:'fixture@example.invalid',owner_name:'Parent <Name>'},items=[{details:{gymnastName:'First Child',session:'Thursday 16:00, Gymini',awardName:'Violet',pricePence:500}},{details:{gymnastName:'Second Child',session:'Friday 17:00, Recreational',awardName:'Bronze Level 1',pricePence:600}}];
test('award confirmation includes every purchased award, prices, total, custom wording and HTML signature without QR attachments',()=>{
 const mail=buildAwardConfirmation(owner,{id},items,cfg);
 assert.equal(mail.subject,cfg.subject);for(const text of ['First Child','Second Child','Violet','Bronze Level 1','£5.00','£6.00','£11.00','Collect at class.'])assert.ok(mail.text.includes(text));
 assert.match(mail.html,/Parent &lt;Name&gt;/);assert.match(mail.html,/Dynamo signature/);assert.equal(mail.attachments.length,0);
 assert.equal(buildAwardConfirmation(owner,{id},items,{...cfg,enabled:false}),null);
});
function deliveryServices({enabled=true,paid=true,sendFails=false}={}){
 let state='pending',sent=0;return {get state(){return state;},get sent(){return sent;},
 all:async(env,path)=>path.startsWith('dynamo_award_orders')?(paid?[{id,account_id:account,payment_pending:false}]:[]):path.startsWith('dynamo_accounts')?[owner]:path.startsWith('dynamo_confirmation_settings')?[{details:{...cfg,enabled}}]:items,
 store:async(env,path,options)=>{const value=JSON.parse(options.body);if(path.includes('status=eq.pending')){if(state!=='pending')return [];state=value.status;return [{id,account_id:account}];}state=value.status;return [{id}];},
 sendEmail:async mail=>{sent++;assert.equal(mail.to,owner.email);if(sendFails)throw Error('Delivery uncertain');}
 };
}
test('paid award delivery is claimed once; repeat callbacks cannot send duplicate confirmations',async()=>{
 const s=deliveryServices();assert.equal((await deliverAwardConfirmation({},id,account,s)).sent,true);assert.equal(s.state,'sent');await deliverAwardConfirmation({},id,account,s);assert.equal(s.sent,1);
});
test('unpaid orders never send, disabled settings skip delivery and uncertain deliveries require review',async()=>{
 const unpaid=deliveryServices({paid:false});await deliverAwardConfirmation({},id,account,unpaid);assert.equal(unpaid.sent,0);assert.equal(unpaid.state,'pending');
 const disabled=deliveryServices({enabled:false});await deliverAwardConfirmation({},id,account,disabled);assert.equal(disabled.sent,0);assert.equal(disabled.state,'skipped');
 const failed=deliveryServices({sendFails:true});await deliverAwardConfirmation({},id,account,failed);assert.equal(failed.state,'review');await deliverAwardConfirmation({},id,account,failed);assert.equal(failed.sent,1);
});
const response=()=>({statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
test('award settings require Super Admin access and same-origin writes',async()=>{
 const denied=response();await makeAwardConfirmationSettingsHandler({}, {authorizeAdmin:async()=>false})({method:'GET'},denied);assert.equal(denied.statusCode,403);
 const cross=response();await makeAwardConfirmationSettingsHandler({}, {authorizeAdmin:async()=>true,sameOrigin:()=>false})({method:'PATCH'},cross);assert.equal(cross.statusCode,403);
});
test('award settings save without sending email and preview is local',async()=>{
 let saves=0;const res=response();await makeAwardConfirmationSettingsHandler({}, {authorizeAdmin:async()=>true,sameOrigin:()=>true,store:async(env,path,options)=>{assert.equal(path,'dynamo_confirmation_settings?kind=eq.award');assert.equal(JSON.parse(options.body).details.qrEnabled,false);saves++;return [{details:cfg}];},deliverAwardConfirmation:async()=>{throw Error('Settings must not send');}})({method:'PATCH',body:cfg},res);
 assert.equal(res.statusCode,200);assert.equal(saves,1);
 const ui=fs.readFileSync('public/manage/confirmation-settings.js','utf8');assert.match(ui,/kind==='award'/);assert.match(ui,/This preview sends no email/);
});
test('both card settlement and wallet-only awards invoke award confirmation after successful persistence',async()=>{
 const ctx={module:{exports:{}},Date,Number,String,URL,require:path=>{
  if(path==='stripe')return function Stripe(){throw Error('No real Stripe calls allowed');};
  if(path==='./store.cjs')return {};
  if(path==='./login.cjs')return {uuid:()=>true};
  throw Error('Unexpected dependency '+path);
 }};
 vm.runInNewContext(fs.readFileSync('server/stripe-payments.cjs','utf8'),ctx);
 const api=ctx.module.exports,env={STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_CONNECTED_ACCOUNT_ID:'acct_fixture'},order={id,account_id:account,kind:'awards',connected_account:'acct_fixture',session_id:'cs_fixture',card_pence:500,result:{}},calls=[];
 const services={rpc:async()=>{calls.push('persisted');return {state:'paid'};},deliverAwardConfirmation:async(e,i,a)=>{assert.equal(i,id);assert.equal(a,account);calls.push('award-email');}};
 await api.settleSession(env,order,{id:'cs_fixture',metadata:{site:'dynamo-gymnastics',orderId:id},client_reference_id:id,currency:'gbp',amount_total:500,livemode:false,payment_status:'paid',status:'complete',payment_intent:'pi_fixture'},services);
 assert.deepEqual(calls,['persisted','award-email']);calls.length=0;
 await api.settleSession(env,order,{id:'cs_fixture',metadata:{site:'dynamo-gymnastics',orderId:id},client_reference_id:id,currency:'gbp',amount_total:500,livemode:false,payment_status:'unpaid',status:'expired'},services);
 assert.deepEqual(calls,['persisted']);calls.length=0;
 await api.createCheckout(env,{headers:{host:'dynamo-gymnastics.vercel.app'}},{id:account},'awards',{},{
  stripe:()=>({}),rpc:async()=>{calls.push('persisted');return {...order,state:'paid'};},deliverAwardConfirmation:services.deliverAwardConfirmation
 });
 assert.deepEqual(calls,['persisted','award-email']);
});
