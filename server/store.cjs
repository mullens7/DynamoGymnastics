const {database}=require('./database.cjs');
async function store(env,path,options={}){const config=database(env);const response=await fetch(config.url+'/rest/v1/'+path,{...options,headers:{...config.headers,'Content-Type':'application/json',Prefer:'return=representation',...options.headers},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok){let code='STORAGE_FAILED';try{const body=await response.json();if(/^[A-Z_]+$/.test(body.message))code=body.message;}catch{}throw Object.assign(new Error(code),{code});}return response.status===204?null:response.json();}
const rpc=(env,name,body)=>store(env,'rpc/'+name,{method:'POST',body:JSON.stringify(body)});
module.exports={store,rpc};
async function all(env,path){const url=new URL('https://records.invalid/'+path),rows=[];for(let offset=0;offset<=20000;offset+=500){url.searchParams.set('limit','500');url.searchParams.set('offset',String(offset));const page=await store(env,url.pathname.slice(1)+url.search);rows.push(...page);if(page.length<500)return rows;}throw Error('RECORD_LIMIT');}
module.exports.all=all;
