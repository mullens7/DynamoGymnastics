const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {cookie,sessionToken}=require('../server/user-auth.cjs');
test('production domains share the opaque session, while Vercel sessions remain host-only',()=>{
 const token='a'.repeat(64);
 for(const host of ['dynamogymnastics.co.uk','www.dynamogymnastics.co.uk','auth.dynamogymnastics.co.uk','manage.dynamogymnastics.co.uk']){
  const req={headers:{host}};const value=cookie(token,43200,req);
  assert.match(value,/^__Secure-dynamo-user=/);assert.match(value,/Domain=dynamogymnastics.co.uk/);assert.match(value,/HttpOnly; Secure; SameSite=Strict/);
  req.headers.cookie=value.split(';')[0];assert.equal(sessionToken(req),token);
 }
 for(const host of ['dynamo-gymnastics.vercel.app','dynamogymnastics.co.uk.attacker.invalid','rogue.dynamogymnastics.co.uk']){
  const req={headers:{host,cookie:'__Secure-dynamo-user='+token}};assert.equal(sessionToken(req),null);assert.match(cookie(token,43200,req),/^__Host-/);assert.doesNotMatch(cookie(token,43200,req),/Domain=/);
 }
 assert.equal(sessionToken({headers:{host:'auth.dynamogymnastics.co.uk',cookie:'__Secure-dynamo-user='+token+'; __Secure-dynamo-user='+token}}),null);
});
test('production login returns to the correct portal and rejects external redirects',()=>{
 const source=fs.readFileSync('public/auth/login.js','utf8');const fn=source.slice(source.indexOf('function destination'),source.indexOf('async function sendCode'));
 const context={URL,URLSearchParams,location:{hostname:'auth.dynamogymnastics.co.uk',origin:'https://auth.dynamogymnastics.co.uk',search:''}};vm.createContext(context);vm.runInContext(fn,context);
 assert.equal(context.destination(),'https://dynamogymnastics.co.uk/');
 assert.equal(context.destination({isDeveloper:true}),'https://dynamogymnastics.co.uk/developer/');
 context.location.search='?next='+encodeURIComponent('/manage/');assert.equal(context.destination({managementAccess:true}),'https://dynamogymnastics.co.uk/manage/');
 assert.equal(context.destination({managementAccess:false,permissions:['resources.read']}),'https://dynamogymnastics.co.uk/staff/');
 context.location.search='?next='+encodeURIComponent('https://dynamogymnastics.co.uk.attacker.invalid/manage/');assert.equal(context.destination(),'https://dynamogymnastics.co.uk/');
});
const {makeBookingConfirmationHandler}=require('../server/booking-confirmation.cjs');
const booking='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222';
function response(){return {setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;}};}
test('manual confirmations claim once before building or delivering; successful request replays never resend',async()=>{
 let state='claimed',sent=0,built=0,stored;
 const services={authorizeAdmin:async()=>true,sameOrigin:()=>true,rpc:async()=>({state}),all:async(e,path)=>path.startsWith('dynamo_event_bookings')?[{id:booking,account_id:op,status:'Booked',selection:{},event:{details:{}}}]:path.startsWith('dynamo_accounts')?[{email:'fixture@example.invalid'}]:[{details:{}}],buildConfirmation:async()=>{built++;return {subject:'Fixture'};},sendEmail:async()=>{sent++;},store:async(e,p,o)=>{stored=JSON.parse(o.body);}};
 const handler=makeBookingConfirmationHandler({},services),req={method:'POST',headers:{},body:{bookingId:booking,operationId:op}};
 let res=response();await handler(req,res);assert.equal(res.code,200);assert.equal(sent,1);assert.equal(stored.status,'sent');
 for(state of ['sent','sending','busy','review']){res=response();await handler(req,res);assert.equal(res.code,state==='sent'?200:409);}
 assert.equal(sent,1);assert.equal(built,1);
});
test('interrupted manual mail delivery requires review and never automatically retries SMTP',async()=>{
 let calls=0,stored;
 const services={authorizeAdmin:async()=>true,sameOrigin:()=>true,rpc:async()=>({state:'claimed'}),all:async(e,path)=>path.startsWith('dynamo_event_bookings')?[{account_id:op,status:'Booked'}]:path.startsWith('dynamo_accounts')?[{email:'fixture@example.invalid'}]:[{details:{}}],buildConfirmation:async()=>({}),sendEmail:async()=>{calls++;throw Error('fixture interrupted');},store:async(e,p,o)=>{stored=JSON.parse(o.body);}};
 const res=response();await makeBookingConfirmationHandler({},services)({method:'POST',headers:{},body:{bookingId:booking,operationId:op}},res);
 assert.equal(calls,1);assert.equal(stored.status,'review');assert.equal(res.code,502);
});
test('outbox review and participant resend controls use distinct selectors',()=>{
 assert.match(fs.readFileSync('public/manage/operations.js','utf8'),/data-resend-booking-confirmation/);
 assert.doesNotMatch(fs.readFileSync('public/manage/operations.js','utf8'),/\[data-resend-confirmation\]/);
});
