const {authorizeAdmin}=require('./admin-auth.cjs');
const {all,store}=require('./store.cjs');
function validateInternalEvent(input={}){
 const name=String(input.name||'').trim(),notes=String(input.notes||'').trim(),date=input.date,time=input.time||'',endTime=input.endTime||'';
 if(!name||name.length>120||notes.length>5000)throw Error('Enter a title of up to 120 characters and notes of up to 5,000 characters.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Choose a valid date.');
 const validTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
 if(time&&!validTime(time)||endTime&&(!time||!validTime(endTime)||endTime<=time))throw Error('Enter valid times, with the end after the start, or leave both blank.');
 return {name,notes,date,time,endTime};
}
function makeClubCalendarHandler(env=process.env,services={authorizeAdmin,all,store}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!await services.authorizeAdmin(req,env,'super_admin'))return res.status(403).json({message:'Calendar management access required.'});
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 const id=req.query?.id;if(['PATCH','DELETE'].includes(req.method)&&!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')))return res.status(400).json({message:'Choose a valid internal event.'});
 let details;if(['POST','PATCH'].includes(req.method))try{details=validateInternalEvent(req.body);}catch(e){return res.status(400).json({message:e.message});}
 try{
 if(req.method==='GET'){const rows=await services.all(env,'dynamo_internal_events?select=id,details&archived=eq.false&order=created_at.desc');return res.status(200).json({records:rows.map(r=>({...r.details,id:r.id}))});}
 const path='dynamo_internal_events'+(id?'?id=eq.'+id+'&archived=eq.false':'');
 const rows=await services.store(env,path,{method:req.method==='POST'?'POST':'PATCH',body:JSON.stringify(req.method==='DELETE'?{archived:true}:{details})});
 if(!rows?.length)return res.status(404).json({message:'Internal event not found.'});return res.status(req.method==='POST'?201:200).json({ok:true});
 }catch{return res.status(503).json({message:'Internal calendar events could not be saved or loaded. Please try again.'});}
};}
module.exports={validateInternalEvent,makeClubCalendarHandler};
