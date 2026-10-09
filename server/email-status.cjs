const {allowed,equal}=require('./admin-auth.cjs');
const {verifyEmail,sendTestEmail}=require('./email.cjs');
function makeEmailStatusHandler(env=process.env,verify=verifyEmail,sendTest=sendTestEmail){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 const key=env.SYNC_SCHEDULE_SECRET;
 const diagnostic=typeof key==='string'&&key.length>=32&&equal(req.headers.authorization,'Bearer '+key);
 if(!diagnostic&&!allowed(req,env))return res.status(401).json({ok:false,error:'UNAUTHORISED'});
 try{if(req.body?.action==='send-test'){await sendTest(env);return res.status(200).json({ok:true,emailSent:true});}return res.status(200).json(await verify(env));}
 catch(error){const code=['EMAIL_NOT_CONFIGURED','EMAIL_AUTH_FAILED','EMAIL_CONNECTION_TIMEOUT','EMAIL_CONNECTION_FAILED'].includes(error.code)?error.code:'EMAIL_CONNECTION_FAILED';console.warn('Email connection check:',code);return res.status(502).json({ok:false,error:code,emailSent:false});}
 };}
module.exports={makeEmailStatusHandler};
