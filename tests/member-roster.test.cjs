const {test}=require('node:test');const assert=require('node:assert/strict');
const Excel=require('exceljs');const {readWorkbook,prepareRoster,reconcile}=require('../server/member-roster.cjs');
const headers=['Contact ID','Owner email','Account owner','First name','Last name','Time and Class','Date of birth','BG membership number','Status'];
const mapping={id:'Contact ID',email:'Owner email',ownerName:'Account owner',firstName:'First name',lastName:'Last name',timeClass:'Time and Class',dateOfBirth:'Date of birth',bgNumber:'BG membership number',status:'Status',activeValues:['Active']};
async function fixture(rows){const wb=new Excel.Workbook(),sheet=wb.addWorksheet('Contacts');sheet.addRow(headers);sheet.addRows(rows);return readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));}
test('XLSX parsing groups siblings, staff parents and staff-only owners',async()=>{
 const wb=await fixture([
 ['g1',' OWNER@example.invalid ','Example Parent','Child','One','Girls Advanced Recreational, Junior Coach','2016-01-02','BG1','Active'],
 ['g2','owner@example.invalid','Example Parent','Child','Two','Gymini','2018-02-03','BG2','Active'],
 ['s1','staff@example.invalid','Staff Owner','Staff','Only','Senior Coach','','','Active'],
 ['g3','former@example.invalid','Former Parent','Former','Child','MA Development 5 Hours','2012-01-01','','Inactive']]);
 const result=prepareRoster(wb,mapping);assert.equal(result.length,3);assert.equal(result[0].gymnasts.length,2);assert.deepEqual(result[0].gymnasts[0].groups,['advanced']);assert.equal(result[0].staff,true);
 assert.equal(result[1].staff,true);assert.equal(result[1].member,false);assert.equal(result[1].gymnasts.length,0);assert.equal(result[2].member,false);
});
test('repeated sync and leaving the club retain IDs, purchases, transactions and login linkage',()=>{
 const original=[{id:'permanent-account',email:'owner@example.invalid',authUserId:'permanent-login',member:true,staff:true,purchases:[{id:'purchase'}],transactions:[{id:'declined',status:'declined'},{id:'paid',status:'successful'}],gymnasts:[{id:'permanent-profile',sourceId:'g1',active:true,firstName:'Child'}]}];
 const owner={email:'owner@example.invalid',ownerName:'Parent',member:true,staff:false,gymnasts:[{sourceId:'g1',firstName:'Child',lastName:'One',groups:['advanced'],active:true}]};
 const first=reconcile(original,[owner],()=>{throw new Error('Existing account recreated');});
 const repeated=reconcile(first,[owner],()=>{throw new Error('Existing account recreated');});assert.deepEqual(repeated,first);
 const left=reconcile(repeated,[],()=>{throw new Error('Existing account recreated');});
 assert.equal(left[0].id,original[0].id);assert.equal(left[0].authUserId,original[0].authUserId);assert.deepEqual(left[0].purchases,original[0].purchases);assert.deepEqual(left[0].transactions,original[0].transactions);
 assert.equal(left[0].member,false);assert.equal(left[0].staff,false);assert.equal(left[0].gymnasts[0].active,false);assert.equal(left[0].gymnasts[0].id,'permanent-profile');assert.equal(original[0].member,true);
});
test('unsafe snapshots and missing membership contracts fail before import',async()=>{
 const wb=await fixture([['g1','owner@example.invalid','Parent','Child','One','Gymini','','','Active']]);
 assert.throws(()=>prepareRoster(wb,{...mapping,id:'Missing column'}),{code:'ROSTER_MAPPING_REQUIRED'});
 const noStatus={...mapping};delete noStatus.status;assert.throws(()=>prepareRoster(wb,noStatus),{code:'ROSTER_MAPPING_REQUIRED'});
 const duplicate=await fixture([['g1','a@example.invalid','','Child','One','Gymini','','','Active'],['g1','a@example.invalid','','Child','One','Gymini','','','Active']]);assert.throws(()=>prepareRoster(duplicate,mapping),{code:'IDENTITY_REVIEW_REQUIRED'});
 const unknown=await fixture([['g2','a@example.invalid','','Child','Two','Unmapped Class','','','Active']]);const report={};const nonmembers=prepareRoster(unknown,mapping,report);assert.equal(nonmembers[0].member,false);assert.equal(nonmembers[0].gymnasts.length,0);assert.equal(report.unmappedRows,1);assert.deepEqual(report.unmappedClasses,[{label:'Unmapped Class',rows:1}]);
 const ambiguous=await fixture([['g3','a@example.invalid','','Child','Two','WA Dev Comp 9 Hours','','','Active']]);const development=prepareRoster(ambiguous,mapping);assert.equal(development[0].member,true);assert.deepEqual(development[0].gymnasts[0].groups,['womens_development']);
});
test('unconfigured durable storage fails before Browserless or email calls',async()=>{
 const {syncMembers}=require('../server/member-sync.cjs');await assert.rejects(syncMembers({}),{code:'DATABASE_NOT_CONFIGURED'});
});
test('protected export inspection returns headings/counts without contact values or workbook bytes',async()=>{
 const {makeHandler}=require('../server/sync-handler.cjs');const wb=new Excel.Workbook();const sheet=wb.addWorksheet('Contacts');sheet.addRow(headers);sheet.addRow(['private-id','private@example.invalid','Private Parent','Private','Child','Gymini','','','Active']);const bytes=Buffer.from(await wb.xlsx.writeBuffer());
 const key='fictional-administrator-key-at-least-32';let options;
 const handler=makeHandler({SYNC_TEST_KEY:key},async(env,o)=>{options=o;return {format:'xlsx',bytes:bytes.length,workbook:bytes};});
 const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{authorization:'Bearer '+key},body:{mode:'inspect'}},res);
 assert.equal(res.code,200);assert.equal(options.includeWorkbook,true);assert.equal(res.body.rowCount,1);assert.deepEqual(res.body.columns,headers);assert.equal('workbook' in res.body,false);assert.equal(JSON.stringify(res.body).includes('private@example.invalid'),false);
});
test('new secret API keys use apikey only, legacy service keys retain JWT authorization',()=>{
 const {database}=require('../server/database.cjs');
 const url='https://fixture.supabase.co';
 assert.deepEqual(database({SUPABASE_URL:url,SUPABASE_SECRET_KEY:'sb_secret_fixture'}).headers,{apikey:'sb_secret_fixture'});
 assert.deepEqual(database({SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'fixture-jwt'}).headers,{apikey:'fixture-jwt',Authorization:'Bearer fixture-jwt'});
 assert.throws(()=>database({SUPABASE_URL:'https://other.example',SUPABASE_SECRET_KEY:'sb_secret_fixture'}),{code:'DATABASE_NOT_CONFIGURED'});
});

test('the seven-column Thrive4 export has repeatable profile IDs independent of class and BG number',async()=>{
 const h=['last name','first name','time and class','account owner','owner email','*bg membership number','date of birth'];
 const mapping={lastName:h[0],firstName:h[1],timeClass:h[2],ownerName:h[3],email:h[4],bgNumber:h[5],dateOfBirth:h[6],identityPolicy:'email_name_dob',membershipPolicy:'assigned_classes'};
 async function roster(group,bg){const wb=new Excel.Workbook(),sheet=wb.addWorksheet('Contacts');sheet.addRow(h);sheet.addRows([['One','Child',group,'Parent',' OWNER@example.invalid ',bg,'02/01/2016'],['Two','Child','Gymini','Parent','owner@example.invalid','','03/02/2018'],['Coach','Junior','Junior Coach','Staff','staff@example.invalid','','']]);return prepareRoster(await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer())),mapping);}
 const first=await roster('Girls Advanced Recreational','BG1'),later=await roster('WA Mini Club A 9 Hours','BG2');
 assert.equal(first[0].gymnasts[0].sourceId,later[0].gymnasts[0].sourceId);assert.equal(first[0].gymnasts[0].dateOfBirth,'2016-01-02');assert.equal(first[0].gymnasts.length,2);assert.equal(first[1].staff,true);assert.equal(first[1].gymnasts.length,0);
 const {profileIdentity,canonicalDate}=require('../server/member-roster.cjs');assert.throws(()=>profileIdentity('a@example.invalid','Child','One',null),{code:'IDENTITY_REVIEW_REQUIRED'});assert.throws(()=>canonicalDate('31/02/2016'),{code:'IDENTITY_REVIEW_REQUIRED'});
});
