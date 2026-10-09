const {currentUser}=require('./user-auth.cjs');
const {sameOrigin}=require('./admin-auth.cjs');
const {rpc,all}=require('./store.cjs');
const {uuid}=require('./login.cjs');
const messages={INSUFFICIENT_CREDIT:'This would take the wallet balance below £0.',INVALID_WALLET_CHANGE:'Enter a valid credit adjustment and reason.',INVALID_REFUND:'Enter an amount within the remaining refundable balance and a reason.',CARD_REFUNDS_NOT_CONNECTED:'Card refunds need a connected payment processor. No refund has been applied.',PARTY_SLOT_TAKEN:'That time overlaps another party in the same gym.',SESSION_FULL:'The destination session is full.',SESSION_INELIGIBLE:'The gymnast is not eligible for the destination session.',SESSION_UNAVAILABLE:'The destination session is unavailable.',BOOKING_CANCELLED:'A cancelled booking cannot be moved.',SAME_SESSION:'Choose a different session.',INVALID_DATE:'Choose a valid future date and time.',BOOKING_NOT_FOUND:'This booking could not be found.',PAYMENT_NOT_FOUND:'This payment could not be found.',ACCOUNT_NOT_FOUND:'This account could not be found.',OPERATION_CONFLICT:'Please refresh before trying again.'};
function makeOperationsHandler(env=process.env){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{const user=await currentUser(req,env);if(!user?.websiteAdmin)return res.status(403).json({message:'Website Admin access is required.'});
 if(req.method==='GET'&&uuid(req.query?.accountId)){return res.status(200).json({ledger:await all(env,'dynamo_wallet_ledger?select=id,amount_pence,balance_pence,reason,created_at&account_id=eq.'+req.query.accountId+'&order=created_at.desc')});}
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed.'});if(!sameOrigin(req))return res.status(403).json({message:'Open the management website to continue.'});
 const b=req.body||{};if(!uuid(b.operationId))return res.status(400).json({message:'Please refresh and try again.'});
 if(b.action==='wallet'){
 if(!uuid(b.accountId)||!Number.isSafeInteger(b.amountPence)||b.amountPence===0||Math.abs(b.amountPence)>1000000||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>300)return res.status(400).json({message:'Enter an amount and reason for the wallet adjustment.'});
 return res.status(200).json(await rpc(env,'adjust_dynamo_wallet',{p_account:b.accountId,p_actor:user.id,p_amount:b.amountPence,p_reason:b.reason.trim(),p_operation:b.operationId}));}
 if(b.action==='refund'){
 if(!uuid(b.transactionId)||!Number.isSafeInteger(b.amountPence)||b.amountPence<=0||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>300)return res.status(400).json({message:'Enter a refund amount and reason.'});
 return res.status(200).json(await rpc(env,'refund_dynamo_wallet_payment',{p_transaction:b.transactionId,p_actor:user.id,p_amount:b.amountPence,p_reason:b.reason.trim(),p_operation:b.operationId}));}
 if(['move','cancel'].includes(b.action)&&['event','party'].includes(b.kind)&&uuid(b.bookingId)){
 if(b.action==='move'&&(b.kind==='event'?!uuid(b.targetId):!/^\d{4}-\d{2}-\d{2}$/.test(b.date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time||'')))return res.status(400).json({message:'Choose the destination session or party date and time.'});
 return res.status(200).json(await rpc(env,'manage_dynamo_booking',{p_kind:b.kind,p_booking:b.bookingId,p_actor:user.id,p_action:b.action,p_target:b.targetId||null,p_date:b.date||null,p_time:b.time||null,p_operation:b.operationId}));}
 return res.status(400).json({message:'Choose a valid management action.'});
 }catch(error){return res.status(messages[error.code]?400:503).json({message:messages[error.code]||'The change could not be completed. Please try again.'});}
};}
module.exports={makeOperationsHandler};
