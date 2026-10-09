const {createHash}=require('node:crypto');
const {store}=require('./store.cjs');
const {isWebsiteAdmin}=require('./roles.cjs');
const COOKIE='__Host-dynamo-user';
const hash=value=>createHash('sha256').update(value).digest('hex');
function sessionToken(req){const value=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(value||'')?value:null;}
const cookie=(value,maxAge=43200)=>`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
async function currentUser(req,env=process.env){const token=sessionToken(req);if(!token)return null;const rows=await store(env,'dynamo_user_sessions?select=account:dynamo_accounts(id,email,owner_name,roster_member,roster_staff,wallet_pence)&token_hash=eq.'+hash(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');const account=rows[0]?.account;if(!account)return null;return {...account,websiteAdmin:isWebsiteAdmin(account.email)};}
async function signOut(req,env){const token=sessionToken(req);if(token)await store(env,'dynamo_user_sessions?token_hash=eq.'+hash(token),{method:'DELETE'});}
module.exports={currentUser,sessionToken,cookie,hash,signOut};
