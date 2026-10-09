const {equal}=require('../server/admin-auth.cjs');
const {performSync,scheduleSlot}=require('../server/sync-operation.cjs');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({ok:false});
 const key=process.env.SYNC_SCHEDULE_SECRET;
 if(typeof key!=='string'||key.length<32||!equal(req.headers.authorization,'Bearer '+key))return res.status(401).json({ok:false});
 // A harmless probe verifies scheduler credentials and deployment without running a sync.
 if(req.body?.probe===true)return res.status(200).json({ok:true,configured:true});
 const slot=scheduleSlot();if(!slot)return res.status(200).json({ok:true,skipped:true});
 try{const result=await performSync(process.env,{source:'scheduled',slot});return res.status(200).json({ok:true,duplicate:result.duplicate===true});}
 catch(error){console.warn('Scheduled member sync:',error.code||'AUTOMATION_FAILED');return res.status(error.code==='SYNC_BUSY'?409:502).json({ok:false,error:error.code||'AUTOMATION_FAILED'});}
};
