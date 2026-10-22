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
function sourceMapping(source,columns,mapping){
 if(source.key!=='gymtots')return mapping;
 const normal=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const resolved={...mapping};
 // Gymtots uses separate custom fields with different labels for the same data.
 const aliases={timeClass:['timeandclass','timeclass','class'],bgNumber:['bgmembershipnumber','bgmembernumber']};
 for(const [field,names] of Object.entries(aliases)){
  if(!resolved[field]||columns.some(c=>normal(c.label)===normal(resolved[field])))continue;
  const matches=columns.filter(c=>names.includes(normal(c.label)));
  if(matches.length===1)resolved[field]=matches[0].label;
 }
 return resolved;
}
function mergeRosters(sources,{skipInvalid=false,report={}}={}){
 const conflicts=new Set(),known=new Map();report.skipped=[];
 if(skipInvalid)for(const source of sources)for(const owner of source.owners)for(const child of owner.gymnasts){
  const key=child.sourceId,previous=known.get(key),canonical=v=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  if(previous&&(previous.email!==owner.email||canonical(previous.child.firstName)!==canonical(child.firstName)||canonical(previous.child.lastName)!==canonical(child.lastName)||previous.child.dateOfBirth!==child.dateOfBirth||previous.child.bgNumber&&child.bgNumber&&previous.child.bgNumber!==child.bgNumber))conflicts.add(key);
  else if(!previous)known.set(key,{email:owner.email,child});
 }

 const owners=new Map(),ids=new Map();
 for(const source of sources)for(const incoming of source.owners){
  let owner=owners.get(incoming.email);
  if(!owner){owner={email:incoming.email,ownerName:incoming.ownerName,member:false,staff:false,gymnasts:[]};owners.set(incoming.email,owner);}
  if(incoming.preserveExisting)owner.preserveExisting=true;
  if(!owner.ownerName)owner.ownerName=incoming.ownerName;
  owner.member ||= incoming.member;owner.staff ||= incoming.staff;
  for(const child of incoming.gymnasts){
   if(conflicts.has(child.sourceId)){owner.preserveExisting=true;if(!report.skipped.some(item=>item.sourceId===child.sourceId))report.skipped.push({sourceId:child.sourceId,reason:'Conflicting identity details across the exports. Existing data retained.'});continue;}
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
 if(skipInvalid)for(const owner of owners.values())owner.member=owner.gymnasts.some(child=>child.active);
 return [...owners.values()];
}
function sourceSummary(source){
 return {key:source.key,accounts:source.owners.length,members:source.owners.filter(a=>a.member).length,staff:source.owners.filter(a=>a.staff).length,gymnasts:source.owners.reduce((n,a)=>n+a.gymnasts.length,0)};
}
module.exports={sourceConfigurations,sourceMapping,mergeRosters,sourceSummary};
