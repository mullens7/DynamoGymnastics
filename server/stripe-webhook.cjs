const Stripe=require('stripe');
const {store}=require('./store.cjs');
const TYPES=new Set(['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','payment_intent.payment_failed','charge.refunded','refund.created','refund.updated','refund.failed']);
async function rawBody(req){
 const chunks=[];let size=0;
 for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=buffer.length;if(size>1048576)throw Error('BODY_TOO_LARGE');chunks.push(buffer);}
 return Buffer.concat(chunks);
}
async function persist(env,event){
 // Immutable event IDs make delivery retries safe. Payment fulfilment is a separate stage.
 await store(env,'dynamo_stripe_events?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:event.id,account_id:event.account,event_type:event.type,livemode:event.livemode,payload:event})});
}
function makeWebhookHandler(env=process.env,services={rawBody,persist,processEvent:require('./stripe-payments.cjs').processEvent}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'METHOD_NOT_ALLOWED'});}
 if(typeof req.headers['stripe-signature']!=='string')return res.status(400).json({error:'INVALID_SIGNATURE'});
 if(!/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET||'')||!/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_CONNECTED_ACCOUNT_ID||''))return res.status(503).json({error:'WEBHOOK_NOT_CONFIGURED'});
 let payload,event;
 try{payload=await services.rawBody(req);}catch{return res.status(413).json({error:'INVALID_BODY'});}
 try{event=Stripe.webhooks.constructEvent(payload,req.headers['stripe-signature'],env.STRIPE_WEBHOOK_SECRET,300);}catch{return res.status(400).json({error:'INVALID_SIGNATURE'});}
 const live=env.STRIPE_SECRET_KEY?.startsWith('sk_live_')||env.STRIPE_SECRET_KEY?.startsWith('rk_live_');
 const test=env.STRIPE_SECRET_KEY?.startsWith('sk_test_')||env.STRIPE_SECRET_KEY?.startsWith('rk_test_');
 if(!live&&!test)return res.status(503).json({error:'STRIPE_NOT_CONFIGURED'});
 if(event.account!==env.STRIPE_CONNECTED_ACCOUNT_ID||event.livemode!==Boolean(live)||!TYPES.has(event.type))return res.status(200).json({received:true,ignored:true});
 if(!/^evt_[A-Za-z0-9]+$/.test(event.id||'')||event.object!=='event'||!event.data?.object)return res.status(400).json({error:'INVALID_EVENT'});
 try{await services.persist(env,event);if(services.processEvent)await services.processEvent(env,event);return res.status(200).json({received:true});}
 catch{console.warn('Stripe webhook: durable event receipt failed');return res.status(503).json({error:'EVENT_STORAGE_UNAVAILABLE'});}
};}
module.exports={makeWebhookHandler,rawBody,persist,TYPES};
