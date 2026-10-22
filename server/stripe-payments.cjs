const Stripe=require('stripe');
const {all,rpc,store}=require('./store.cjs');
const {uuid}=require('./login.cjs');
const SITE='dynamo-gymnastics';
function stripe(env){if(!/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY||'')||!/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_CONNECTED_ACCOUNT_ID||'')||!/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET||''))throw Object.assign(Error('Stripe configuration is incomplete.'),{code:'STRIPE_NOT_CONFIGURED'});return new Stripe(env.STRIPE_SECRET_KEY,{apiVersion:'2026-04-22.dahlia',maxNetworkRetries:2,timeout:15000});}
function origin(req){const host=(req.headers.host||'').toLowerCase();if(!['dynamo-gymnastics.vercel.app','dynamogymnastics.co.uk','www.dynamogymnastics.co.uk','auth.dynamogymnastics.co.uk','manage.dynamogymnastics.co.uk'].includes(host))throw Error('INVALID_HOST');return 'https://'+host;}
function options(env,key){return {stripeAccount:env.STRIPE_CONNECTED_ACCOUNT_ID,...(key?{idempotencyKey:key}:{})};}
async function getOrder(env,id,accountId,services={all}){if(!uuid(id))throw Error('INVALID_ORDER');const rows=await services.all(env,'dynamo_card_checkouts?select=*&id=eq.'+id+(accountId?'&account_id=eq.'+accountId:''));if(!rows[0])throw Object.assign(Error('Checkout not found.'),{code:'CHECKOUT_NOT_FOUND'});return rows[0];}
async function deliver(env,order,services){if(order.kind==='awards'){const award=services?.deliverAwardConfirmation||require('./award-confirmation.cjs').deliverAwardConfirmation;await award(env,order.id,order.account_id);return;}if(order.kind!=='basket')return;const confirmation=services?.deliverConfirmation||require('./confirmation.cjs').deliverConfirmation,party=services?.deliverPartyAlerts||require('./party-alerts.cjs').deliverPartyAlerts;await confirmation(env,order.id,order.account_id);await party(env,order.result.bookings||[]);}
async function settleSession(env,order,session,services={rpc}){
 if(order.connected_account!==env.STRIPE_CONNECTED_ACCOUNT_ID||session.id!==order.session_id||session.metadata?.site!==SITE||session.metadata?.orderId!==order.id||session.client_reference_id!==order.id||session.currency!=='gbp'||session.amount_total!==order.card_pence||session.livemode!==/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY||''))throw Object.assign(Error('Payment verification failed.'),{code:'PAYMENT_MISMATCH'});
 const paid=session.payment_status==='paid'&&session.status==='complete';
 if(!paid&&session.status!=='expired')return {state:order.state};
 const pi=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
 let paidAt;
 if(paid){
  const intent=await (services.stripe||stripe)(env).paymentIntents.retrieve(pi,{expand:['latest_charge']},options(env));
  const charge=intent.latest_charge;
  if(intent.id!==pi||intent.status!=='succeeded'||intent.amount_received!==order.card_pence||intent.currency!=='gbp'||!charge||typeof charge!=='object'||!charge.paid||!charge.captured||charge.payment_intent!==pi||!Number.isSafeInteger(charge.created))throw Object.assign(Error('Payment verification failed.'),{code:'PAYMENT_MISMATCH'});
  paidAt=new Date(charge.created*1000).toISOString();
 }
 const result=await services.rpc(env,'settle_dynamo_card_checkout',{p_order:order.id,p_session:session.id,p_payment:pi||null,p_amount:session.amount_total,p_paid:paid});
 if(paid){await services.rpc(env,'record_dynamo_payment_date',{p_order:order.id,p_payment:pi,p_paid_at:paidAt});await deliver(env,order,services);}return result;
}
async function createCheckout(env,req,user,kind,body,services={rpc,all,store,stripe}){
 const client=services.stripe(env),base=origin(req);
 const order=await services.rpc(env,'prepare_dynamo_card_checkout',{p_account:user.id,p_kind:kind,p_items:body.items,p_credit:body.useCredit,p_operation:body.operationId,p_expected_total:body.expectedTotal,p_connected:env.STRIPE_CONNECTED_ACCOUNT_ID,p_origin:base});
 if(order.state==='paid'){await deliver(env,order,services);return {...order.result,state:'paid'};}
 if(order.state==='expired')throw Object.assign(Error('This checkout expired. Refresh and choose your bookings again.'),{code:'CHECKOUT_EXPIRED'});
 if(order.state==='review'||Date.now()-Date.parse(order.created_at)>23*60*60*1000){await services.store(env,'dynamo_card_checkouts?id=eq.'+order.id+'&state=in.(creating,open)',{method:'PATCH',body:JSON.stringify({state:'review'})});throw Object.assign(Error('The club needs to review this checkout.'),{code:'PAYMENT_REVIEW'});}
 let session;
 if(order.session_id)session=await client.checkout.sessions.retrieve(order.session_id,{},options(env));
 else{
 try{
 session=await client.checkout.sessions.create({mode:'payment',payment_method_types:['card'],line_items:[{price_data:{currency:'gbp',unit_amount:order.card_pence,product_data:{name:'Dynamo Gymnastics',description:'Please complete your booking below'}},quantity:1}],client_reference_id:order.id,metadata:{site:SITE,orderId:order.id},payment_intent_data:{...(order.service_fee_pence>0?{application_fee_amount:order.service_fee_pence}:{}),metadata:{site:SITE,orderId:order.id}},expires_at:Math.floor(Date.parse(order.created_at)/1000)+31*60,success_url:order.return_origin+'/account/?checkout='+order.id,cancel_url:order.return_origin+'/account/?checkout='+order.id+'&payment=cancelled'},options(env,'dynamo-checkout-'+order.id));
 }catch(error){
 // A definitive rejection has not created a Stripe Session. Network/time-out
 // errors stay reserved and retry with the same idempotency key.
 if(['StripeInvalidRequestError','StripeAuthenticationError','StripePermissionError'].includes(error.type)){
 await services.rpc(env,'attach_dynamo_card_session',{p_order:order.id,p_session:'cs_uncreated_'+order.id.replaceAll('-',''),p_expires:order.expires_at});
 await services.rpc(env,'settle_dynamo_card_checkout',{p_order:order.id,p_session:'cs_uncreated_'+order.id.replaceAll('-',''),p_payment:null,p_amount:order.card_pence,p_paid:false});}
 throw Object.assign(Error('Payment could not be opened. Please try again.'),{code:'CHECKOUT_UNAVAILABLE'});
 }
 await services.rpc(env,'attach_dynamo_card_session',{p_order:order.id,p_session:session.id,p_expires:new Date(session.expires_at*1000).toISOString()});order.session_id=session.id;
 }
 if(session.status!=='open')return {...await settleSession(env,order,session,services),...order.result};
 if(!session.url?.startsWith('https://checkout.stripe.com/'))throw Error('INVALID_CHECKOUT_URL');
 return {state:'open',checkoutUrl:session.url,orderId:order.id,cardPence:order.card_pence,walletPence:order.wallet_pence};
}
async function checkoutStatus(env,user,id,services={all,rpc,store,stripe}){const order=await getOrder(env,id,user.id,services);let result={state:order.state,kind:order.kind,result:order.result};if(!['paid','expired','review'].includes(order.state)&&order.session_id){const session=await services.stripe(env).checkout.sessions.retrieve(order.session_id,{},options(env));result={...result,...await settleSession(env,order,session,services),checkoutUrl:session.status==='open'?session.url:null};}const [jobs,failed]=await Promise.all([services.all(env,(order.kind==='awards'?'dynamo_award_confirmation_jobs':'dynamo_confirmation_jobs')+'?select=status&id=eq.'+order.id+'&account_id=eq.'+user.id),services.all(env,'dynamo_transactions?select=id&card_checkout_id=eq.'+order.id+'&payment_attempt_failed=eq.true&status=eq.declined')]);return {...result,confirmationStatus:jobs[0]?.status||null,attemptFailed:failed.length>0};}

async function cancelCheckout(env,user,id,services={all,rpc,store,stripe}){const order=await getOrder(env,id,user.id,services);if(['paid','expired'].includes(order.state))return {state:order.state};if(!order.session_id)throw Object.assign(Error('Checkout creation needs review. Please contact the club.'),{code:'PAYMENT_REVIEW'});const client=services.stripe(env);let session=await client.checkout.sessions.retrieve(order.session_id,{},options(env));if(session.status==='open')session=await client.checkout.sessions.expire(order.session_id,{},options(env,'dynamo-expire-'+order.id));return settleSession(env,order,session,services);}
async function refund(env,user,body,services={all,rpc,store,stripe}){
 const txs=await services.all(env,'dynamo_transactions?select=*&id=eq.'+body.transactionId);const tx=txs[0];if(!tx)throw Object.assign(Error('Payment not found.'),{code:'PAYMENT_NOT_FOUND'});
 if(tx.payment_method==='wallet')return services.rpc(env,'refund_dynamo_wallet_payment',{p_transaction:body.transactionId,p_actor:user.id,p_amount:body.amountPence,p_reason:body.reason.trim(),p_operation:body.operationId});
 const client=services.stripe(env),order=await getOrder(env,tx.card_checkout_id,null,services);if(order.connected_account!==env.STRIPE_CONNECTED_ACCOUNT_ID||order.state!=='paid')throw Error('PAYMENT_MISMATCH');
 const claim=await services.rpc(env,'claim_dynamo_card_refund',{p_transaction:tx.id,p_actor:user.id,p_amount:body.amountPence,p_reason:body.reason.trim(),p_operation:body.operationId});
 if(claim.state==='succeeded')return {ok:true,state:'succeeded',unchanged:true};
 if(['failed','canceled','review'].includes(claim.state)||Date.now()-Date.parse(claim.created_at)>23*60*60*1000){if(['creating','pending'].includes(claim.state))await services.store(env,'dynamo_card_refunds?id=eq.'+claim.id,{method:'PATCH',body:JSON.stringify({state:'review'})});throw Object.assign(Error('This refund needs review. Do not repeat it with a new reference.'),{code:'REFUND_REVIEW'});}
 let result;
 if(claim.provider_id)result=await client.refunds.retrieve(claim.provider_id,{},options(env));
 else{try{result=await client.refunds.create({payment_intent:tx.provider_reference,amount:claim.amount_pence,reason:'requested_by_customer',metadata:{site:SITE,refundId:claim.id,transactionId:tx.id}},options(env,'dynamo-refund-'+claim.id));}
 catch(error){if(['StripeInvalidRequestError','StripeAuthenticationError','StripePermissionError'].includes(error.type))await services.store(env,'dynamo_card_refunds?id=eq.'+claim.id,{method:'PATCH',body:JSON.stringify({state:'failed'})});throw Object.assign(Error('Refund delivery has not been confirmed. Retry this same request or review Stripe.'),{code:'REFUND_UNCONFIRMED'});}}
 if(result.payment_intent!==tx.provider_reference||result.amount!==claim.amount_pence||result.currency!=='gbp')throw Error('PAYMENT_MISMATCH');
 return services.rpc(env,'settle_dynamo_card_refund',{p_operation:claim.id,p_provider:result.id,p_state:result.status==='requires_action'?'pending':result.status});
}
async function processEvent(env,event,services={all,rpc,store,stripe}){
 const done=()=>services.store(env,'dynamo_stripe_events?id=eq.'+event.id,{method:'PATCH',body:JSON.stringify({status:'processed',processed_at:new Date().toISOString()})});
 const obj=event.data.object;if(event.type.startsWith('checkout.session.')){
 if(obj.metadata?.site!==SITE||!uuid(obj.metadata?.orderId))return done();
 const order=await getOrder(env,obj.metadata.orderId,null,services),client=services.stripe(env);
 // Recover the attach boundary if Stripe delivered its event before the create
 // request completed. Only the expected client reference and metadata qualify.
 if(!order.session_id){if(obj.client_reference_id!==order.id)throw Error('PAYMENT_MISMATCH');await services.rpc(env,'attach_dynamo_card_session',{p_order:order.id,p_session:obj.id,p_expires:new Date(obj.expires_at*1000).toISOString()});order.session_id=obj.id;}
 const session=await client.checkout.sessions.retrieve(order.session_id,{},options(env));await settleSession(env,order,session,services);
 }else if(event.type.startsWith('refund.')){
 if(obj.metadata?.site!==SITE||!uuid(obj.metadata?.refundId))return done();
 const rows=await services.all(env,'dynamo_card_refunds?select=*&id=eq.'+obj.metadata.refundId);const claim=rows[0];if(!claim)return done();
 const txs=await services.all(env,'dynamo_transactions?select=*&id=eq.'+claim.transaction_id),tx=txs[0];if(!tx||tx.provider_reference!==obj.payment_intent||claim.amount_pence!==obj.amount||obj.currency!=='gbp')throw Error('PAYMENT_MISMATCH');
 const order=await getOrder(env,tx.card_checkout_id,null,services);if(order.connected_account!==event.account)throw Error('PAYMENT_MISMATCH');
 const latest=await services.stripe(env).refunds.retrieve(obj.id,{},options(env));await services.rpc(env,'settle_dynamo_card_refund',{p_operation:claim.id,p_provider:latest.id,p_state:latest.status==='requires_action'?'pending':latest.status});
 }else if(event.type==='charge.refunded'){
 const pi=typeof obj.payment_intent==='string'?obj.payment_intent:obj.payment_intent?.id;
 const linked=pi?await services.all(env,'dynamo_card_checkouts?select=*&payment_intent=eq.'+pi+'&connected_account=eq.'+event.account):[];
 if(!linked.length)return done();const client=services.stripe(env);let after;for(let page=0;page<10;page++){const refunds=await client.refunds.list({charge:obj.id,limit:100,...(after?{starting_after:after}:{})},options(env));for(const r of refunds.data){if(r.status!=='succeeded')continue;if(r.metadata?.site===SITE&&uuid(r.metadata?.refundId))await processEvent(env,{...event,type:'refund.updated',data:{object:r}},{...services,store:async(e,p,o)=>p==='dynamo_stripe_events?id=eq.'+event.id?[]:services.store(e,p,o)});else await services.rpc(env,'record_dynamo_external_refund',{p_payment:pi,p_provider:r.id,p_amount:r.amount});}if(!refunds.has_more)break;after=refunds.data.at(-1)?.id;if(page===9)throw Error('REFUND_RECONCILIATION_REQUIRED');}
 }else if(event.type==='payment_intent.payment_failed'&&obj.metadata?.site===SITE&&uuid(obj.metadata?.orderId)){
 const order=await getOrder(env,obj.metadata.orderId,null,services);if(order.state==='paid')return done();await services.store(env,'dynamo_transactions?card_checkout_id=eq.'+order.id+'&payment_method=eq.card',{method:'PATCH',body:JSON.stringify({status:'declined',payment_attempt_failed:true})});
 }
 await done();
}
async function reconcile(env,services={all,rpc,store,stripe}){
 const pendingEvents=await services.all(env,'dynamo_stripe_events?select=id,payload&status=eq.received&order=received_at.asc&limit=10');for(const e of pendingEvents){try{await processEvent(env,e.payload,services);}catch(error){if(error.code==='PAYMENT_MISMATCH'||error.message==='REFUND_RECONCILIATION_REQUIRED')await services.store(env,'dynamo_stripe_events?id=eq.'+e.id,{method:'PATCH',body:JSON.stringify({status:'review',error_code:error.code||error.message})});}}
 const orders=await services.all(env,'dynamo_card_checkouts?select=*&state=in.(open,creating)&order=created_at.asc&limit=20');
 for(const order of orders){if(!order.session_id){if(Date.now()-Date.parse(order.created_at)>120000)try{await createCheckout(env,{headers:{host:new URL(order.return_origin).host}},{id:order.account_id},order.kind,{items:order.items,useCredit:order.credit,operationId:order.id,expectedTotal:order.total_pence},services);}catch{}continue;}try{const s=await services.stripe(env).checkout.sessions.retrieve(order.session_id,{},options(env));await settleSession(env,order,s,services);}catch{}}
 const refunds=await services.all(env,'dynamo_card_refunds?select=*&state=in.(creating,pending)&order=created_at.asc&limit=20');
 for(const r of refunds){if(!r.provider_id){try{await refund(env,{id:r.actor_id},{transactionId:r.transaction_id,amountPence:r.amount_pence,reason:r.reason,operationId:r.id},services);}catch{}continue;}try{const latest=await services.stripe(env).refunds.retrieve(r.provider_id,{},options(env));await services.rpc(env,'settle_dynamo_card_refund',{p_operation:r.id,p_provider:latest.id,p_state:latest.status==='requires_action'?'pending':latest.status});}catch{}}
 return {checked:orders.length,refunds:refunds.length};
}
async function health(env){const client=stripe(env),account=await client.accounts.retrieve(env.STRIPE_CONNECTED_ACCOUNT_ID);const endpoints=await client.webhookEndpoints.list({limit:100});const endpoint=endpoints.data.find(e=>['https://dynamo-gymnastics.vercel.app/api/stripe-webhook/','https://dynamogymnastics.co.uk/api/stripe-webhook/'].includes(e.url)&&e.status==='enabled');return {connected:account.id===env.STRIPE_CONNECTED_ACCOUNT_ID,businessName:account.business_profile?.name||account.settings?.dashboard?.display_name||null,cardPaymentsCapability:account.capabilities?.card_payments,chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,detailsSubmitted:account.details_submitted,webhookEnabled:!!endpoint,webhookEvents: endpoint?.enabled_events||[]};}
module.exports={health,stripe,origin,options,getOrder,createCheckout,checkoutStatus,cancelCheckout,refund,processEvent,reconcile,settleSession,SITE};
