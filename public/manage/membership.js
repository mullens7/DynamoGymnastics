/* Shared rules for the preview and future trusted, server-side imports.
   Classification alone never proves active enrolment or authorises portal access. */
(function(root){
  const groups = Object.freeze({gymini:'Gymini',recreational:'Recreational',advanced:'Advanced',mens_squad:"Men’s Squad",mens_development:"Men’s Development Squad",womens_squad:"Women’s Squad",womens_development:"Women’s Development Squad"});
  function classify(value){
    const entries = (Array.isArray(value)?value:[value]).flatMap(v=>String(v??'').split(/[,;\n|]+/)).map(s=>s.trim()).filter(Boolean);
    const result = new Set(), review = [];
    let staff = false;
    for(const text of entries){
      staff ||= /coach|manager|director/i.test(text);
      const development = /development/i.test(text);
      if(/gymini/i.test(text))result.add('gymini');
      if(/advanced/i.test(text))result.add('advanced');
      else if(/recreational/i.test(text))result.add('recreational');
      if(/\bMA\b/i.test(text))result.add(development?'mens_development':'mens_squad');
      if(/\bWA\b/i.test(text))result.add(development?'womens_development':'womens_squad');
      if(/\bdev\b/i.test(text)&&!development)review.push('“Dev” is not mapped to Development: '+text);
      if(!/gymini|advanced|recreational|\bMA\b|\bWA\b|coach|manager|director/i.test(text)&&!/^\w+day\b/i.test(text))review.push('Unmapped entry: '+text);
    }
    return {groups:[...result],staff,review};
  }
  // Rows must use trusted export identity fields. Never merge gymnasts by name.
  // A stable gymnastId and explicit active status are required for member benefits.
  function accounts(rows){
    const byEmail = new Map();
    for(const row of rows){
      const email=String(row.email??'').trim().toLowerCase();
      if(!email)continue;
      const c=classify(row.timeClass);
      let a=byEmail.get(email);
      if(!a){a={email,staff:false,gymnasts:[],review:[]};byEmail.set(email,a);}
      a.staff ||= c.staff;a.review.push(...c.review);
      if(!c.groups.length)continue;
      if(!row.gymnastId){a.review.push('Missing stable gymnast ID; membership not granted.');continue;}
      let g=a.gymnasts.find(g=>g.id===String(row.gymnastId));
      if(!g){g={id:String(row.gymnastId),name:String(row.name??''),groups:[],active:false};a.gymnasts.push(g);}
      if(row.active===true){g.active=true;g.groups=[...new Set([...g.groups,...c.groups])];}
    }
    return [...byEmail.values()].map(a=>({...a,member:a.gymnasts.some(g=>g.active&&g.groups.length),review:[...new Set(a.review)]}));
  }
  function cents(value){
    if(!/^\d+(\.\d{1,2})?$/.test(String(value)))throw new Error('Enter a non-negative price with up to two decimal places.');
    const [p,dec='']=String(value).split('.'),n=Number(p)*100+Number(dec.padEnd(2,'0'));
    if(!Number.isSafeInteger(n))throw new Error('Price is too large.');return n;
  }
  function eligible(event,account,gymnastId){
    if(event.audience==='everyone')return true;
    const g=account?.gymnasts?.find(g=>g.id===gymnastId&&g.active);
    if(!g)return false;
    if(event.audience==='members')return g.groups.length>0;
    return event.audience==='groups'&&g.groups.some(id=>(event.allowedGroups||[]).includes(id));
  }
  function quote(event,account,gymnastId){
    if(!eligible(event,account,gymnastId))return {eligible:false,priceCents:null};
    // Member pricing follows the verified owner's active-member household.
    return {eligible:true,priceCents:account?.member===true?event.memberPriceCents:event.nonMemberPriceCents};
  }
  const api=Object.freeze({groups,classify,accounts,cents,eligible,quote});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.DynamoMembership=api;
})(globalThis);
