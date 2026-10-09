const {test}=require('node:test'),assert=require('node:assert/strict');
const {scheduleSlot,confirmPin,performSync}=require('../server/sync-operation.cjs');
const {makeHandler}=require('../server/sync-handler.cjs');
const env={SYNC_TEST_KEY:'fictional-administrator-key-32-characters',SYNC_CONFIRM_PIN:'2468',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
function res(){return {headers:{},lines:[],setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},write(line){this.lines.push(JSON.parse(line));},end(){this.ended=true;},flushHeaders(){}};}
test('scheduled slots stay at midnight/noon London in GMT and BST',()=>{
 assert.match(scheduleSlot(new Date('2026-10-09T23:00:00Z')),/^2026-10-10T00:00/);
 assert.match(scheduleSlot(new Date('2026-10-09T11:00:00Z')),/T12:00/);
 assert.equal(scheduleSlot(new Date('2026-10-09T12:00:00Z')),null);
 assert.match(scheduleSlot(new Date('2026-12-01T00:00:00Z')),/T00:00/);
 assert.match(scheduleSlot(new Date('2026-12-01T12:00:00Z')),/T12:00/);
 assert.equal(scheduleSlot(new Date('2026-12-01T00:11:00Z')),null);
});
test('incorrect and locked PINs fail before export; matching PIN uses the server comparison',async()=>{
 const previous=global.fetch;let verdict='PIN_INCORRECT',match;
 global.fetch=async(url,options)=>{match=JSON.parse(options.body).p_matches;return {ok:true,json:async()=>verdict};};
 try{await assert.rejects(confirmPin(env,'0000'),{code:'PIN_INCORRECT'});assert.equal(match,false);
 verdict='PIN_LOCKED';await assert.rejects(confirmPin(env,'2468'),{code:'PIN_LOCKED'});assert.equal(match,true);
 verdict='OK';await confirmPin(env,'2468');assert.equal(match,true);
 }finally{global.fetch=previous;}
});
test('a running job and repeated schedule slot never start another export',async()=>{
 const previous=global.fetch;let state='busy',calls=0;
 global.fetch=async()=>{calls++;return {ok:true,json:async()=>({state})};};
 try{await assert.rejects(performSync(env),{code:'SYNC_BUSY'});assert.equal(calls,1);state='duplicate';assert.deepEqual(await performSync(env,{source:'scheduled',slot:'fixture'}),{ok:true,duplicate:true});assert.equal(calls,2);}finally{global.fetch=previous;}
});
test('manual sync streams stage progress and only reports completion after the sync resolves',async()=>{
 const response=res();const operations={confirmPin:async(e,pin)=>assert.equal(pin,'2468'),performSync:async(e,{onProgress})=>{onProgress({percent:15,label:'Signing in'});onProgress({percent:90,label:'Saving memberships'});assert.equal(response.lines.some(x=>x.percent===100),false);onProgress({percent:100,label:'Sync complete'});return {ok:true,accounts:1,emailsSent:0};}};
 await makeHandler(env,undefined,operations)({method:'POST',headers:{authorization:'Bearer '+env.SYNC_TEST_KEY},body:{mode:'sync',pin:'2468'}},response);
 assert.equal(response.code,200);assert.match(response.headers['Content-Type'],/ndjson/);assert.deepEqual(response.lines.map(x=>x.type),['progress','progress','progress','complete']);assert.equal(response.ended,true);
});
test('failed manual sync never sends 100% or successful completion',async()=>{
 const response=res();const operations={confirmPin:async()=>{},performSync:async(e,{onProgress})=>{onProgress({percent:90,label:'Saving memberships'});throw Object.assign(Error('private database message'),{code:'SYNC_STORAGE_FAILED'});}};
 await makeHandler(env,undefined,operations)({method:'POST',headers:{authorization:'Bearer '+env.SYNC_TEST_KEY},body:{mode:'sync',pin:'2468'}},response);
 assert.equal(response.lines.some(x=>x.percent===100||x.type==='complete'),false);assert.equal(response.lines.at(-1).type,'error');assert.equal(JSON.stringify(response.lines).includes('private database'),false);
});
