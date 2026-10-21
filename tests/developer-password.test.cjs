const {test}=require('node:test'),assert=require('node:assert/strict');
const {hashPassword,verifyPassword,validatePassword,makeDeveloperPasswordHandler,DEVELOPER_EMAIL}=require('../server/developer-password.cjs');
const {makeLoginHandler}=require('../server/login.cjs'),{hash}=require('../server/user-auth.cjs');
const env={SYNC_TEST_KEY:'test-key-longer-than-thirty-two-characters'},id='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
const req=(body,method='POST')=>({method,body,query:{},headers:{host:'dynamo.example.invalid',origin:'https://dynamo.example.invalid','x-real-ip':'192.0.2.1',cookie:'__Host-dynamo-user='+'a'.repeat(64)}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
const strong='Test-only Password!2026';
test('developer passwords use random salts and memory-hard hashes; wrong or malformed passwords fail',async()=>{
 const encoded=await hashPassword(strong),second=await hashPassword(strong);assert.notEqual(encoded,second);assert.doesNotMatch(encoded,/Test-only/);assert.match(encoded,/^scrypt\$65536\$8\$2\$/);assert.equal(await verifyPassword(strong,encoded),true);assert.equal(await verifyPassword('Wrong Password!2026',encoded),false);assert.equal(await verifyPassword(strong,'broken'),false);
 for(const bad of ['1234','abcdefghijklmnop','abcdefghijklmn12','ABCDEFGHIJKLMN!!','a'.repeat(129),null])assert.throws(()=>validatePassword(bad));assert.equal(validatePassword(strong),strong);
});
test('configured developer request selects password login and never generates or sends a code',async()=>{
 let sent=0,rpcs=0;const out=res();await makeLoginHandler(env,{store:async()=>[{version}],rpc:async()=>{rpcs++;},sendEmail:async()=>sent++})(req({action:'request',email:' FREDDIE@MULLENS.COM '}),out);assert.equal(out.code,200);assert.equal(out.body.loginMethod,'password');assert.equal(rpcs,0);assert.equal(sent,0);assert.equal(out.body.challengeId,undefined);
});
test('password login only issues an opaque cookie after hashing and database version checks succeed',async()=>{
 const calls=[];let valid=false;
 const services={rpc:async(e,name,body)=>{calls.push({name,body});return name.startsWith('reserve')?{ok:true,passwordHash:'private-hash',version}:{ok:valid};},verifyPassword:async(p,h)=>{assert.equal(h,'private-hash');return valid=p===strong;}};
 let out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'password',email:DEVELOPER_EMAIL,password:'incorrect',isDeveloper:true,p_valid:true}),out);assert.equal(out.code,401);assert.equal(out.headers['Set-Cookie'],undefined);assert.equal(calls[1].body.p_valid,false);
 out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'password',email:DEVELOPER_EMAIL,password:strong}),out);assert.equal(out.code,200);assert.equal(out.body.ok,true);assert.doesNotMatch(JSON.stringify(out.body),/private-hash|passwordHash|version/);const token=out.headers['Set-Cookie'][0].split(';')[0].split('=')[1];assert.equal(hash(token),calls[3].body.p_session_hash);assert.match(out.headers['Set-Cookie'][0],/HttpOnly; Secure; SameSite=Strict/);
});
test('rate-limited, cross-origin and non-developer password requests do not hash guesses or create sessions',async()=>{
 const services={rpc:async()=>({ok:false,error:'PASSWORD_RATE_LIMIT',retryAfter:600}),verifyPassword:async()=>{throw Error('Do not perform expensive hashing');}};
 let out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'password',email:DEVELOPER_EMAIL,password:strong}),out);assert.equal(out.code,429);assert.equal(out.headers['Retry-After'],'600');
 const bad=req({action:'password',email:DEVELOPER_EMAIL,password:strong});bad.headers.origin='https://attacker.invalid';out=res();await makeDeveloperPasswordHandler(env,services)(bad,out);assert.equal(out.code,403);
 out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'password',email:'parent@example.invalid',password:strong}),out);assert.equal(out.code,401);
});
test('only an authenticated developer can initialise or read password settings, and no hash is returned',async()=>{
 for(const actor of [null,{id,email:'admin@dynamogymnastics.co.uk',websiteAdmin:true},{id,email:DEVELOPER_EMAIL,isDeveloper:true}]){
  let saved;const services={currentActor:async()=>actor,store:async()=>[],hashPassword:async p=>{assert.equal(p,strong);return 'hashed-private-value';},rpc:async(e,n,b)=>{saved={n,b};return {ok:true};}};
  let out=res(),request=req(null,'GET');request.query={action:'password-settings'};await makeDeveloperPasswordHandler(env,services)(request,out);assert.equal(out.code,actor?.isDeveloper?200:actor?403:401);
  out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'set-password',newPassword:strong}),out);assert.equal(out.code,actor?.isDeveloper?200:actor?403:401);
  if(actor?.isDeveloper){assert.equal(saved.b.p_actor,id);assert.equal(saved.b.p_expected_version,null);assert.equal(saved.b.p_password_hash,'hashed-private-value');assert.equal(saved.b.p_session_hash,hash('a'.repeat(64)));assert.doesNotMatch(JSON.stringify(out.body),/hashed-private-value/);}else assert.equal(saved,undefined);
 }
});
test('changing an existing password requires the current password before storing a replacement',async()=>{
 let saved=0;const services={currentActor:async()=>({id,email:DEVELOPER_EMAIL,isDeveloper:true}),store:async()=>[{version}],rpc:async(e,n,b)=>{if(n.startsWith('reserve'))return {ok:true,passwordHash:'stored-hash',version};if(n.startsWith('finish'))return {ok:b.p_valid};assert.equal(b.p_expected_version,version);saved++;return {ok:true};},verifyPassword:async p=>p==='Old Password!2026',hashPassword:async()=> 'new-private-hash'};
 let out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'set-password',newPassword:strong,currentPassword:'wrong'}),out);assert.equal(out.code,400);assert.equal(saved,0);
 out=res();await makeDeveloperPasswordHandler(env,services)(req({action:'set-password',newPassword:strong,currentPassword:'Old Password!2026'}),out);assert.equal(out.code,200);assert.equal(saved,1);
});

test('developer bootstrap retains one-time email verification only until a password has been set',async()=>{
 let sent=0;const out=res();await makeLoginHandler(env,{store:async()=>[],rpc:async()=>({ok:true}),sendEmail:async()=>sent++})(req({action:'request',email:DEVELOPER_EMAIL}),out);assert.equal(out.code,200);assert.equal(sent,1);assert.match(out.body.challengeId,/^[a-f0-9-]{36}$/);
});
test('authentication UI switches to password mode without showing OTP controls or retaining a code',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('public/auth/login.js','utf8'),nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',textContent:'',focus(){this.focused=true;}});return nodes.get(id);};
 const ctx={$:node,document:{querySelector:node},clearInterval:()=>{},resendTimer:1,challengeId:'old-code',email:DEVELOPER_EMAIL};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function showPassword(){'),source.indexOf("$('#password-form').onsubmit")),ctx);ctx.showPassword();
 assert.equal(node('#email-form').hidden,true);assert.equal(node('#code-form').hidden,true);assert.equal(node('#password-form').hidden,false);assert.equal(node('#password-email').value,DEVELOPER_EMAIL);assert.equal(ctx.challengeId,'');assert.equal(node('#developer-password').focused,true);
});
