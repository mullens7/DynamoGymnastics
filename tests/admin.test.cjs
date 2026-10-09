const {test}=require('node:test'),assert=require('node:assert/strict');
const auth=require('../server/admin-auth.cjs');
const {makeSessionHandler}=require('../server/admin-session.cjs');
const {makeRecordsHandler,validate}=require('../server/admin-records.cjs');
const env={SYNC_TEST_KEY:'fictional-management-access-key-32-characters',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
const host='manage.example.invalid',origin='https://'+host;
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
function req(method='GET'){return {method,headers:{host,origin,cookie:auth.cookie(auth.token(env)).split(';')[0]},query:{kind:'events'}};}
const event={name:'Holiday activity',date:'2026-10-27',time:'10:00',capacity:30,memberPriceCents:1000,nonMemberPriceCents:1500,audience:'groups',allowedGroups:['gymtots','gymini'],status:'Draft'};
test('management session survives a new request, expires and rejects tampering and key changes',()=>{
 const now=Date.now(),value=auth.token(env,now),request={headers:{cookie:auth.cookie(value).split(';')[0]}};
 assert.equal(auth.session(request,env,now),true);assert.equal(auth.session(request,env,now+13*60*60*1000),false);
 assert.equal(auth.session(request,{...env,SYNC_TEST_KEY:env.SYNC_TEST_KEY+'changed'},now),false);
 request.headers.cookie+='x';assert.equal(auth.session(request,env,now),false);assert.equal(auth.session({headers:{}},env),false);
});
test('cookie mutations reject other origins while reads require a valid session',()=>{
 const request=req('POST');assert.equal(auth.allowed(request,env),true);request.headers.origin='https://attacker.example';assert.equal(auth.allowed(request,env),false);
 request.method='GET';assert.equal(auth.allowed(request,env),true);request.headers.cookie='';assert.equal(auth.allowed(request,env),false);
});
test('sign in issues only an HttpOnly secure cookie and sign out clears it',async()=>{
 const handler=makeSessionHandler(env),request={method:'POST',headers:{host,origin},body:{key:env.SYNC_TEST_KEY}},response=res();
 await handler(request,response);assert.equal(response.code,200);assert.match(response.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);assert.equal(JSON.stringify(response.body).includes(env.SYNC_TEST_KEY),false);
 const followup={method:'GET',headers:{cookie:response.headers['Set-Cookie'].split(';')[0]}},read=res();await handler(followup,read);assert.equal(read.code,200);
 const wrong=res();await handler({...request,body:{key:'incorrect'}},wrong);assert.equal(wrong.code,401);assert.equal(wrong.headers['Set-Cookie'],undefined);
 const out=res();await handler({...request,method:'DELETE'},out);assert.match(out.headers['Set-Cookie'],/Max-Age=0/);
});
test('record validation enforces trusted prices, groups, dates and limits',()=>{
 assert.deepEqual(validate('events',{...event,unknown:'ignored'}),event);
 for(const changed of [{capacity:0},{memberPriceCents:-1},{memberPriceCents:1.5},{allowedGroups:['invented']},{date:'2026-02-30'},{time:'25:00'},{audience:'groups',allowedGroups:[]}])assert.throws(()=>validate('events',{...event,...changed}));
 assert.deepEqual(validate('parties',{name:'Birthday',date:'2026-10-27',time:'14:00',guests:20,room:'Big gym',status:'Confirmed'}).guests,20);
});
test('unauthenticated writes and payments mutations never contact storage',async()=>{
 const handler=makeRecordsHandler(env),r=res();await handler({method:'POST',headers:{},query:{kind:'events'},body:event},r);assert.equal(r.code,401);
 const payments=req('POST');payments.query.kind='payments';const p=res();await handler(payments,p);assert.equal(p.code,405);
 const malformed=req('PATCH');malformed.body=event;malformed.query.id='not-an-id';const m=res();await handler(malformed,m);assert.equal(m.code,400);
});
test('event saves return database IDs; deletes archive without erasing history',async()=>{
 const original=global.fetch,calls=[];const id='00000000-0000-4000-8000-000000000001';
 global.fetch=async(url,options)=>{calls.push({url:String(url),options});return {ok:true,status:200,json:async()=>[{id,details:event}]};};
 try{const handler=makeRecordsHandler(env),create=req('POST');create.body=event;const saved=res();await handler(create,saved);assert.equal(saved.code,201);assert.equal(saved.body.record.id,id);
 const remove=req('DELETE');remove.query.id=id;const removed=res();await handler(remove,removed);assert.equal(removed.code,200);assert.equal(calls[1].options.method,'PATCH');assert.deepEqual(JSON.parse(calls[1].options.body),{archived:true});assert.match(calls[1].url,/id=eq/);assert.equal(calls.every(c=>!c.url.includes('dynamo_accounts')&&!c.url.includes('dynamo_transactions')),true);
 }finally{global.fetch=original;}
});
