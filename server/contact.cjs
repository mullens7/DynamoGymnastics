const {createHmac}=require('node:crypto');
const {sameOrigin}=require('./admin-auth.cjs');
const {rpc}=require('./store.cjs');
const {sendEmail}=require('./email.cjs');
function validate(input){
 const result={};for(const [key,max] of [['first',80],['last',80],['email',254],['phone',40],['message',4000]]){const value=typeof input?.[key]==='string'?input[key].trim():'';if(!value||value.length>max)throw Error('Please complete all fields within their character limits.');result[key]=value;}
 if(!/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(result.email)||/[\r\n]/.test(result.first+result.last+result.phone))throw Error('Enter valid contact details.');
 if(!/^[+\d\s().-]{5,40}$/.test(result.phone))throw Error('Enter a valid phone number.');
 return result;
}
function makeContactHandler(env=process.env,services={rpc,sendEmail}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed.'});
 if(!sameOrigin(req))return res.status(403).json({message:'Please send your enquiry from the Dynamo website.'});
 if(req.body?.website)return res.status(200).json({ok:true});
 let input;try{input=validate(req.body);}catch(e){return res.status(400).json({message:e.message});}
 try{
  if(!env.SYNC_TEST_KEY)throw Error();
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
  const key=createHmac('sha256',env.SYNC_TEST_KEY).update('contact:'+ip).digest('hex');
  const allowed=await services.rpc(env,'limit_dynamo_contact',{p_key:key});
  if(!allowed)return res.status(429).json({message:'Too many messages. Please try again later, or email or call us.'});
  await services.sendEmail({to:'admin@dynamogymnastics.co.uk',subject:'Website enquiry',replyTo:input.email,text:`Adult: ${input.first} ${input.last}\nEmail: ${input.email}\nPhone: ${input.phone}\n\n${input.message}`},env);
  return res.status(200).json({ok:true});
 }catch{return res.status(503).json({message:'Your message could not be sent. Please email or call the team.'});}
};}
module.exports={makeContactHandler,validate};
