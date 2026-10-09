const {randomInt,randomUUID,randomBytes,createHmac}=require('node:crypto');
const {sameOrigin}=require('./admin-auth.cjs');
const {currentUser,cookie,hash,signOut}=require('./user-auth.cjs');
const {rpc,store}=require('./store.cjs');
const {sendEmail}=require('./email.cjs');
const {isWebsiteAdmin}=require('./roles.cjs');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
function digest(env,value){if(!env.SYNC_TEST_KEY||env.SYNC_TEST_KEY.length<32)throw Error('LOGIN_NOT_CONFIGURED');return createHmac('sha256',env.SYNC_TEST_KEY).update('dynamo-login-v1:'+value).digest('hex');}
function makeLoginHandler(env=process.env,services={rpc,store,sendEmail,currentUser,signOut}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
 if(req.method==='GET'){const user=await services.currentUser(req,env);return res.status(user?200:401).json(user?{user}:{message:'Please log in.'});}
 if(!['POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 if(!sameOrigin(req))return res.status(403).json({message:'Open the Dynamo website to log in.'});
 if(req.method==='DELETE'){await services.signOut(req,env);res.setHeader('Set-Cookie',cookie('',0));return res.status(200).json({ok:true});}
 if(req.body?.action==='request'){
  const address=String(req.body.email||'').trim().toLowerCase();if(!email(address))return res.status(400).json({message:'Enter a valid email address.'});
  const id=randomUUID(),code=String(randomInt(0,10000)).padStart(4,'0');
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
  const result=await services.rpc(env,'request_dynamo_code',{p_id:id,p_email:address,p_ip:digest(env,'ip:'+ip),p_hash:digest(env,id+':'+code)});
  if(!result.ok)return res.status(429).json({message:'Please wait before requesting another code. You can request up to five codes per hour.'});
  try{await services.sendEmail({to:address,subject:'Your Dynamo Gymnastics login code',text:`Your Dynamo Gymnastics login code is ${code}.\n\nIt expires in 10 minutes. Do not share this code with anyone.\n\nIf you did not request it, you can ignore this email.`,html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#25364b"><h2>Dynamo Gymnastics</h2><p>Your login code is:</p><p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#19569b">${code}</p><p>Enter it on the Dynamo website. It expires in 10 minutes.</p><p>Do not share this code. If you did not request it, you can ignore this email.</p></div>`},env);}
  catch{await services.store(env,'dynamo_login_codes?id=eq.'+id,{method:'PATCH',body:JSON.stringify({consumed:true})});throw Error('EMAIL_DELIVERY_FAILED');}
  return res.status(200).json({challengeId:id,expiresIn:600});
 }
 if(req.body?.action==='verify'){
  const {challengeId,code}=req.body;if(!uuid(challengeId)||!/^\d{4}$/.test(code||''))return res.status(400).json({message:'Enter the four-digit code.'});
  const token=randomBytes(32).toString('hex');const result=await services.rpc(env,'verify_dynamo_code',{p_id:challengeId,p_hash:digest(env,challengeId+':'+code),p_session_hash:hash(token)});
  if(!result.ok)return res.status(400).json({message:result.error==='OTP_INCORRECT'?'That code is incorrect. Please try again.':'That code has expired or has already been used. Request a new code.'});
  res.setHeader('Set-Cookie',cookie(token));return res.status(200).json({ok:true,websiteAdmin:isWebsiteAdmin(result.email)});
 }
 return res.status(400).json({message:'Choose a login action.'});
 }catch{return res.status(503).json({message:'Login is temporarily unavailable. Please try again shortly.'});}
};}
module.exports={makeLoginHandler,digest,email,uuid};
