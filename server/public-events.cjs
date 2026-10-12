const {catalog}=require('./account.cjs');
const {currentUser}=require('./user-auth.cjs');
const {all}=require('./store.cjs');
function makePublicEventsHandler(env=process.env,services={catalog,currentUser,all}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({message:'Method not allowed.'});
 try{const user=await services.currentUser(req,env),gymnasts=user?await services.all(env,'dynamo_gymnasts?select=id,groups,active,date_of_birth&account_id=eq.'+user.id):[];
 const data=await services.catalog(env,user||{roster_member:false},gymnasts);
 const grouped=new Map();for(const e of [...data.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))){const key=e.parentId||e.id;if(!grouped.has(key))grouped.set(key,{id:key,name:e.name,slug:e.slug||e.id,description:e.description||'',image:e.image||'',date:e.date,time:e.time,audience:e.audience,memberPriceCents:e.memberPriceCents,nonMemberPriceCents:e.nonMemberPriceCents,sessions:[]});grouped.get(key).sessions.push({id:e.id,date:e.date,time:e.time,label:e.label||'',minAge:e.minAge,maxAge:e.maxAge,capacity:e.capacity});}
 return res.status(200).json({records:[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)),member:!!user?.roster_member});
 }catch{return res.status(503).json({message:'Events could not be loaded. Please try again.'});}
};}
module.exports={makePublicEventsHandler};
