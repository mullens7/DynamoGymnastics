const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceConfigurations,mergeRosters,sourceMapping}=require('../server/roster-sources.cjs');
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
 const services={exportContacts:async(e,{onProgress,repairColumns})=>{assert.notEqual(repairColumns,true,'A correctly configured export must not open Manage Columns');actions.push(e.THRIVE_EMAIL);onProgress({percent:65,label:'Downloading'});return {format:'xlsx',workbook:e.THRIVE_EMAIL};},readWorkbook:async key=>workbook(key===env.THRIVE_EMAIL?'Gymini':'Gymtots'),prepareRoster,fetch:async(url,options)=>{actions.push('save');assert.match(url,/apply_dynamo_rosters$/);saved=JSON.parse(options.body);return {ok:true,json:async()=>({accounts:1,members:1,staff:0})};}};
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
test('spreadsheet rejection retains the correct organisation and transient screenshot; no partial save',async()=>{
 let saves=0;
 const services={exportContacts:async(e,options)=>{assert.equal(options.captureDiagnostics,true);return {format:'xlsx',workbook:e.THRIVE_EMAIL,diagnostic:{reason:'Export downloaded',image:'bWFza2Vk'}};},readWorkbook:async key=>{if(key===both.GYMTOTS_THRIVE_EMAIL)throw Object.assign(Error('invalid'),{code:'INVALID_ROSTER',stage:'validation',validation:{reason:'The account owner email is missing or invalid.',row:9}});return workbook('Gymini');},prepareRoster,fetch:async()=>{saves++;}};
 await assert.rejects(syncMembers(both,{},services),error=>{assert.equal(error.organisation,'Gymtots R OK');assert.equal(error.validation.row,9);assert.equal(error.diagnostic.image,'bWFza2Vk');return true;});assert.equal(saves,0);
});
test('only missing exported headings trigger one repair; both organisations still save atomically',async()=>{
 const calls=[];let saved=0;
 const services={exportContacts:async(e,options)=>{calls.push({email:e.THRIVE_EMAIL,repair:options.repairColumns===true});return {format:'xlsx',workbook:options.repairColumns?'repaired':e.THRIVE_EMAIL};},readWorkbook:async key=>{if(key===env.THRIVE_EMAIL)throw Object.assign(Error('missing headings'),{code:'INVALID_ROSTER',missingColumns:true});return workbook(key==='repaired'?'Gymini':'Gymtots');},prepareRoster,fetch:async()=>{saved++;return {ok:true,json:async()=>({accounts:1,members:1,staff:0})};}};
 const result=await syncMembers(both,{},services);assert.equal(result.membershipUpdated,true);assert.equal(saved,1);assert.deepEqual(calls,[{email:env.THRIVE_EMAIL,repair:false},{email:env.THRIVE_EMAIL,repair:true},{email:both.GYMTOTS_THRIVE_EMAIL,repair:false}]);
});
test('invalid contact values never open column management; repeated missing headings stop after one repair',async()=>{
 let exports=0,saves=0;const services={exportContacts:async()=>{exports++;return {format:'xlsx',workbook:'fixture'};},readWorkbook:async()=>{throw Object.assign(Error('bad row'),{code:'INVALID_ROSTER'});},prepareRoster,fetch:async()=>{saves++;}};
 await assert.rejects(syncMembers(env,{},services),{code:'INVALID_ROSTER'});assert.equal(exports,1);assert.equal(saves,0);
 exports=0;services.readWorkbook=async()=>{throw Object.assign(Error('missing headings'),{code:'INVALID_ROSTER',missingColumns:true});};await assert.rejects(syncMembers(env,{},services),{code:'INVALID_ROSTER'});assert.equal(exports,2);assert.equal(saves,0);
});
test('combined imports apply Gymtots age classification only to that source and share the Gymini key',async()=>{
 let body;const services={exportContacts:async e=>({format:'xlsx',workbook:e.THRIVE_EMAIL}),readWorkbook:async key=>workbook(key===env.THRIVE_EMAIL?'Gymini':'Monday - Hamble Under 2 Years - 9.30-10.10am'),prepareRoster,fetch:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({accounts:1,members:1,staff:0})};}};
 await syncMembers(both,{},services);assert.equal(body.p_rows[0].gymnasts.length,1);assert.deepEqual(body.p_rows[0].gymnasts[0].groups,['gymini','under_2_years']);assert.equal(body.p_sources.find(s=>s.key==='gymtots').members,1);
});
test('read-only diagnosis uses rollback preview, never the live apply RPC',async()=>{
 let called=0;const services={exportContacts:async e=>({format:'xlsx',workbook:e.THRIVE_EMAIL}),readWorkbook:async()=>workbook('Gymini'),prepareRoster,fetch:async(url)=>{called++;assert.match(url,/preview_dynamo_rosters$/);return {ok:true,json:async()=>({ok:false,error:'IDENTITY_REVIEW_REQUIRED',review:[{reason:'changed_details'}]})};}};
 const result=await syncMembers(both,{dryRun:true},services);assert.equal(result.error,'IDENTITY_REVIEW_REQUIRED');assert.equal(result.membershipUpdated,undefined);assert.equal(called,1);
});
test('conflicting cross-source profiles are skipped without granting benefits or blocking valid children',()=>{
 const a={email:'a@example.invalid',ownerName:'A',member:true,staff:false,gymnasts:[{sourceId:'collision',firstName:'Child',lastName:'One',dateOfBirth:'2020-01-01',bgNumber:'',groups:['gymini'],active:true}]};
 const b={...a,email:'b@example.invalid',gymnasts:[{...a.gymnasts[0],firstName:'Other'}]};
 const report={},merged=mergeRosters([{owners:[a]},{owners:[b]}],{skipInvalid:true,report});
 assert.equal(report.skipped.length,1);assert.equal(merged.length,2);assert.ok(merged.every(o=>!o.member&&o.preserveExisting&&o.gymnasts.length===0));
});
test('Gymtots BG expiry heading is mapped automatically without changing Dynamo mapping',()=>{
 const mapping={email:'owner email',firstName:'first name',lastName:'last name',dateOfBirth:'date of birth',bgNumber:'bg member number',timeClass:'class',identityPolicy:'email_name_dob',membershipPolicy:'assigned_classes'};
 const columns=Object.values(mapping).map((label,i)=>({label,index:i+1})).concat({label:'bg expiry date',index:10});
 assert.equal(sourceMapping({key:'gymtots'},columns,mapping).bgExpiryDate,'bg expiry date');
 assert.equal(sourceMapping({key:'dynamo'},columns,mapping).bgExpiryDate,undefined);
 assert.equal(sourceMapping({key:'gymtots'},columns,{...mapping,bgExpiryDate:'date label'}).bgExpiryDate,'bg expiry date');
 assert.equal(sourceMapping({key:'gymtots'},[{label:'date of birth',index:1}],mapping).bgExpiryDate,undefined);
});
test('Gymtots Excel date cells import BG renewals and restore per-gymnast member benefits',async()=>{
 const Excel=require('exceljs'),{readWorkbook,prepareRoster}=require('../server/member-roster.cjs'),{isMember}=require('../public/manage/membership.js');
 const workbook=new Excel.Workbook(),sheet=workbook.addWorksheet('Contacts');sheet.addRow(['last name','first name','owner email','account owner','date of birth','bg member number','class','bg expiry date']);
 sheet.addRow(['Fixture','Child','parent@example.invalid','Parent','2022-01-01','BG-TEST','Friday - Hamble 3-4 Years - 9.30-10.10am',new Date('2027-01-31T00:00:00Z')]);
 const parsed=await readWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()),{allowClassHeading:true}),mapping={email:'owner email',ownerName:'account owner',firstName:'first name',lastName:'last name',dateOfBirth:'date of birth',bgNumber:'bg member number',timeClass:'class',identityPolicy:'email_name_dob',membershipPolicy:'assigned_classes'};
 const child=prepareRoster(parsed,sourceMapping({key:'gymtots'},parsed.columns,mapping),{},{source:'gymtots'})[0].gymnasts[0];
 assert.equal(child.bgExpiryDate,'2027-01-31');assert.equal(isMember(child,'2026-10-30'),true);assert.equal(isMember({...child,bgExpiryDate:null},'2026-10-30'),false);
});
