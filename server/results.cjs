const {database}=require('./database.cjs');
function makeResultsHandler(env=process.env){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({message:'Method not allowed.'});
 try{
  const config=database(env),url=new URL(config.url+'/rest/v1/dynamo_results');
  url.searchParams.set('select','id,details');url.searchParams.set('archived','eq.false');url.searchParams.set('details->>status','eq.Published');url.searchParams.set('order','details->>date.desc,created_at.desc');
  const records=[];
  for(let offset=0;offset<=20000;offset+=500){url.searchParams.set('limit','500');url.searchParams.set('offset',String(offset));const response=await fetch(url,{headers:config.headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error();const page=await response.json();records.push(...page.map(r=>({id:r.id,name:r.details.name,date:r.details.date,description:r.details.description,link:r.details.link})));if(page.length<500)return res.status(200).json({records});}
  throw Error();
 }catch{return res.status(502).json({message:'Results could not be loaded. Please try again.'});}
};}
module.exports={makeResultsHandler};
