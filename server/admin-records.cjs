const {database}=require('./database.cjs');
const {allowed}=require('./admin-auth.cjs');
const {groups}=require('../public/manage/membership.js');
const kinds={events:'dynamo_events',parties:'dynamo_parties',payments:'dynamo_transactions',bookings:'dynamo_event_bookings'};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function validate(kind,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Enter the record details.');
 const name=typeof input.name==='string'?input.name.trim():'';
 if(!name||name.length>120)throw Error('Enter a name of up to 120 characters.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||new Date(input.date+'T12:00:00Z').toISOString().slice(0,10)!==input.date)throw Error('Enter a valid date.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))throw Error('Enter a valid time.');
 const record={name,date:input.date,time:input.time};
 const count=input[kind==='parties'?'guests':'capacity'];if(!Number.isInteger(count)||count<1||count>10000)throw Error('Capacity must be between 1 and 10,000.');
 if(kind==='parties'){
  if(!['Big gym','Small gym'].includes(input.room)||!['Confirmed','Pending','Cancelled'].includes(input.status))throw Error('Select a valid room and status.');
  return {...record,guests:count,room:input.room,status:input.status};
 }
 for(const key of ['memberPriceCents','nonMemberPriceCents']){if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>1000000)throw Error('Enter valid member and non-member prices.');record[key]=input[key];}
 if(!['Draft','Published'].includes(input.status)||!['everyone','members','groups'].includes(input.audience))throw Error('Select a valid status and audience.');
 if(!Array.isArray(input.allowedGroups)||input.allowedGroups.length>Object.keys(groups).length||input.allowedGroups.some(g=>!Object.hasOwn(groups,g))||(input.audience==='groups'&&!input.allowedGroups.length))throw Error('Select valid member groups.');
 return {...record,capacity:count,status:input.status,audience:input.audience,allowedGroups:input.audience==='groups'?[...new Set(input.allowedGroups)]:[]};
}
async function request(config,url,options={}){
 const response=await fetch(url,{...options,headers:{...config.headers,'Content-Type':'application/json',Prefer:'return=representation',...options.headers},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('STORAGE_FAILED');return response.status===204?[]:response.json();
}
async function all(config,url){const rows=[];for(let offset=0;offset<=20000;offset+=500){url.searchParams.set('limit','500');url.searchParams.set('offset',String(offset));const page=await request(config,url);rows.push(...page);if(page.length<500)return rows;}throw Error('STORAGE_FAILED');}
function makeRecordsHandler(env=process.env){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!allowed(req,env))return res.status(401).json({message:'Sign in to management.'});
 const kind=req.query?.kind;if(!Object.hasOwn(kinds,kind))return res.status(400).json({message:'Choose a valid record type.'});
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 if(req.method!=='GET'&&!['events','parties'].includes(kind))return res.status(405).json({message:'These records are read only.'});
 let details;if(['POST','PATCH'].includes(req.method)){try{details=validate(kind,req.body);}catch(e){return res.status(400).json({message:e.message});}}
 if(['PATCH','DELETE'].includes(req.method)&&!uuid(req.query.id))return res.status(400).json({message:'Choose a valid record.'});
 try{
  const config=database(env),url=new URL(config.url+'/rest/v1/'+kinds[kind]);
  if(req.method==='GET'){
   url.searchParams.set('order','created_at.desc');
   if(['events','parties'].includes(kind)){url.searchParams.set('select','id,details');url.searchParams.set('archived','eq.false');}
   if(kind==='payments')url.searchParams.set('select','id,created_at,amount_pence,status,dynamo_accounts(email,owner_name),dynamo_purchases(details)');
   if(kind==='bookings'){url.searchParams.set('select','id,event_id,status,created_at,dynamo_accounts(email,owner_name),dynamo_gymnasts(first_name,last_name)');}
   const records=await all(config,url);return res.status(200).json({records:['events','parties'].includes(kind)?records.map(r=>({...r.details,id:r.id})):records});
  }
  if(req.method==='POST'){const rows=await request(config,url,{method:'POST',body:JSON.stringify({details})});return res.status(201).json({record:{...rows[0].details,id:rows[0].id}});}
  url.searchParams.set('id','eq.'+req.query.id);url.searchParams.set('archived','eq.false');
  const rows=await request(config,url,{method:'PATCH',body:JSON.stringify(req.method==='DELETE'?{archived:true}:{details})});
  if(!rows.length)return res.status(404).json({message:'The record is no longer available.'});
  return res.status(200).json(req.method==='DELETE'?{archived:true}:{record:{...rows[0].details,id:rows[0].id}});
 }catch{return res.status(502).json({message:'The records could not be saved or loaded. Please try again.'});}
};}
module.exports={makeRecordsHandler,validate};
