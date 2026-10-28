const Excel=require('exceljs');
const {authorizeAdmin}=require('./admin-auth.cjs');
const {all}=require('./store.cjs');
const {uuid}=require('./login.cjs');
function exportValue(value,type){
 if(value===null||value===undefined||value==='')return '';
 if(type==='acknowledgement'||typeof value==='boolean')return value===true?'Confirmed':value===false?'Not confirmed':String(value);
 if(Array.isArray(value))return value.map(String).join('; ');
 if(type==='date')return ukDate(value);
 return String(value);
}
function ukDate(value){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));return m?m[3]+'/'+m[2]+'/'+m[1]:String(value||'');}
function answerFor(row,field){
 const answers=Array.isArray(row.responses)?row.responses:[];
 let answer=answers.find(a=>a.id===field.id&&a.type===field.type);
 if(!answer&&row.selection?.legacyImport){const matches=answers.filter(a=>String(a.id).startsWith('legacy-')&&a.label===field.label&&a.type===field.type);if(matches.length===1)answer=matches[0];}
 return answer?exportValue(answer.value,field.type):'';
}
async function sessionWorkbook(details,bookings){
 const fields=Array.isArray(details.bookingFields)?details.bookingFields:[];
 const workbook=new Excel.Workbook();workbook.creator='Dynamo Gymnastics';
 const sheet=workbook.addWorksheet('Participants',{views:[{state:'frozen',ySplit:1}]});
 sheet.columns=[{header:"Child’s full name",width:30},{header:"Child’s date of birth",width:22},{header:'Adult/account owner full name',width:34},{header:'Account email address',width:38},...fields.map(f=>({header:f.label,width:45}))];
 for(const row of bookings){
  if(row.status!=='Booked'||row.payment_pending===true)continue;
  const g=row.gymnast||{},owner=row.owner||{};
  // Strings are assigned as values, never Excel formula objects (including =, +, - and @ prefixes).
  sheet.addRow([[g.first_name,g.last_name].filter(Boolean).join(' '),ukDate(g.date_of_birth),owner.owner_name||'',owner.email||'',...fields.map(f=>answerFor(row,f))]);
 }
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1656A4'}};sheet.getRow(1).alignment={vertical:'middle',wrapText:true};sheet.getRow(1).height=42;
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};
 sheet.eachRow((row,n)=>{if(n>1)row.alignment={vertical:'top',wrapText:true};row.eachCell(cell=>{cell.numFmt='@';});});
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
function makeSessionExportHandler(env=process.env,services={authorizeAdmin,all}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Cookie');
 try{
  if(!await services.authorizeAdmin(req,env,'events.manage'))return res.status(403).json({message:'Event management access is required to export participants.'});
  if(req.method!=='GET')return res.status(405).json({message:'Method not allowed.'});
  const id=req.query?.sessionId;if(!uuid(id))return res.status(400).json({message:'Choose an activity session to export.'});
  const sessions=await services.all(env,'dynamo_events?select=id,details&id=eq.'+id);const session=sessions[0];
  if(!session||Array.isArray(session.details?.sessions))return res.status(404).json({message:'Choose an individual activity session.'});
  let details=session.details||{};
  if(!Array.isArray(details.bookingFields)&&uuid(details.parentId)){const parents=await services.all(env,'dynamo_events?select=details&id=eq.'+details.parentId);details={...details,bookingFields:parents[0]?.details?.bookingFields||[]};}
  const rows=await services.all(env,'dynamo_event_bookings?select=status,payment_pending,responses,selection,gymnast:dynamo_gymnasts(first_name,last_name,date_of_birth),owner:dynamo_accounts!dynamo_event_bookings_account_id_fkey(owner_name,email)&event_id=eq.'+id+'&status=eq.Booked&payment_pending=eq.false&order=created_at.asc,id.asc');
  const file=await sessionWorkbook(details,rows);const stem=[details.name||'Activity',details.internalId||id,details.date,details.time].filter(Boolean).join('-').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,160);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="'+stem+'.xlsx"');return res.status(200).send(file);
 }catch{return res.status(503).json({message:'The participant export could not be created. Please try again.'});}
};}
module.exports={makeSessionExportHandler,sessionWorkbook,answerFor};
