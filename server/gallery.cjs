const {randomUUID}=require('node:crypto');
const {database}=require('./database.cjs');
const {authorizeAdmin}=require('./admin-auth.cjs');
const {store,all}=require('./store.cjs');
function makeGalleryHandler(env=process.env,services={store,all,authorizeAdmin}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const admin=req.query?.admin==='1';
 if((admin||req.method!=='GET')&&!await services.authorizeAdmin(req,env))return res.status(401).json({message:'Sign in to management.'});
 if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
 try{
  if(req.method==='GET'){const rows=await services.all(env,'dynamo_gallery?select=id,src,alt&archived=eq.false&order=created_at.desc,id');return res.status(200).json({records:rows});}
  if(req.method==='DELETE'){const id=req.query?.id;if(!/^[a-f0-9-]{36}$/i.test(id||''))return res.status(400).json({message:'Choose a photo.'});const rows=await services.store(env,'dynamo_gallery?id=eq.'+id+'&archived=eq.false',{method:'PATCH',body:JSON.stringify({archived:true})});return res.status(rows.length?200:404).json({ok:!!rows.length});}
  const encoded=req.body?.image;
  if(typeof encoded!=='string'||encoded.length>2000000||!/^\/[9j][A-Za-z0-9+/]*={0,2}$/.test(encoded))return res.status(400).json({message:'Choose a valid photo.'});
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>1500000||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return res.status(400).json({message:'The photo is too large or invalid.'});
  const id=randomUUID(),path=id+'.jpg',config=database(env);
  const response=await fetch(config.url+'/storage/v1/object/dynamo-gallery/'+path,{method:'POST',headers:{...config.headers,'Content-Type':'image/jpeg','x-upsert':'false'},body:bytes,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error();
  const src=config.url+'/storage/v1/object/public/dynamo-gallery/'+path;
  try{const rows=await services.store(env,'dynamo_gallery',{method:'POST',body:JSON.stringify({id,src,alt:'Dynamo Gymnastics gallery photo'})});return res.status(201).json({record:rows[0]});}
  catch(error){await fetch(config.url+'/storage/v1/object/dynamo-gallery/'+path,{method:'DELETE',headers:config.headers,signal:AbortSignal.timeout(10000)}).catch(()=>{});throw error;}
 }catch{return res.status(502).json({message:'The gallery could not be updated. Please try again.'});}
};}
module.exports={makeGalleryHandler};
