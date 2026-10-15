const {RosterError}=require('./member-roster.cjs');
function sourceConfigurations(env){
 const sources=[{key:'dynamo',name:'Dynamo Gymnastics',env}];
 const requested=env.GYMTOTS_THRIVE_ENABLED==='true'||Boolean(env.GYMTOTS_THRIVE_EMAIL||env.GYMTOTS_THRIVE_PASSWORD);
 if(requested){
  if(!env.GYMTOTS_THRIVE_EMAIL||!env.GYMTOTS_THRIVE_PASSWORD)throw new RosterError('GYMTOTS_NOT_CONFIGURED');
  sources.push({key:'gymtots',name:'Gymtots R OK',env:{...env,THRIVE_EMAIL:env.GYMTOTS_THRIVE_EMAIL,THRIVE_PASSWORD:env.GYMTOTS_THRIVE_PASSWORD,THRIVE_ORGANISATION:env.GYMTOTS_THRIVE_ORGANISATION||'Gymtots R OK',THRIVE_EXPORT_MAPPING:env.GYMTOTS_THRIVE_EXPORT_MAPPING||env.THRIVE_EXPORT_MAPPING}});
 }
 return sources;
}
function mergeRosters(sources){
 const owners=new Map(),ids=new Map();
 for(const source of sources)for(const incoming of source.owners){
  let owner=owners.get(incoming.email);
  if(!owner){owner={email:incoming.email,ownerName:incoming.ownerName,member:false,staff:false,gymnasts:[]};owners.set(incoming.email,owner);}
  if(!owner.ownerName)owner.ownerName=incoming.ownerName;
  owner.member ||= incoming.member;owner.staff ||= incoming.staff;
  for(const child of incoming.gymnasts){
   if(ids.has(child.sourceId)&&ids.get(child.sourceId)!==incoming.email)throw new RosterError('IDENTITY_REVIEW_REQUIRED');
   ids.set(child.sourceId,incoming.email);
   const previous=owner.gymnasts.find(g=>g.sourceId===child.sourceId);
   if(!previous){owner.gymnasts.push({...child,groups:[...child.groups]});continue;}
   const canonical=v=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
   if(canonical(previous.firstName)!==canonical(child.firstName)||canonical(previous.lastName)!==canonical(child.lastName)||previous.dateOfBirth!==child.dateOfBirth||previous.bgNumber&&child.bgNumber&&previous.bgNumber!==child.bgNumber)throw new RosterError('IDENTITY_REVIEW_REQUIRED');
   const active=[previous,child].filter(g=>g.active),used=active.length?active:[previous,child];
   previous.groups=[...new Set(used.flatMap(g=>g.groups))];
   previous.timeClass=[...new Set(used.map(g=>g.timeClass).filter(Boolean))].join(' | ');
   previous.active ||= child.active;previous.bgNumber ||= child.bgNumber;
  }
 }
 return [...owners.values()];
}
function sourceSummary(source){
 return {key:source.key,accounts:source.owners.length,members:source.owners.filter(a=>a.member).length,staff:source.owners.filter(a=>a.staff).length,gymnasts:source.owners.reduce((n,a)=>n+a.gymnasts.length,0)};
}
module.exports={sourceConfigurations,mergeRosters,sourceSummary};
