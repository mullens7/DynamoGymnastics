const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceConfigurations,mergeRosters}=require('../server/roster-sources.cjs');
const {syncMembers}=require('../server/member-sync.cjs');
const {prepareRoster,profileIdentity}=require('../server/member-roster.cjs');
const mapping={email:'Owner email',ownerName:'Account owner',firstName:'First name',lastName:'Last name',timeClass:'Time and Class',dateOfBirth:'Date of birth',identityPolicy:'email_name_dob',membershipPolicy:'assigned_classes'};
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture',BROWSERLESS_TOKEN:'fixture',THRIVE_EMAIL:'dynamo@example.invalid',THRIVE_PASSWORD:'fixture-dynamo',THRIVE_EXPORT_MAPPING:JSON.stringify(mapping)};
const both={...env,GYMTOTS_THRIVE_EMAIL:'gymtots@example.invalid',GYMTOTS_THRIVE_PASSWORD:'fixture-gymtots'};
const child=(overrides={})=>({sourceId:profileIdentity('owner@example.invalid','Test','Child','2022-01-01'),firstName:'Test',lastName:'Child',dateOfBirth:'2022-01-01',bgNumber:'',timeClass:'Tuesday Gymini',groups:['gymini'],active:true,...overrides});
const owner=(gymnasts=[child()],other={})=>({email:'owner@example.invalid',ownerName:'Test Parent',member:gymnasts.some(g=>g.active),staff:false,gymnasts,...other});
test('Dynamo credentials remain unchanged; Gymtots gets independent credentials and exact organisation name',()=>{
 assert.equal(sourceConfigurations(env).length,1);
 const [d,g]=sourceConfigurations(both);assert.equal(d.env.THRIVE_EMAIL,env.THRIVE_EMAIL);assert.equal(g.env.THRIVE_EMAIL,both.GYMTOTS_THRIVE_EMAIL);assert.equal(g.env.THRIVE_PASSWORD,both.GYMTOTS_THRIVE_PASSWORD);assert.equal(g.env.THRIVE_ORGANISATION,'Gymtots R OK');
 assert.throws(()=>sourceConfigurations({...env,GYMTOTS_THRIVE_EMAIL:'missing-password@example.invalid'}),{code:'GYMTOTS_NOT_CONFIGURED'});
});
test('shared accounts and children merge without duplicate identities; active groups and staff access are preserved',()=>{
 const sources=[{owners:[owner()]},{owners:[owner([child({timeClass:'Saturday Gymtots',groups:['gymtots']})],{staff:true})]}];
 const rows=mergeRosters(sources);assert.equal(rows.length,1);assert.equal(rows[0].gymnasts.length,1);assert.equal(rows[0].gymnasts[0].sourceId,child().sourceId);assert.deepEqual(rows[0].gymnasts[0].groups,['gymini','gymtots']);assert.equal(rows[0].staff,true);
 const oneActive=mergeRosters([{owners:[owner([child({active:false})])]},{owners:[owner([child({groups:['gymtots'],timeClass:'Gymtots'})])]}]);
 assert.deepEqual(oneActive[0].gymnasts[0].groups,['gymtots']);assert.equal(oneActive[0].gymnasts[0].active,true);
 assert.throws(()=>mergeRosters([{owners:[owner()]},{owners:[owner([child()],{email:'different@example.invalid'})]}]),{code:'IDENTITY_REVIEW_REQUIRED'});
});
function workbook(label){
 const values=['owner@example.invalid','Test Parent','Test','Child',label,'2022-01-01'];
 return {columns:['Owner email','Account owner','First name','Last name','Time and Class','Date of birth'].map((label,i)=>({label,index:i+1})),rows:[{getCell:n=>({type:3,value:values[n-1]})}]};
}
test('both exports validate before one combined save, with monotonic progress and existing identity unchanged',async()=>{
 const actions=[],progress=[];let saved;
 const services={exportContacts:async(e,{onProgress})=>{actions.push(e.THRIVE_EMAIL);onProgress({percent:65,label:'Downloading'});return {format:'xlsx',workbook:e.THRIVE_EMAIL};},readWorkbook:async key=>workbook(key===env.THRIVE_EMAIL?'Gymini':'Gymtots'),prepareRoster,fetch:async(url,options)=>{actions.push('save');assert.match(url,/apply_dynamo_rosters$/);saved=JSON.parse(options.body);return {ok:true,json:async()=>({accounts:1,members:1,staff:0})};}};
 const result=await syncMembers(both,{onProgress:p=>progress.push(p.percent)},services);
 assert.deepEqual(actions,[env.THRIVE_EMAIL,both.GYMTOTS_THRIVE_EMAIL,'save']);assert.equal(saved.p_rows.length,1);assert.equal(saved.p_rows[0].gymnasts.length,1);assert.equal(saved.p_rows[0].gymnasts[0].sourceId,child().sourceId);assert.equal(saved.p_sources.length,2);assert.equal(result.organisations.length,2);assert.equal(result.emailsSent,0);assert.ok(progress.every((p,i)=>i===0||p>=progress[i-1]));assert.ok(progress.every(p=>p<100));
});
test('second organisation failure, invalid workbook or incomplete config never applies a partial roster',async()=>{
 let saved=0,exported=0;
 const services={exportContacts:async e=>{exported++;if(e.THRIVE_EMAIL===both.GYMTOTS_THRIVE_EMAIL)throw Error('Second export failed');return {format:'xlsx',workbook:''};},readWorkbook:async()=>workbook('Gymini'),prepareRoster,fetch:async()=>{saved++;}};
 await assert.rejects(syncMembers(both,{},services),/Second export failed/);assert.equal(saved,0);
 exported=0;await assert.rejects(syncMembers({...env,GYMTOTS_THRIVE_EMAIL:'incomplete'}, {},services),{code:'GYMTOTS_NOT_CONFIGURED'});assert.equal(exported,0);
 services.exportContacts=async()=>({format:'xls'});await assert.rejects(syncMembers(both,{},services),{code:'INVALID_ROSTER'});assert.equal(saved,0);
});
