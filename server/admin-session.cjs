const auth=require('./admin-auth.cjs');
function makeSessionHandler(env=process.env){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET'){const user=await require('./user-auth.cjs').currentUser(req,env);const legacy=!user&&auth.configured(env)&&auth.equal(req.headers.authorization,'Bearer '+env.SYNC_TEST_KEY),authenticated=legacy||!!user?.managementAccess;return res.status(authenticated?200:user?403:401).json(authenticated?{authenticated,permissions:legacy?['*']:user.permissions,role:legacy?'super_admin':user.staffRole,userId:user?.id}:{message:'Your staff role does not include management access.'});}
 if(!['POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 if(!auth.sameOrigin(req))return res.status(403).json({message:'This request must come from the management website.'});
 if(req.method==='DELETE'){const userAuth=require('./user-auth.cjs');await userAuth.signOut(req,env);res.setHeader('Set-Cookie',[auth.cookie('',0),userAuth.cookie('',0,req)]);return res.status(200).json({authenticated:false});}
 return res.status(405).json({message:'Log in with your email verification code to access management.'});
};}
module.exports={makeSessionHandler};
