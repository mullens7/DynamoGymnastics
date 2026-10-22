const {createHash,createHmac}=require('node:crypto');
const {rpc,store}=require('./store.cjs');
const google=require('./waiting-list-google.cjs');
const {sendEmail,settings}=require('./email.cjs');
const {signature}=require('./email-template.cjs');
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(data){const list=data.children.map(c=>`${c.first} ${c.last}\n${c.classes.map(r=>`${r.category}: Hamble, ${r.day} ${r.start}–${r.end}`).join('\n')}`).join('\n\n');const text=`Hi ${data.parent},\n\nThank you — ${data.children.length===1?'your child has':'your children have'} been added to the Dynamo Gymnastics Hamble waiting list.\n\n${list}\n\n${data.together?'You’ve asked for your children to attend on the same day and at the same time.\n\n':''}When a suitable space becomes available, we’ll contact you to arrange a one-off paid taster session (£10 per child), so they can see whether they enjoy it.\n\nIf you accept a place after the taster, sessions cost £10 each, paid by monthly Direct Debit through Thrive4 on the 1st of each month for the sessions in the month ahead. Hamble classes run all year round except over Christmas; you won’t be charged for scheduled Christmas closures.\n\nEstimated waiting times are approximately 3–6 months for Gyminis, and immediately to around 1–2 months for Recreational. We’ll do our best to offer a place as soon as possible; these times are estimates.\n\nYou don’t need to do anything else for now. Joining the waiting list does not book a class or take a payment.\n\nIf your availability or contact details change, please email admin@dynamogymnastics.co.uk.\n\nDynamo Gymnastics`;
 return {to:data.email,subject:'You’re on the Dynamo Gymnastics waiting list',text,html:`<!doctype html><html lang="en"><body style="margin:0;background:#f1f5fa;font-family:Arial,sans-serif;color:#25364b"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:620px;background:white;border-top:6px solid #1656a4"><tr><td style="padding:28px;font-size:16px;line-height:1.65"><h1 style="color:#1656a4;font-size:25px">You’re on the waiting list</h1>${text.split('\n\n').map(p=>`<p>${escape(p).replace(/\n/g,'<br>')}</p>`).join('')}</td></tr><tr><td>${signature().replaceAll('https://dynamo-gymnastics.vercel.app','https://dynamogymnastics.co.uk')}</td></tr></table></td></tr></table></body></html>`};}
async function submit(env,data,id,ip,services={rpc,store,append:google.append,sendEmail}){
 // Fail before saving if configuration is incomplete, without returning secrets.
 google.client(env);settings(env);if(!env.SYNC_TEST_KEY||env.SYNC_TEST_KEY.length<32)throw Error('WAITING_NOT_CONFIGURED');
 const canonical={...data,children:data.children.map(c=>({...c,classes:[...c.classes].sort((a,b)=>a.id.localeCompare(b.id))}))};
 const fingerprint=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
 const limit=v=>createHmac('sha256',env.SYNC_TEST_KEY).update('waiting:'+v).digest('hex');
 const reserved=await services.rpc(env,'reserve_dynamo_waiting_list',{p_id:id,p_hash:fingerprint,p_details:canonical,p_limit:limit('ip:'+ip),p_email_limit:limit('email:'+data.email)});
 const record=reserved.record,path='dynamo_waiting_list_submissions?id=eq.'+record.id;
 const patch=body=>services.store(env,path,{method:'PATCH',body:JSON.stringify(body)});
 if(record.state!=='sheeted'){
  try{const result=await services.append(env,record.id,record.details,{recoverOnly:!reserved.fresh});if(!result.confirmed)return {ok:true,pending:true,reference:record.id};await patch({state:'sheeted',sheeted_at:new Date().toISOString(),error_code:null});}
  catch{await patch({state:'attention',error_code:'SHEET_DELIVERY_REVIEW'});return {ok:true,pending:true,reference:record.id};}
 }
 const claimed=await services.store(env,path+'&state=eq.sheeted&email_status=eq.pending',{method:'PATCH',body:JSON.stringify({email_status:'sending'})});
 let emailSent=record.email_status==='sent';
 if(claimed.length){try{await services.sendEmail(message(record.details),env);await patch({email_status:'sent',email_sent_at:new Date().toISOString()});emailSent=true;}catch{await patch({email_status:'attention',error_code:'EMAIL_DELIVERY_REVIEW'});}}
 return {ok:true,registered:true,emailSent,reference:record.id};
}
async function recover(env,services={store,submit}){
 const before=new Date(Date.now()-120000).toISOString();
 const rows=await services.store(env,'dynamo_waiting_list_submissions?select=id,details,state,email_status&created_at=lt.'+encodeURIComponent(before)+'&or=(state.eq.processing,and(state.eq.sheeted,email_status.eq.pending))&order=created_at.asc&limit=3');
 for(const row of rows){try{await services.submit(env,row.details,row.id,'scheduled-recovery');}catch{console.warn('Waiting-list delivery needs review');}}
}
module.exports={submit,message,recover};
