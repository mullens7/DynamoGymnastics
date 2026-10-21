const {scrypt,randomBytes,randomUUID,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const {store,rpc}=require('./store.cjs');
const {currentActor,sessionToken,hash,cookie}=require('./user-auth.cjs');
const {sameOrigin}=require('./admin-auth.cjs');
const {supportCookie}=require('./developer-support.cjs');
const derive=promisify(scrypt),DEVELOPER_EMAIL='freddie@mullens.com';
const pattern=/^scrypt\$65536\$8\$2\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
function validatePassword(value){if(typeof value!=='string'||value.length<16||value.length>128||!/[\p{L}]/u.test(value)||!/[0-9]/.test(value)||!/[^\p{L}\p{N}\s]/u.test(value))throw Error('Use 16–128 characters, including a letter, number and special character.');return value;}
async function hashPassword(value){validatePassword(value);const salt=randomBytes(16).toString('hex'),key=await derive(value,salt,64,{N:65536,r:8,p:2,maxmem:96*1024*1024});return 'scrypt$65536$8$2$'+salt+'$'+key.toString('hex');}
async function verifyPassword(value,encoded){const match=pattern.exec(encoded||'');if(typeof value!=='string'||value.length>128||!match)return false;const key=await derive(value,match[1],64,{N:65536,r:8,p:2,maxmem:96*1024*1024});return timingSafeEqual(key,Buffer.from(match[2],'hex'));}
async function passwordConfigured(env,services={store}){return (await services.store(env,'dynamo_developer_passwords?select=version&email=eq.'+DEVELOPER_EMAIL+'&limit=1')).length>0;}
function ipHash(req,env){const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();return require('./login.cjs').digest(env,'developer-password-ip:'+ip);}
function makeDeveloperPasswordHandler(env=process.env,services={store,rpc,currentActor,hashPassword,verifyPassword}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const limited=result=>{res.setHeader('Retry-After',String(result.retryAfter||900));return res.status(429).json({message:'Too many password attempts. Please wait before trying again.',retryAfter:result.retryAfter||900});};
 try{
 if(req.method==='GET'&&req.query?.action==='password-settings'){
  const actor=await services.currentActor(req,env);if(!actor?.isDeveloper||actor.email!==DEVELOPER_EMAIL)return res.status(actor?403:401).json({message:'Developer access required.'});
  return res.status(200).json({configured:await passwordConfigured(env,services)});
 }
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed.'});
 if(!sameOrigin(req))return res.status(403).json({message:'Open the Dynamo website to continue.'});
 const body=req.body||{};
 if(body.action==='password'){
  if(String(body.email||'').trim().toLowerCase()!==DEVELOPER_EMAIL||typeof body.password!=='string'||body.password.length>128)return res.status(401).json({message:'Email or password is incorrect.'});
  const attempt=randomUUID(),reservation=await services.rpc(env,'reserve_dynamo_developer_password_attempt',{p_id:attempt,p_ip:ipHash(req,env)});
  if(!reservation.ok){if(reservation.error==='PASSWORD_RATE_LIMIT')return limited(reservation);return res.status(403).json({message:'Set your developer password from your signed-in developer dashboard first.'});}
  const valid=await services.verifyPassword(body.password,reservation.passwordHash),token=randomBytes(32).toString('hex');
  const result=await services.rpc(env,'finish_dynamo_developer_password_attempt',{p_attempt:attempt,p_version:reservation.version,p_valid:valid,p_session_hash:hash(token)});
  if(!result.ok)return res.status(401).json({message:'Email or password is incorrect.'});
  res.setHeader('Set-Cookie',[cookie(token,43200,req),supportCookie('',0)]);return res.status(200).json({ok:true});
 }
 if(body.action==='set-password'){
  const actor=await services.currentActor(req,env),token=sessionToken(req);
  if(!actor?.isDeveloper||actor.email!==DEVELOPER_EMAIL||!token)return res.status(actor?403:401).json({message:'Sign in to your developer account to set its password.'});
  try{validatePassword(body.newPassword);}catch(e){return res.status(400).json({message:e.message});}
  let version=null;
  if(await passwordConfigured(env,services)){
   if(typeof body.currentPassword!=='string'||!body.currentPassword||body.currentPassword.length>128)return res.status(400).json({message:'Enter your current developer password.'});
   const attempt=randomUUID(),reservation=await services.rpc(env,'reserve_dynamo_developer_password_attempt',{p_id:attempt,p_ip:ipHash(req,env)});
   if(!reservation.ok)return limited(reservation);
   const valid=await services.verifyPassword(body.currentPassword,reservation.passwordHash);
   const result=await services.rpc(env,'finish_dynamo_developer_password_attempt',{p_attempt:attempt,p_version:reservation.version,p_valid:valid,p_session_hash:null});
   if(!result.ok)return res.status(400).json({message:'Your current password is incorrect.'});version=reservation.version;
  }
  const encoded=await services.hashPassword(body.newPassword);
  await services.rpc(env,'set_dynamo_developer_password',{p_actor:actor.id,p_session_hash:hash(token),p_password_hash:encoded,p_expected_version:version});
  res.setHeader('Set-Cookie',[cookie(token,43200,req),supportCookie('',0)]);return res.status(200).json({ok:true});
 }
 return res.status(400).json({message:'Choose a password action.'});
 }catch(e){if(e.code==='DEVELOPER_FORBIDDEN')return res.status(401).json({message:'Your developer session has expired. Please sign in again.'});return res.status(e.code==='PASSWORD_CHANGED'?409:503).json({message:e.code==='PASSWORD_CHANGED'?'Your password settings changed. Reload this page before continuing.':'Password login is temporarily unavailable. Please try again shortly.'});}
};}
module.exports={DEVELOPER_EMAIL,hashPassword,verifyPassword,validatePassword,passwordConfigured,makeDeveloperPasswordHandler};
