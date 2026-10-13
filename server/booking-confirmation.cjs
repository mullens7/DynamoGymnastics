const {all}=require('./store.cjs'),{authorizeAdmin,sameOrigin}=require('./admin-auth.cjs'),{uuid}=require('./login.cjs');
const {buildConfirmation}=require('./confirmation.cjs'),{sendEmail}=require('./email.cjs');
function makeBookingConfirmationHandler(env=process.env,services={all,authorizeAdmin,sameOrigin,buildConfirmation,sendEmail}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed.'});
 if(!await services.authorizeAdmin(req,env,'events.manage'))return res.status(403).json({message:'Event management access is required.'});
 if(!services.sameOrigin(req))return res.status(403).json({message:'Open management to continue.'});
 if(!uuid(req.body?.bookingId))return res.status(400).json({message:'Choose a valid booking.'});
 try{
 const rows=await services.all(env,'dynamo_event_bookings?select=id,account_id,status,ticket_number,selection,event:dynamo_events(details),gymnast:dynamo_gymnasts(first_name,last_name)&id=eq.'+req.body.bookingId);
 const r=rows[0];if(!r||r.status!=='Booked')return res.status(409).json({message:'Only confirmed bookings can be resent.'});
 const [owners,settings]=await Promise.all([services.all(env,'dynamo_accounts?select=email,owner_name&id=eq.'+r.account_id),services.all(env,'dynamo_confirmation_settings?select=details&kind=eq.event')]);
 if(!owners[0]?.email||!settings[0]?.details)throw Error('MISSING_DETAILS');
 const mail=await services.buildConfirmation(owners[0],[{...r,kind:'event',session:{...r.event?.details,...r.selection}}],{event:{...settings[0].details,enabled:true}});
 await services.sendEmail({to:owners[0].email,...mail},env);
 return res.status(200).json({sent:true,message:'Confirmation sent.'});
 }catch{return res.status(502).json({message:'Delivery could not be confirmed. Check the recipient inbox before trying again.'});}
};}
module.exports={makeBookingConfirmationHandler};
