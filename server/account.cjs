const {randomUUID}=require('node:crypto');
const {currentUser}=require('./user-auth.cjs');
const {sameOrigin}=require('./admin-auth.cjs');
const {store,all,rpc}=require('./store.cjs');
const {uuid}=require('./login.cjs');
const {eligible}=require('../public/manage/membership.js');
const messages={ALREADY_BOOKED:'This gymnast already has a booking for that session.',SESSION_UNAVAILABLE:'This session is unavailable.',SESSION_FULL:'This session is full.',SESSION_INELIGIBLE:'The selected gymnast is not eligible for this session.',GYMNAST_NOT_FOUND:'Select a gymnast from your account.',CARD_PAYMENT_NOT_CONNECTED:'Card payments are not connected yet. A paid booking currently needs enough wallet credit to cover the full price.',PRICE_NOT_CONFIGURED:'This session does not have a price configured yet.',OPERATION_CONFLICT:'Please refresh before trying again.'};
async function catalog(env,user,gymnasts){const [events,parties]=await Promise.all([all(env,'dynamo_events?select=id,details&archived=eq.false&details->>status=eq.Published&order=created_at.asc'),all(env,'dynamo_parties?select=id,details&archived=eq.false&order=created_at.asc')]);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const account={member:user.roster_member,gymnasts};return {events:events.map(r=>({...r.details,id:r.id})).filter(event=>event.date>=today&&(event.audience==='everyone'||gymnasts.some(g=>eligible(event,account,g.id)))),parties:parties.map(r=>({...r.details,id:r.id})).filter(p=>p.date>=today&&p.status!=='Cancelled')};}
function makeAccountHandler(env=process.env){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{const user=await currentUser(req,env);if(!user)return res.status(401).json({message:'Please log in.'});
 if(req.method==='GET'){
 const id=user.id;const [gymnasts,purchases,transactions,ledger,eventBookings,partyBookings]=await Promise.all([all(env,'dynamo_gymnasts?select=id,first_name,last_name,date_of_birth,bg_number,groups,active,source_id&account_id=eq.'+id+'&order=first_name.asc'),all(env,'dynamo_purchases?select=id,created_at,details&account_id=eq.'+id+'&order=created_at.desc'),all(env,'dynamo_transactions?select=id,purchase_id,amount_pence,status,payment_method,refunded_pence,created_at&account_id=eq.'+id+'&order=created_at.desc'),all(env,'dynamo_wallet_ledger?select=id,amount_pence,balance_pence,reason,created_at&account_id=eq.'+id+'&order=created_at.desc'),all(env,'dynamo_event_bookings?select=id,event_id,purchase_id,price_pence,status,gymnast_id,created_at,event:dynamo_events(details)&account_id=eq.'+id+'&order=created_at.desc'),all(env,'dynamo_party_bookings?select=id,party_id,purchase_id,price_pence,status,gymnast_id,created_at,party:dynamo_parties(details)&account_id=eq.'+id+'&order=created_at.desc')]);
 return res.status(200).json({user,gymnasts:gymnasts.map(g=>({...g,editable:g.source_id.startsWith('manual:'),source_id:undefined})),purchases,transactions,ledger,bookings:[...eventBookings.map(b=>({...b,kind:'event',session:b.event?.details,event:undefined})),...partyBookings.map(b=>({...b,kind:'party',session:b.party?.details,party:undefined}))],catalog:await catalog(env,user,gymnasts)});
 }
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed.'});if(!sameOrigin(req))return res.status(403).json({message:'Open the Dynamo website to continue.'});
 if(req.body?.action==='profile'){
  const input=req.body,first=String(input.firstName||'').trim(),last=String(input.lastName||'').trim(),dob=input.dateOfBirth,bg=String(input.bgNumber||'').trim();
  if(!first||!last||first.length>80||last.length>80||bg.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(dob||'')||Number.isNaN(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob||dob>new Date().toISOString().slice(0,10))return res.status(400).json({message:'Enter a valid name and date of birth.'});
  const record={first_name:first,last_name:last,date_of_birth:dob,bg_number:bg};
  if(input.id){if(!uuid(input.id))return res.status(400).json({message:'Choose a valid profile.'});const rows=await store(env,'dynamo_gymnasts?id=eq.'+input.id+'&account_id=eq.'+user.id+'&source_id=like.manual:*',{method:'PATCH',body:JSON.stringify(record)});if(!rows.length)return res.status(403).json({message:'Synced gymnast details are managed by the club.'});}
  else await store(env,'dynamo_gymnasts',{method:'POST',body:JSON.stringify({...record,account_id:user.id,source_id:'manual:'+randomUUID(),groups:[],active:false})});
  return res.status(200).json({ok:true});
 }
 if(req.body?.action==='book'){
 const b=req.body;if(!['event','party'].includes(b.kind)||!uuid(b.targetId)||!uuid(b.gymnastId)||!uuid(b.operationId)||typeof b.useCredit!=='boolean')return res.status(400).json({message:'Choose a session and gymnast.'});
 const result=await rpc(env,'book_dynamo_session',{p_kind:b.kind,p_target:b.targetId,p_account:user.id,p_gymnast:b.gymnastId,p_credit:b.useCredit,p_operation:b.operationId});return res.status(201).json(result);
 }
 return res.status(400).json({message:'Choose a valid account action.'});
 }catch(error){return res.status(messages[error.code]?400:503).json({message:messages[error.code]||'Your account is temporarily unavailable. Please try again.'});}
};}
module.exports={makeAccountHandler,catalog};
