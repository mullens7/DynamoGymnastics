const auth=require('./admin-auth.cjs');
function makeSessionHandler(env=process.env){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET')return res.status(auth.session(req,env)?200:401).json({authenticated:auth.session(req,env)});
 if(!['POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 if(!auth.sameOrigin(req))return res.status(403).json({message:'This request must come from the management website.'});
 if(req.method==='DELETE'){res.setHeader('Set-Cookie',auth.cookie('',0));return res.status(200).json({authenticated:false});}
 if(!auth.configured(env)||!auth.equal(req.body?.key,env.SYNC_TEST_KEY))return res.status(401).json({message:'The administrator access key is incorrect.'});
 res.setHeader('Set-Cookie',auth.cookie(auth.token(env)));return res.status(200).json({authenticated:true});
};}
module.exports={makeSessionHandler};
