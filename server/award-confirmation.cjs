const {all,store}=require('./store.cjs');
const {sendEmail}=require('./email.cjs');
const {signature}=require('./email-template.cjs');
const {authorizeAdmin,sameOrigin}=require('./admin-auth.cjs');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=p=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(p/100);
function buildAwardConfirmation(owner,order,items,cfg){
 if(!cfg?.enabled)return null;
 if(!owner?.email||!items.length||items.some(i=>!Number.isSafeInteger(i.details?.pricePence)||i.details.pricePence<0))throw Error('MISSING_AWARD_DETAILS');
 const greeting=String(cfg.greeting||'').replaceAll('{parentName}',owner.owner_name||'there');
 const total=items.reduce((sum,i)=>sum+i.details.pricePence,0),number='#'+order.id.slice(0,8).toUpperCase();
 const text=[greeting,cfg.intro,'Award order '+number,...items.map(i=>[i.details.gymnastName,i.details.session,i.details.awardName,money(i.details.pricePence)].join('\n')),'Total: '+money(total),cfg.instructions,'Dynamo Gymnastics'].join('\n\n');
 const rows=items.map(i=>'<tr><td style="padding:16px;border-bottom:1px solid #dce5ef"><strong>'+esc(i.details.gymnastName)+'</strong><br>'+esc(i.details.session)+'<br>Award: '+esc(i.details.awardName)+'</td><td style="padding:16px;text-align:right;white-space:nowrap;border-bottom:1px solid #dce5ef">'+money(i.details.pricePence)+'</td></tr>').join('');
 const html='<!doctype html><html><body style="margin:0;background:#f1f5fb;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-top:7px solid #1656a4"><tr><td style="padding:24px;color:#25364b;line-height:1.6"><h2 style="color:#1656a4">Your gymnastics awards</h2><p>'+esc(greeting)+'</p><p style="white-space:pre-line">'+esc(cfg.intro)+'</p><p><strong>Award order '+esc(number)+'</strong></p><table role="presentation" width="100%" style="border:1px solid #dce5ef;background:#f6f9fd">'+rows+'<tr><td style="padding:16px"><strong>Total</strong></td><td style="padding:16px;text-align:right;white-space:nowrap"><strong>'+money(total)+'</strong></td></tr></table><p style="white-space:pre-line">'+esc(cfg.instructions)+'</p></td></tr><tr><td>'+signature()+'</td></tr></table></td></tr></table></body></html>';
 return {subject:cfg.subject,text,html,attachments:[]};
}
async function deliverAwardConfirmation(env,id,accountId,services={all,store,sendEmail}){
 let claimed=false;
 try{
  const orders=await services.all(env,'dynamo_award_orders?select=id,account_id,payment_pending&id=eq.'+id+'&account_id=eq.'+accountId+'&payment_pending=eq.false');
  if(!orders.length)return {queued:false};
  const jobs=await services.store(env,'dynamo_award_confirmation_jobs?id=eq.'+id+'&account_id=eq.'+accountId+'&status=eq.pending',{method:'PATCH',body:JSON.stringify({status:'sending',attempted_at:new Date().toISOString()})});
  if(!jobs?.length)return {queued:false};
  claimed=true;
  const [owners,settings,items]=await Promise.all([
   services.all(env,'dynamo_accounts?select=email,owner_name&id=eq.'+accountId),
   services.all(env,'dynamo_confirmation_settings?select=details&kind=eq.award'),
   services.all(env,'dynamo_award_items?select=details&order_id=eq.'+id+'&account_id=eq.'+accountId+'&order=created_at.asc,id.asc')
  ]);
  if(!settings[0]?.details)throw Error('MISSING_SETTINGS');
  const mail=buildAwardConfirmation(owners[0],orders[0],items,settings[0].details);
  if(mail)await services.sendEmail({to:owners[0].email,...mail},env);
  await services.store(env,'dynamo_award_confirmation_jobs?id=eq.'+id,{method:'PATCH',body:JSON.stringify({status:mail?'sent':'skipped',sent_at:new Date().toISOString(),error_code:null})});
  return {sent:!!mail};
 }catch(e){
  if(claimed)try{await services.store(env,'dynamo_award_confirmation_jobs?id=eq.'+id,{method:'PATCH',body:JSON.stringify({status:'review',error_code:'EMAIL_DELIVERY_UNCONFIRMED'})});}catch{}
  return {pending:true};
 }
}
function makeAwardConfirmationSettingsHandler(env=process.env,services={all,store,deliverAwardConfirmation,authorizeAdmin,sameOrigin}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
   if(!await services.authorizeAdmin(req,env,'super_admin'))return res.status(403).json({message:'Super Admin access is required.'});
   if(req.method==='GET'){
    await services.store(env,'dynamo_award_confirmation_jobs?status=eq.sending&attempted_at=lt.'+encodeURIComponent(new Date(Date.now()-10*60*1000).toISOString()),{method:'PATCH',body:JSON.stringify({status:'review',error_code:'EMAIL_DELIVERY_UNCONFIRMED'})});
    const [settings,deliveries]=await Promise.all([services.all(env,'dynamo_confirmation_settings?select=details&kind=eq.award'),services.all(env,'dynamo_award_confirmation_jobs?select=id,status,error_code,created_at,account_id,account:dynamo_accounts(email,owner_name)&status=in.(pending,sending,review)&order=created_at.desc&limit=50')]);
    if(!settings[0])throw Error('MISSING_SETTINGS');
    return res.status(200).json({settings:settings[0].details,deliveries});
   }
   if(req.method!=='PATCH')return res.status(405).json({message:'Method not allowed.'});
   if(!services.sameOrigin(req))return res.status(403).json({message:'Open management to continue.'});
   if(req.body?.action==='resend'){
    if(!require('./login.cjs').uuid(req.body.id))return res.status(400).json({message:'Choose a valid confirmation.'});
    const rows=await services.store(env,'dynamo_award_confirmation_jobs?id=eq.'+req.body.id+'&status=in.(pending,review)',{method:'PATCH',body:JSON.stringify({status:'pending'})});
    if(!rows.length)return res.status(409).json({message:'This confirmation is already sent or still being processed.'});
    return res.status(200).json(await services.deliverAwardConfirmation(env,rows[0].id,rows[0].account_id));
   }
   let details;try{details=require('./confirmation.cjs').validateSettings(req.body,'award');}catch(e){return res.status(400).json({message:e.message});}
   const saved=await services.store(env,'dynamo_confirmation_settings?kind=eq.award',{method:'PATCH',body:JSON.stringify({details})});
   if(!saved?.length)throw Error('MISSING_SETTINGS');
   return res.status(200).json({ok:true});
  }catch{return res.status(503).json({message:'Award confirmation settings could not be loaded or saved.'});}
 };
}
module.exports={buildAwardConfirmation,deliverAwardConfirmation,makeAwardConfirmationSettingsHandler};
