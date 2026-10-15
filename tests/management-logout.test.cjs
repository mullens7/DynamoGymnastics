const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeSessionHandler}=require('../server/admin-session.cjs');
test('management logout expires the shared production-domain cookie and revokes the server session',async()=>{
 const original=global.fetch;let deleted=false;
 global.fetch=async(url,options)=>{assert.match(String(url),/dynamo_user_sessions\?token_hash=eq\./);assert.equal(options.method,'DELETE');deleted=true;return {ok:true,status:204};};
 const headers={},res={setHeader(k,v){headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 try{
  await makeSessionHandler({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'})({method:'DELETE',headers:{host:'manage.dynamogymnastics.co.uk',origin:'https://manage.dynamogymnastics.co.uk',cookie:'__Secure-dynamo-user='+'a'.repeat(64)}},res);
  assert.equal(res.code,200);assert.equal(deleted,true);
  assert.ok(headers['Set-Cookie'].some(c=>c.startsWith('__Secure-dynamo-user=;')&&c.includes('Domain=dynamogymnastics.co.uk')&&c.includes('Max-Age=0')));
 }finally{global.fetch=original;}
});
