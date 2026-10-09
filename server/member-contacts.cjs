const {database}=require('./database.cjs');
const {authorizeAdmin}=require('./admin-auth.cjs');
module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 if(!await authorizeAdmin(req))return res.status(401).json({error:'UNAUTHORISED'});
 if(!process.env.SUPABASE_URL||!(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY))return res.status(503).json({error:'DATABASE_NOT_CONFIGURED'});
 try{
  const config=database(process.env),url=new URL(config.url);
  url.pathname='/rest/v1/dynamo_accounts';
  url.searchParams.set('select','id,email,owner_name,roster_member,roster_staff,wallet_pence,dynamo_gymnasts(id,first_name,last_name,date_of_birth,bg_number,groups,active)');
  url.searchParams.set('order','email.asc');
  // Explicit pagination: never silently truncate Contacts at PostgREST's row limit.
  const accounts=[];let offset=0;
  while(true){
   url.searchParams.set('limit','500');url.searchParams.set('offset',String(offset));
   const response=await fetch(url,{headers:config.headers,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Database unavailable');const rows=await response.json();
   accounts.push(...rows);if(rows.length<500)break;offset+=500;if(offset>20000)throw new Error('Contacts limit');
  }
  const syncUrl=new URL(config.url+'/rest/v1/dynamo_sync_jobs');
  syncUrl.searchParams.set('select','finished_at');syncUrl.searchParams.set('status','eq.complete');syncUrl.searchParams.set('order','finished_at.desc');syncUrl.searchParams.set('limit','1');
  const syncResponse=await fetch(syncUrl,{headers:config.headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!syncResponse.ok)throw new Error('Sync status unavailable');const syncs=await syncResponse.json();
  let lastSyncedAt=syncs[0]?.finished_at||null;
  if(!lastSyncedAt){const rosterUrl=new URL(config.url+'/rest/v1/dynamo_roster_runs?select=completed_at&order=completed_at.desc&limit=1');const rosterResponse=await fetch(rosterUrl,{headers:config.headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!rosterResponse.ok)throw new Error('Sync status unavailable');const runs=await rosterResponse.json();lastSyncedAt=runs[0]?.completed_at||null;}
  return res.status(200).json({accounts:accounts.map(account=>({...account,websiteAdmin:require('./roles.cjs').isWebsiteAdmin(account.email)})),lastSyncedAt});
 }catch{return res.status(502).json({error:'CONTACTS_UNAVAILABLE',message:'Contacts could not be loaded.'});}
};
