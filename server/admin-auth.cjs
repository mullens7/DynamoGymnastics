const {createHmac,timingSafeEqual}=require('node:crypto');
const COOKIE='__Host-dynamo-admin',TTL=12*60*60;
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function configured(env){return typeof env.SYNC_TEST_KEY==='string'&&env.SYNC_TEST_KEY.length>=32;}
function sign(body,env){return createHmac('sha256',env.SYNC_TEST_KEY).update('dynamo-admin-v1:'+body).digest('base64url');}
function token(env,now=Date.now()){if(!configured(env))throw Error('NOT_CONFIGURED');const body=Buffer.from(JSON.stringify({expires:Math.floor(now/1000)+TTL})).toString('base64url');return body+'.'+sign(body,env);}
function session(req,env,now=Date.now()){
 if(!configured(env))return false;
 const value=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!value||value.length>1024)return false;const parts=value.split('.');if(parts.length!==2||!equal(parts[1],sign(parts[0],env)))return false;
 try{const {expires}=JSON.parse(Buffer.from(parts[0],'base64url').toString());return Number.isInteger(expires)&&expires>Math.floor(now/1000)&&expires<=Math.floor(now/1000)+TTL;}catch{return false;}
}
function authenticated(req,env=process.env){return session(req,env)||configured(env)&&equal(req.headers.authorization,'Bearer '+env.SYNC_TEST_KEY);}
function sameOrigin(req){try{const origin=new URL(req.headers.origin);return origin.protocol==='https:'&&origin.host===req.headers.host;}catch{return false;}}
function allowed(req,env=process.env){return authenticated(req,env)&&(req.method==='GET'||req.method==='HEAD'||sameOrigin(req)||equal(req.headers.authorization,'Bearer '+env.SYNC_TEST_KEY));}
function cookie(value,maxAge=TTL){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;}
module.exports={token,session,authenticated,allowed,sameOrigin,cookie,equal,configured};

async function authorizeAdmin(req,env=process.env){if(allowed(req,env))return true;try{const user=await require('./user-auth.cjs').currentUser(req,env);return !!user?.websiteAdmin&&(req.method==='GET'||req.method==='HEAD'||sameOrigin(req));}catch{return false;}}
module.exports.authorizeAdmin=authorizeAdmin;
