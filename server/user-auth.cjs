const {createHash}=require('node:crypto');
const {store}=require('./store.cjs');
const {staffAccess}=require('./roles.cjs');
const COOKIE='__Host-dynamo-user';
const SHARED_COOKIE='__Secure-dynamo-user';
const PRODUCTION_HOSTS=new Set(['dynamogymnastics.co.uk','www.dynamogymnastics.co.uk','auth.dynamogymnastics.co.uk','manage.dynamogymnastics.co.uk']);
const productionHost=req=>PRODUCTION_HOSTS.has(String(req?.headers?.host||'').toLowerCase());
const hash=value=>createHash('sha256').update(value).digest('hex');
function sessionToken(req){const name=productionHost(req)?SHARED_COOKIE:COOKIE;const values=String(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'=')).map(s=>s.slice(name.length+1));return values.length===1&&/^[a-f0-9]{64}$/.test(values[0])?values[0]:null;}
const cookie=(value,maxAge=43200,req)=>`${productionHost(req)?SHARED_COOKIE:COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}${productionHost(req)?'; Domain=dynamogymnastics.co.uk':''}`;
async function currentUser(req,env=process.env){const token=sessionToken(req);if(!token)return null;const rows=await store(env,'dynamo_user_sessions?select=account:dynamo_accounts(id,email,owner_name,roster_member,manual_member,manual_member_since,temporary_member_start,temporary_member_end,roster_staff,wallet_pence,staff_profile:dynamo_staff_profiles!dynamo_staff_profiles_account_id_fkey(first_name,last_name,manual_staff,enabled,role,roles))&token_hash=eq.'+hash(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');const account=rows[0]?.account;if(!account)return null;return staffAccess(account);}
async function signOut(req,env){const token=sessionToken(req);if(token)await store(env,'dynamo_user_sessions?token_hash=eq.'+hash(token),{method:'DELETE'});}
module.exports={currentUser,sessionToken,cookie,hash,signOut,productionHost};
