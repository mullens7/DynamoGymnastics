const {randomUUID}=require('node:crypto');
const {currentUser}=require('./user-auth.cjs');
const {sameOrigin}=require('./admin-auth.cjs');
const {store,all}=require('./store.cjs');
const {database}=require('./database.cjs');
const BUCKET='dynamo-staff',MAX_VIDEO=50*1024*1024,MAX_PDF=20*1024*1024;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function date(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function validate(input){
 const kind=input.kind;if(!['plan','overview','warmup'].includes(kind))throw Error('Choose a resource type.');
 const title=String(input.title||'').trim(),artist=String(input.artist||'').trim(),notes=String(input.notes||'').trim();
 if(!title||title.length>160||artist.length>160||notes.length>2000)throw Error('Enter a title (up to 160 characters) and shorter notes.');
 let song_url=String(input.songUrl||'').trim();if(song_url){try{const u=new URL(song_url);if(u.protocol!=='https:'||u.username||u.password||song_url.length>1000)throw Error();song_url=u.href;}catch{throw Error('Use a valid HTTPS song link.');}}
 const r={kind,title,artist:kind==='warmup'?artist:'',notes,song_url:kind==='warmup'?song_url:'',class_group:null,start_date:null,end_date:null};
 if(kind!=='warmup'){
  if(!(kind==='overview'?['Gymini','Recreational','Both']:['Gymini','Recreational']).includes(input.classGroup)||!date(input.startDate)||!date(input.endDate)||input.endDate<input.startDate)throw Error('Choose Gymini or Recreational and a valid start and end date.');
  if((Date.parse(input.endDate)-Date.parse(input.startDate))/86400000>366)throw Error('Choose a date range of one year or less.');
  Object.assign(r,{class_group:input.classGroup,start_date:input.startDate,end_date:input.endDate});
 }
 const file=input.file;if(kind!=='warmup'&&!file)throw Error('Choose a PDF plan.');
 if(file){const type=kind==='warmup'?'video/mp4':'application/pdf',limit=kind==='warmup'?MAX_VIDEO:MAX_PDF,extension=kind==='warmup'?'.mp4':'.pdf';
  if(file.type!==type||!Number.isInteger(file.size)||file.size<12||file.size>limit||typeof file.name!=='string'||file.name.length>240||!file.name.toLowerCase().endsWith(extension))throw Error(kind==='warmup'?'Choose an MP4 video, up to 50 MB.':'Choose a PDF, up to 20 MB.');
  Object.assign(r,{file_name:file.name,mime_type:type,file_size:file.size});
 }
 return r;
}
async function storage(env,path,options={}){const config=database(env);const response=await fetch(config.url+'/storage/v1/'+path,{...options,headers:{...config.headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('The file could not be accessed. Please try again.');return response.json();}
async function signedUpload(env,path){const result=await storage(env,'object/upload/sign/'+BUCKET+'/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return database(env).url+'/storage/v1'+result.url;}
async function signedRead(env,path){const result=await storage(env,'object/sign/'+BUCKET+'/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:900})});return database(env).url+'/storage/v1'+result.signedURL;}
async function verifyFile(env,record){
 const info=await storage(env,'object/info/'+BUCKET+'/'+record.object_path),metadata=info.metadata||{};
 if(Number(metadata.size)!==record.file_size||metadata.mimetype!==record.mime_type)throw Error('The uploaded file did not match. Please upload it again.');
 const config=database(env),response=await fetch(config.url+'/storage/v1/object/'+BUCKET+'/'+record.object_path,{headers:{...config.headers,Range:'bytes=0-31'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('The upload is not ready. Please try again.');
 const reader=response.body.getReader();let bytes=Buffer.alloc(0);try{while(bytes.length<12){const chunk=await reader.read();if(chunk.done)break;bytes=Buffer.concat([bytes,Buffer.from(chunk.value)]);}}finally{await reader.cancel();}
 if(record.mime_type==='application/pdf'?bytes.subarray(0,5).toString()!=='%PDF-':bytes.subarray(4,8).toString()!=='ftyp')throw Error('The file is not a valid PDF or MP4.');
}
function makeStaffHandler(env=process.env,services={currentUser,store,all,signedUpload,signedRead,verifyFile}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const user=await services.currentUser(req,env);if(!user)return res.status(401).json({message:'Log in to the staff portal.'});
  if(!user.websiteAdmin&&!user.roster_staff)return res.status(403).json({message:'This portal is for Dynamo staff. Contact the club if you need access.'});
  if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({message:'Method not allowed.'});
  if(req.method!=='GET'&&!sameOrigin(req))return res.status(403).json({message:'Open the Dynamo website to continue.'});
  if(req.method==='GET'){const records=await services.all(env,'dynamo_staff_resources?select=id,kind,title,artist,notes,song_url,class_group,start_date,end_date,file_name,mime_type,file_size,created_at&archived=eq.false&state=eq.ready&order=start_date.asc.nullslast,created_at.desc');return res.status(200).json({user:{name:user.owner_name||user.email,websiteAdmin:user.websiteAdmin},records});}
  if(req.method==='DELETE'){if(!uuid(req.query?.id))return res.status(400).json({message:'Choose a resource.'});const rows=await services.store(env,'dynamo_staff_resources?id=eq.'+req.query.id+'&archived=eq.false',{method:'PATCH',body:JSON.stringify({archived:true})});return res.status(rows.length?200:404).json({ok:!!rows.length});}
  const action=req.body?.action;
  if(action==='add'){
   let record;try{record=validate(req.body);}catch(e){return res.status(400).json({message:e.message});}
   const recent=await services.store(env,'dynamo_staff_resources?select=id&created_by=eq.'+user.id+'&created_at=gt.'+encodeURIComponent(new Date(Date.now()-7200000).toISOString())+'&limit=60');if(recent.length>=60)return res.status(429).json({message:'Please wait before adding more resources.'});
   const id=randomUUID(),hasFile=!!req.body.file,object_path=hasFile?id+(record.kind==='warmup'?'.mp4':'.pdf'):null;
   const uploadUrl=hasFile?await services.signedUpload(env,object_path):null;
   await services.store(env,'dynamo_staff_resources',{method:'POST',body:JSON.stringify({...record,id,object_path,created_by:user.id,state:hasFile?'uploading':'ready'})});
   return res.status(201).json({id,uploadUrl});
  }
  if(!uuid(req.body?.id))return res.status(400).json({message:'Choose a resource.'});
  if(action==='complete'){
   const rows=await services.store(env,'dynamo_staff_resources?select=*&id=eq.'+req.body.id+'&created_by=eq.'+user.id+'&archived=eq.false&limit=1'),record=rows[0];
   if(!record||!record.object_path)return res.status(404).json({message:'This upload was not found.'});
   if(record.state==='ready')return res.status(200).json({ok:true});
   await services.verifyFile(env,record);
   try{await services.store(env,'dynamo_staff_resources?id=eq.'+record.id+'&state=eq.uploading&archived=eq.false',{method:'PATCH',body:JSON.stringify({state:'ready'})});}catch{return res.status(409).json({message:'This plan overlaps another plan for the same class. Delete the old plan or change the dates.'});}
   return res.status(200).json({ok:true});
  }
  if(action==='open'){
   const rows=await services.store(env,'dynamo_staff_resources?select=object_path,mime_type&id=eq.'+req.body.id+'&archived=eq.false&state=eq.ready&limit=1');
   if(!rows[0]?.object_path)return res.status(404).json({message:'This file is no longer available.'});
   return res.status(200).json({url:await services.signedRead(env,rows[0].object_path),mimeType:rows[0].mime_type});
  }
  return res.status(400).json({message:'Choose a staff portal action.'});
 }catch{return res.status(503).json({message:'The staff portal could not complete that action. Please try again.'});}
};}
module.exports={makeStaffHandler,validate,verifyFile,MAX_PDF,MAX_VIDEO};
