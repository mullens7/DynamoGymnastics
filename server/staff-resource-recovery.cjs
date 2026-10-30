// Scheduler-authenticated recovery of files that uploaded but never completed verification.
// No notification, payment, membership or staff-permission changes.
const {all,store}=require('./store.cjs');
const {verifyFile}=require('./staff-resources.cjs');
async function recoverStaffResources(env,services={all,store,verifyFile}){
 const rows=await services.all(env,'dynamo_staff_resources?select=*&archived=eq.false&order=created_at.desc');
 const seen=new Set(),result={recovered:0,duplicatesSkipped:0,failed:0};
 for(const row of rows){
  const key=JSON.stringify([row.created_by,row.kind,row.class_group,row.start_date,row.end_date,row.title,row.file_name,row.file_size]);
  if(row.state==='ready'){seen.add(key);continue;}
  if(row.state!=='uploading'||!row.object_path)continue;
  if(seen.has(key)){result.duplicatesSkipped++;continue;}
  try{
   await services.verifyFile(env,row);
   const updated=await services.store(env,'dynamo_staff_resources?id=eq.'+row.id+'&state=eq.uploading&archived=eq.false',{method:'PATCH',body:JSON.stringify({state:'ready'})});
   if(updated.length){seen.add(key);result.recovered++;}
  }catch{result.failed++;}
 }
 return {ok:result.failed===0,...result};
}
module.exports={recoverStaffResources};
