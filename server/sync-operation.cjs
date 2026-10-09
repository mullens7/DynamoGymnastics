const {database}=require('./database.cjs');
const {syncMembers}=require('./member-sync.cjs');
const {equal}=require('./admin-auth.cjs');
const {RosterError}=require('./member-roster.cjs');
async function rpc(env,name,body){const config=database(env),r=await fetch(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new RosterError('SYNC_STORAGE_FAILED');return r.json();}
async function confirmPin(env,pin){
 if(!/^\d{4}$/.test(env.SYNC_CONFIRM_PIN||''))throw new RosterError('PIN_NOT_CONFIGURED');
 const matches=typeof pin==='string'&&/^\d{4}$/.test(pin)&&equal(pin,env.SYNC_CONFIRM_PIN);
 const verdict=await rpc(env,'check_dynamo_sync_pin',{p_matches:matches});if(verdict!=='OK')throw new RosterError(verdict==='PIN_LOCKED'?'PIN_LOCKED':'PIN_INCORRECT');
}
async function finish(env,id,status,result,errorCode){const c=database(env),url=new URL(c.url+'/rest/v1/dynamo_sync_jobs');url.searchParams.set('id','eq.'+id);const r=await fetch(url,{method:'PATCH',headers:{...c.headers,'Content-Type':'application/json'},redirect:'error',body:JSON.stringify({status,finished_at:new Date().toISOString(),result:result?{accounts:result.accounts,members:result.members,staff:result.staff,unchanged:result.unchanged}:null,error_code:errorCode||null}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new RosterError('SYNC_STORAGE_FAILED');}
async function performSync(env,{source='manual',slot=null,onProgress=()=>{}}={}){
 const claim=await rpc(env,'claim_dynamo_sync',{p_source:source,p_slot:slot});
 if(claim.state==='duplicate')return {ok:true,duplicate:true};
 if(claim.state!=='claimed')throw new RosterError('SYNC_BUSY');
 try{const result=await syncMembers(env,{onProgress});await finish(env,claim.id,'complete',result);onProgress({percent:100,label:'Sync complete'});return result;}
 catch(error){try{await finish(env,claim.id,'failed',null,error.code||'AUTOMATION_FAILED');}catch{console.warn('Member sync: job status could not be saved');}throw error;}
}
function scheduleSlot(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 if(!['00','12'].includes(parts.hour)||Number(parts.minute)>10)return null;
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00-Europe/London`;
}
module.exports={performSync,confirmPin,scheduleSlot};
