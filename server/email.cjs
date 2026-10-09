const nodemailer=require('nodemailer');
class EmailError extends Error{constructor(code){super(code);this.code=code;}}
function address(value){return typeof value==='string'&&value.length<=254&&/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(value);}
function settings(env){
 const host=String(env.SMTP_HOST||'').trim(),port=Number(env.SMTP_PORT),user=String(env.SMTP_USER||'').trim(),password=String(env.SMTP_PASSWORD||'').replace(/\s/g,''),from=String(env.EMAIL_FROM||'').trim(),name=String(env.EMAIL_FROM_NAME||'Dynamo Gymnastics').trim();
 if(host!=='smtp.gmail.com'||![465,587].includes(port)||!address(user)||!address(from)||!/^[a-zA-Z0-9]{16}$/.test(password)||!name||name.length>100||/[\r\n]/.test(name))throw new EmailError('EMAIL_NOT_CONFIGURED');
 return {transport:{host,port,secure:port===465,requireTLS:true,auth:{user,pass:password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,maxRecipients:1},from:{name,address:from}};
}
function safeError(error){return new EmailError(error?.code==='EAUTH'?'EMAIL_AUTH_FAILED':error?.code==='ETIMEDOUT'?'EMAIL_CONNECTION_TIMEOUT':'EMAIL_CONNECTION_FAILED');}
async function verifyEmail(env=process.env,createTransport=nodemailer.createTransport){
 const config=settings(env),transport=createTransport(config.transport);
 try{await transport.verify();return {ok:true,smtpAuthenticated:true,emailSent:false};}catch(error){throw safeError(error);}finally{transport.close();}
}
// Server-only primitive. No public endpoint accepts arbitrary recipients or content.
async function sendEmail({to,subject,text,html},env=process.env,createTransport=nodemailer.createTransport){
 if(!address(to)||typeof subject!=='string'||!subject.trim()||subject.length>200||/[\r\n]/.test(subject)||typeof text!=='string'||!text||text.length>100000||(html!==undefined&&(typeof html!=='string'||html.length>200000)))throw new EmailError('EMAIL_INVALID_MESSAGE');
 const config=settings(env),transport=createTransport(config.transport);
 try{const result=await transport.sendMail({from:config.from,to,subject,text,...(html===undefined?{}:{html})});if(!result.accepted?.length)throw new EmailError('EMAIL_RECIPIENT_REJECTED');return {ok:true};}catch(error){if(error instanceof EmailError)throw error;throw safeError(error);}finally{transport.close();}
}
module.exports={settings,verifyEmail,sendEmail,EmailError};
