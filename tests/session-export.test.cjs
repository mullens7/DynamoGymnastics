const {test}=require('node:test'),assert=require('node:assert/strict'),Excel=require('exceljs');
const {sessionWorkbook,makeSessionExportHandler}=require('../server/session-export.cjs');
const sessionId='11111111-1111-4111-8111-111111111111';
function booking(extra={}){return {status:'Booked',payment_pending:false,gymnast:{first_name:'Child',last_name:'One',date_of_birth:'2018-09-01'},owner:{owner_name:'Parent One',email:'parent@example.invalid'},responses:[{id:'confirm',type:'acknowledgement',value:true},{id:'phone',type:'phone',value:'07700123456'},{id:'size',type:'dropdown',value:'Small'},{id:'other-event',type:'short_text',value:'Must not appear'}],price_pence:12345,...extra};}
const fields=[{id:'confirm',type:'acknowledgement',label:'I confirm the terms'},{id:'phone',type:'phone',label:'Emergency contact number'},{id:'size',type:'dropdown',label:'T-shirt size'}];
test('session XLSX contains exactly four profile columns and this activity’s configured fields',async()=>{
 const buffer=await sessionWorkbook({bookingFields:fields},[booking(),booking(),booking({status:'Cancelled'}),booking({payment_pending:true})]);
 const wb=new Excel.Workbook();await wb.xlsx.load(buffer);const s=wb.worksheets[0];
 assert.deepEqual(s.getRow(1).values.slice(1),['Child’s full name','Child’s date of birth','Adult/account owner full name','Account email address','I confirm the terms','Emergency contact number','T-shirt size']);
 assert.deepEqual(s.getRow(2).values.slice(1),['Child One','01/09/2018','Parent One','parent@example.invalid','Confirmed','07700123456','Small']);
 assert.equal(s.rowCount,3);assert.equal(s.columnCount,7);assert.equal(s.getRow(3).getCell(1).value,'Child One');assert.equal(s.views[0].state,'frozen');
});
test('different settings produce different columns, missing answers stay blank and inputs never become formulas',async()=>{
 const fields=[{id:'date',type:'date',label:'Date'},{id:'multi',type:'multiselect',label:'Choices'},{id:'text',type:'short_text',label:'Notes'}];
 const b=booking({responses:[{id:'date',type:'date',value:'2026-10-28'},{id:'multi',type:'multiselect',value:['A','B']},{id:'text',type:'short_text',value:'=HYPERLINK("bad")'}]});
 const wb=new Excel.Workbook();await wb.xlsx.load(await sessionWorkbook({bookingFields:fields},[b,booking()]));const s=wb.worksheets[0];
 assert.equal(s.getCell('E2').value,'28/10/2026');assert.equal(s.getCell('F2').value,'A; B');assert.equal(s.getCell('G2').type,Excel.ValueType.String);assert.equal(s.getCell('G2').value,'=HYPERLINK("bad")');assert.equal(s.getCell('E3').value,'');
 const empty=new Excel.Workbook();await empty.xlsx.load(await sessionWorkbook({bookingFields:[]},[]));assert.equal(empty.worksheets[0].columnCount,4);assert.equal(empty.worksheets[0].rowCount,1);
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};}
test('export authorizes event managers before reading private participant data',async()=>{
 for(const method of ['GET','POST']){const res=response();await makeSessionExportHandler({}, {authorizeAdmin:async(req,env,p)=>{assert.equal(p,'events.manage');return false;},all:async()=>{throw Error('No data access allowed');}})({method,query:{sessionId}},res);assert.equal(res.code,403);}
});
test('export reads only the requested session, excludes payment fields and returns XLSX attachment',async()=>{
 const res=response(),paths=[];await makeSessionExportHandler({}, {authorizeAdmin:async()=>true,all:async(env,path)=>{paths.push(path);if(path.startsWith('dynamo_events?'))return [{id:sessionId,details:{name:'Fun Sessions',date:'2026-10-28',time:'11:00',bookingFields:fields}}];return [booking()];}})({method:'GET',query:{sessionId}},res);
 assert.equal(res.code,200);assert.match(res.headers['Content-Type'],/spreadsheetml/);assert.match(res.headers['Content-Disposition'],/\.xlsx"$/);assert.ok(Buffer.isBuffer(res.body));assert.match(paths[1],new RegExp('event_id=eq.'+sessionId));assert.match(paths[1],/payment_pending=eq.false/);assert.doesNotMatch(paths[1],/price_pence|purchase|transactions/);assert.equal(res.headers['Cache-Control'],'private, no-store');
});
