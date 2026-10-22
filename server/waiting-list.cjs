const rules=require('../public/join-the-waiting-list/rules.js');
const {sameOrigin}=require('./admin-auth.cjs');
const {all}=require('./store.cjs');
async function schedule(env){
 if(env.SUPABASE_URL){const rows=await all(env,'dynamo_classes?select=id,details&archived=eq.false&details->>status=eq.Published');return rows.map(r=>({...r.details,id:r.id}));}
 // A preview can read the public timetable without access to production secrets.
 if(env.VERCEL_ENV==='preview'){const res=await fetch('https://dynamogymnastics.co.uk/api/results/?kind=classes',{signal:AbortSignal.timeout(10000)});if(!res.ok)throw Error('SCHEDULE_UNAVAILABLE');return (await res.json()).records;}
 throw Error('SCHEDULE_UNAVAILABLE');
}
function confirmation(data){return `Hi ${data.parent},\n\nThank you for joining the Dynamo Gymnastics waiting list.\n\n${data.children.map(c=>`${c.first} ${c.last}\n${c.classes.map(r=>`${r.category}: ${r.location||'Hamble'}, ${r.day} ${r.start}–${r.end}`).join('\n')}`).join('\n\n')}\n\n${data.together?'You’ve asked for your children to attend on the same day and at the same time.\n\n':''}We’ll contact you when a suitable place becomes available to arrange a paid taster session. Joining the waiting list does not reserve a space or take a payment.\n\nDynamo Gymnastics`;}
function makeWaitingListHandler(env=process.env,services={schedule,submit:require('./waiting-list-submit.cjs').submit}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 if(req.method==='POST'&&!sameOrigin(req))return res.status(403).json({message:'Please use the Dynamo website form.'});
 try{const records=await services.schedule(env);if(req.method==='GET')return res.status(200).json({records:records.filter(c=>(c.location||'Hamble')==='Hamble'&&['Gyminis','Recreational'].includes(c.category)),preview:env.VERCEL_ENV!=='production'});
 if(req.body?.website)return res.status(200).json({ok:true,confirmation:''});
 let data;try{data=rules.validate(req.body||{},records);}catch(e){return res.status(400).json({message:e.message});}
 // Preview is explicitly side-effect free, even if production secrets are inherited.
 if(env.VERCEL_ENV!=='production')return res.status(200).json({ok:true,preview:true,confirmation:confirmation(data)});
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.body.requestId||''))return res.status(400).json({message:'Please reload the form before submitting.'});
 const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 try{const result=await services.submit(env,data,req.body.requestId,ip);return res.status(result.pending?202:200).json(result);}catch(e){return res.status(e.code==='WAITING_RATE_LIMIT'?429:503).json({message:e.code==='WAITING_RATE_LIMIT'?'Too many submissions. Please try again later or contact us.':'We could not submit your form. Please try again or contact us.'});}
 }catch{return res.status(503).json({message:'We could not load the current class schedule. Please try again.'});}
};}
module.exports={makeWaitingListHandler,confirmation,schedule};
