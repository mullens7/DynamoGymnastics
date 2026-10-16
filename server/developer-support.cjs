const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {store,all}=require('./store.cjs');
const {sameOrigin}=require('./admin-auth.cjs');
const {staffAccess}=require('./roles.cjs');
const COOKIE='__Host-dynamo-support';
const digest=s=>createHash('sha256').update(s).digest('hex');
const fields='id,email,owner_name,roster_member,manual_member,manual_member_since,temporary_member_start,temporary_member_end,roster_staff,wallet_pence';
function supportToken(req){const values=String(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'=')).map(s=>s.slice(COOKIE.length+1));return values.length===1&&/^[a-f0-9]{64}$/.test(values[0])?values[0]:null;}
const supportCookie=(value,age=43200)=>`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function supportUser(req,env,actor,services={store}){
 const token=supportToken(req);if(!token)return actor;
 const parent=require('./user-auth.cjs').sessionToken(req);if(!parent)return null;
 const sessions=await services.store(env,'dynamo_support_sessions?select=id,actor_id,target_id,expires_at&token_hash=eq.'+digest(token)+'&actor_session_hash=eq.'+digest(parent)+'&actor_id=eq.'+actor.id+'&ended_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
 const session=sessions[0];if(!session)return ['GET','HEAD'].includes(req.method)?{...actor,supportSession:{expired:true}}:null;
 const targets=await services.store(env,'dynamo_accounts?select='+fields+'&id=eq.'+session.target_id+'&limit=1');if(!targets[0])return null;
 if(!['GET','HEAD'].includes(req.method))await services.store(env,'dynamo_support_audit',{method:'POST',body:JSON.stringify({session_id:session.id,actor_id:actor.id,target_id:session.target_id,action:('attempt '+req.method+' '+String(req.url||'/api').split('?')[0]+' '+String(req.body?.action||'')).slice(0,200)})});
 const target=staffAccess(targets[0]);return {...target,isDeveloper:false,websiteAdmin:false,roster_staff:false,staffRole:null,staffRoles:[],permissions:[],managementAccess:false,supportSession:{actorEmail:actor.email,expiresAt:session.expires_at}};
}
function summarize(rows){const payments=new Set();let gross=0,refunded=0,card=0,wallet=0,fees=0;const days=new Map();for(const r of rows){const amount=Number(r.amount_pence)||0,refund=Number(r.refunded_pence)||0;gross+=amount;refunded+=refund;if(r.payment_method==='card'){card+=amount;fees+=Number(r.service_fee_pence)||0;}else if(r.payment_method==='wallet')wallet+=amount;if(amount>0)payments.add(r.card_checkout_id||r.purchase_id||r.id);const day=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(r.checkout?.settled_at||r.created_at));const d=days.get(day)||{date:day,grossPence:0,refundPence:0,platformFeePence:0};d.grossPence+=amount;d.refundPence+=refund;if(r.payment_method==='card')d.platformFeePence+=Number(r.service_fee_pence)||0;days.set(day,d);}return {payments:payments.size,grossPence:gross,refundPence:refunded,netPence:gross-refunded,cardPence:card,walletPence:wallet,platformFeePence:fees,days:[...days.values()]};}
function makeDeveloperHandler(env=process.env,services={store,all,currentActor:(req,e)=>require('./user-auth.cjs').currentActor(req,e)}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{const actor=await services.currentActor(req,env);if(!actor?.isDeveloper)return res.status(actor?403:401).json({message:'Developer access required.'});
 if(req.method==='GET'){
  if(req.query?.search!==undefined){const q=String(req.query.search).trim().toLowerCase();if(q.length<2||q.length>100)return res.status(200).json({contacts:[]});const contacts=await services.all(env,'dynamo_accounts?select=id,email,owner_name&order=email.asc');return res.status(200).json({contacts:contacts.filter(c=>c.id!==actor.id&&(c.email+' '+(c.owner_name||'')).toLowerCase().includes(q)).slice(0,30)});}
  const hours=({day:24,twoDays:48,week:168,month:720})[req.query?.period]||24,since=new Date(Date.now()-hours*3600000).toISOString();
  const rows=await services.all(env,'dynamo_transactions?select=id,purchase_id,card_checkout_id,payment_method,amount_pence,refunded_pence,service_fee_pence,created_at,checkout:dynamo_card_checkouts(settled_at)&status=in.(successful,refunded)&created_at=gte.'+new Date(Date.parse(since)-48*3600000).toISOString()+'&order=created_at.desc');
  const audit=await services.store(env,'dynamo_support_sessions?select=id,reason,started_at,expires_at,ended_at,target:dynamo_accounts!dynamo_support_sessions_target_id_fkey(email,owner_name)&order=started_at.desc&limit=20');return res.status(200).json({developer:actor.email,since,hours,...summarize(rows.filter(r=>{const t=Date.parse(r.checkout?.settled_at||r.created_at);return t>=Date.parse(since)&&t<=Date.now();})),supportHistory:audit});
 }
 if(!['POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});if(!sameOrigin(req))return res.status(403).json({message:'Use the Dynamo website to continue.'});
 const parent=require('./user-auth.cjs').sessionToken(req);if(!parent)return res.status(401).json({message:'Log in again.'});
 if(req.method==='DELETE'){
  const token=supportToken(req);if(token){const rows=await services.store(env,'dynamo_support_sessions?token_hash=eq.'+digest(token)+'&actor_id=eq.'+actor.id+'&actor_session_hash=eq.'+digest(parent)+'&ended_at=is.null',{method:'PATCH',body:JSON.stringify({ended_at:new Date().toISOString()})});if(rows[0])await services.store(env,'dynamo_support_audit',{method:'POST',body:JSON.stringify({session_id:rows[0].id,actor_id:actor.id,target_id:rows[0].target_id,action:'end customer view'})});}res.setHeader('Set-Cookie',supportCookie('',0));return res.status(200).json({ok:true});
 }
 const id=req.body?.accountId,reason=String(req.body?.reason||'').trim();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')||id===actor.id||reason.length<3||reason.length>300)return res.status(400).json({message:'Select a customer and enter a support reason (3–300 characters).'});
 const target=(await services.store(env,'dynamo_accounts?select=id,email&id=eq.'+id+'&limit=1'))[0];if(!target)return res.status(404).json({message:'Customer not found.'});if(target.email.toLowerCase()==='freddie@mullens.com')return res.status(400).json({message:'Choose a customer account.'});
 await services.store(env,'dynamo_support_sessions?actor_id=eq.'+actor.id+'&actor_session_hash=eq.'+digest(parent)+'&ended_at=is.null',{method:'PATCH',body:JSON.stringify({ended_at:new Date().toISOString()})});
 const token=randomBytes(32).toString('hex'),session={id:randomUUID(),token_hash:digest(token),actor_session_hash:digest(parent),actor_id:actor.id,target_id:id,reason,expires_at:new Date(Date.now()+20*60000).toISOString()};
 await services.store(env,'dynamo_support_sessions',{method:'POST',body:JSON.stringify(session)});await services.store(env,'dynamo_support_audit',{method:'POST',body:JSON.stringify({session_id:session.id,actor_id:actor.id,target_id:id,action:'start customer view'})});res.setHeader('Set-Cookie',supportCookie(token));return res.status(201).json({ok:true,expiresAt:session.expires_at});
 }catch{return res.status(503).json({message:'Developer tools could not be loaded. Please try again.'});}
};}
module.exports={supportUser,supportToken,supportCookie,summarize,makeDeveloperHandler};
