const {randomUUID}=require('node:crypto');
const {groups}=require('../public/manage/membership.js');
const slugify=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-$/,'');
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v||'');
function validateEvent(input){
 const name=String(input.name||'').trim(),slug=input.slug===undefined?slugify(name):String(input.slug).trim();
 if(!name||name.length>120)throw Error('Enter an event name of up to 120 characters.');
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>100||['detail','events','index'].includes(slug))throw Error('Use a link containing lowercase letters, numbers and hyphens.');
 if(input.rootLink===true&&['developer','api','assets','auth','manage','account','book','staff','awards','events','results','gallery','classes','parties','contact-us','terms','policies','legal','octoberhalfterm','index','detail'].includes(slug))throw Error('That link is reserved for a website page. Choose another.');
 const description=String(input.description||'').trim();if(description.length>10000)throw Error('Description must be under 10,000 characters.');
 if(!['Draft','Published'].includes(input.status)||!['everyone','members','groups'].includes(input.audience))throw Error('Choose a status and audience.');
 const allowedGroups=input.allowedGroups||[];if(!Array.isArray(allowedGroups)||allowedGroups.some(g=>!Object.hasOwn(groups,g))||(input.audience==='groups'&&!allowedGroups.length))throw Error('Choose valid member groups.');
 for(const key of ['memberPriceCents','nonMemberPriceCents'])if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>1000000)throw Error('Enter valid prices.');
 const image=String(input.image||'');if(image&&!/^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/dynamo-gallery\/[a-f0-9-]+\.jpg$/.test(image))throw Error('Upload an event image.');
 const rows=input.sessions||[{id:input.id,date:input.date,time:input.time,capacity:input.capacity,label:'',minAge:null,maxAge:null}];
 if(!Array.isArray(rows)||!rows.length||rows.length>200)throw Error('Add between 1 and 200 sessions.');
 const ids=new Set();const sessions=rows.map(s=>{const id=s.id||randomUUID();if(!uuid(id)||ids.has(id))throw Error('Choose unique sessions.');ids.add(id);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date||'')||isNaN(Date.parse(s.date))||new Date(s.date).toISOString().slice(0,10)!==s.date||(s.time!=null&&s.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)))throw Error('Enter a valid date and, if supplied, a valid start time for every session.');
 if(!Number.isInteger(s.capacity)||s.capacity<1||s.capacity>10000)throw Error('Each capacity must be between 1 and 10,000.');
 const minAge=s.minAge==null||s.minAge===''?null:Number(s.minAge),maxAge=s.maxAge==null||s.maxAge===''?null:Number(s.maxAge);
 if([minAge,maxAge].some(a=>a!==null&&(!Number.isInteger(a)||a<0||a>100))||(minAge!==null&&maxAge!==null&&minAge>maxAge))throw Error('Enter valid inclusive minimum and maximum ages.');
 const label=String(s.label||'').trim();if(label.length>100)throw Error('Age group / session label must be under 100 characters.');
 const endTime=s.endTime||'';if(endTime&&(!s.time||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)||endTime<=s.time))throw Error('Session end time must be after its start time.');return {id,date:s.date,time:s.time||'',endTime,capacity:s.capacity,label,minAge,maxAge};
 });sessions.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 return {name,slug,rootLink:input.rootLink===true,description,image,...require('./event-pricing.cjs').validatePricing(input,sessions),qrEmail:typeof input.qrEmail==='boolean'?input.qrEmail:null,bookingFields:require('./booking-fields.cjs').validateFields(input.bookingFields),status:input.status,audience:input.audience,allowedGroups:input.audience==='groups'?[...new Set(allowedGroups)]:[],memberPriceCents:input.memberPriceCents,nonMemberPriceCents:input.nonMemberPriceCents,sessions,date:sessions[0].date,time:sessions[0].time,capacity:sessions.reduce((n,s)=>n+s.capacity,0)};
}
module.exports={validateEvent,slugify};
