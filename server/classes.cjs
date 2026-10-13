const {all,store}=require('./store.cjs'),{authorizeAdmin}=require('./admin-auth.cjs');const rules=require('../public/classes/rules.js');
function validateClass(input){
 const name=String(input.name||input.category||'').trim(),description=String(input.description||'').trim();if(!name||name.length>120||description.length>3000)throw Error('Enter a class name up to 120 characters and description up to 3,000 characters.');
 if(!rules.categories.includes(input.category)||!rules.days.includes(input.day)||!['Draft','Published'].includes(input.status))throw Error('Choose a valid category, day and status.');
 const duration=rules.duration(input.start,input.end);if(duration===null)throw Error('Choose an end time after the start time.');
 if(!Number.isSafeInteger(input.priceCents)||input.priceCents<0||input.priceCents>1000000)throw Error('Enter a valid single-session price.');
 if(!['age','school'].includes(input.ageMode))throw Error('Choose an age requirement.');
 if(input.ageMode==='age'&&(!Number.isInteger(input.minAgeYears)||input.minAgeYears<0||input.minAgeYears>100||!Number.isInteger(input.minAgeMonths)||input.minAgeMonths<0||input.minAgeMonths>11))throw Error('Minimum age must use whole years and 0–11 months.');
 const maxAgeYears=input.maxAgeYears??null,maxAgeMonths=input.maxAgeMonths??null;if(maxAgeYears!==null||maxAgeMonths!==null){if(!Number.isInteger(maxAgeYears)||maxAgeYears<0||maxAgeYears>100||!Number.isInteger(maxAgeMonths)||maxAgeMonths<0||maxAgeMonths>11)throw Error('Maximum age must use whole years and 0–11 months.');if(maxAgeYears*12+maxAgeMonths<(input.ageMode==='school'?48:input.minAgeYears*12+input.minAgeMonths))throw Error('Maximum age cannot be below the minimum age.');}
 const options=input.options||[];if(!Array.isArray(options)||options.length>30)throw Error('Add up to 30 additional price options.');
 const pricing=options.map(o=>{const d=rules.duration(o.start,o.end),label=String(o.label||'').trim();if(d===null||!Number.isInteger(o.sessions)||o.sessions<1||o.sessions>1000||!Number.isSafeInteger(o.priceCents)||o.priceCents<0||o.priceCents>1000000||label.length>100)throw Error('Each price option needs valid times, a price and 1–1,000 sessions.');return {label,start:o.start,end:o.end,duration:d,sessions:o.sessions,priceCents:o.priceCents};});
 return {name,description,category:input.category,day:input.day,start:input.start,end:input.end,duration,priceCents:input.priceCents,ageMode:input.ageMode,minAgeYears:input.ageMode==='school'?0:input.minAgeYears,minAgeMonths:input.ageMode==='school'?0:input.minAgeMonths,maxAgeYears,maxAgeMonths,options:pricing,status:input.status};
}
function makeClassesHandler(env=process.env,admin=false,services={all,store,authorizeAdmin}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(admin&&!await services.authorizeAdmin(req,env))return res.status(401).json({message:'Sign in to management.'});
 if(!admin&&req.method!=='GET'||!['GET','POST','PATCH','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 const id=req.query?.id;if(['PATCH','DELETE'].includes(req.method)&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))return res.status(400).json({message:'Choose a valid class.'});
 let details;if(['POST','PATCH'].includes(req.method)){try{details=validateClass(req.body||{});}catch(e){return res.status(400).json({message:e.message});}}
 try{if(req.method==='GET'){const rows=await services.all(env,'dynamo_classes?select=id,details&archived=eq.false'+(admin?'':'&details->>status=eq.Published')+'&order=created_at.asc');return res.status(200).json({records:rows.map(r=>({...r.details,id:r.id})).sort((a,b)=>rules.days.indexOf(a.day)-rules.days.indexOf(b.day)||a.start.localeCompare(b.start)||a.name.localeCompare(b.name))});}
 const rows=await services.store(env,'dynamo_classes'+(req.method==='POST'?'':'?id=eq.'+id+'&archived=eq.false'),{method:req.method==='POST'?'POST':'PATCH',body:JSON.stringify(req.method==='DELETE'?{archived:true}:{details})});if(!rows.length)return res.status(404).json({message:'This class is no longer available.'});return res.status(req.method==='POST'?201:200).json(req.method==='DELETE'?{archived:true}:{record:{...rows[0].details,id:rows[0].id}});
 }catch{return res.status(503).json({message:'Classes could not be saved or loaded. Please try again.'});}
};}
module.exports={makeClassesHandler,validateClass};
