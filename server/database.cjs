function database(env){
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!env.SUPABASE_URL||!key)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{code:'DATABASE_NOT_CONFIGURED',stage:'validation'});
 let url;try{url=new URL(env.SUPABASE_URL);}catch{throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{code:'DATABASE_NOT_CONFIGURED'});}
 if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{code:'DATABASE_NOT_CONFIGURED'});
 return {url:url.origin,headers:key.startsWith('sb_secret_')?{apikey:key}:{apikey:key,Authorization:'Bearer '+key}};
}
module.exports={database};
