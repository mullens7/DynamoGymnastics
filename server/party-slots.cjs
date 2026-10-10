const {authorizeAdmin}=require('./admin-auth.cjs');
const {rpc}=require('./store.cjs');
const {validate}=require('./admin-records.cjs');
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose valid dates.');const d=new Date(value+'T12:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==value)throw Error('Choose valid dates.');return d;}
function slots(input){
 const start=day(input.start),end=day(input.end);
 if(end<start||end-start>3*366*86400000)throw Error('Choose a date range of up to three years.');
 if(!Array.isArray(input.days)||!input.days.length||input.days.some(n=>!Number.isInteger(n)||n<0||n>6))throw Error('Select at least one weekday.');
 if(!Array.isArray(input.times)||!input.times.length||input.times.length>10)throw Error('Add between one and ten times.');
 const base=validate('parties',{...input,date:input.start,time:input.times[0],status:'Pending'}),rows=[];
 for(let d=start;d<=end;d=new Date(+d+86400000)){if(input.days.includes(d.getUTCDay()))for(const time of [...new Set(input.times)])rows.push(validate('parties',{...base,date:d.toISOString().slice(0,10),time}));}
 if(!rows.length||rows.length>1000)throw Error('Choose a range containing between 1 and 1,000 slots.');
 return rows;
}
function makePartySlotsHandler(env=process.env,services={rpc,authorizeAdmin}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!await services.authorizeAdmin(req,env))return res.status(401).json({message:'Sign in to management.'});
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed.'});
 let body;try{
 if(req.body?.action==='create')body={p_action:'create',p_slots:slots(req.body),p_start:null,p_end:null,p_reason:''};
 else if(['block','unblock'].includes(req.body?.action)){const start=day(req.body.start),end=day(req.body.end);if(end<start||end-start>3*366*86400000)throw Error('Choose a valid date range.');const reason=String(req.body.reason||'').trim();if(req.body.action==='block'&&(!reason||reason.length>200))throw Error('Enter a blocking reason of up to 200 characters.');body={p_action:req.body.action,p_slots:[],p_start:req.body.start,p_end:req.body.end,p_reason:reason};}
 else throw Error('Choose an action.');
 }catch(e){return res.status(400).json({message:e.message});}
 try{const result=await services.rpc(env,'manage_dynamo_party_slots',body);return res.status(200).json(result);}catch{return res.status(502).json({message:'Slots could not be updated. No partial update was applied.'});}
};}
module.exports={makePartySlotsHandler,slots};
