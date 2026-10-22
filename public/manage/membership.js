/* Shared membership rules for management and trusted server-side imports.
   Classification alone never proves active enrolment or authorises portal access. */
(function(root){
  // Non-selectable legacy key preserves existing Dynamo-only Gymtots records.
  const groups = Object.freeze(Object.defineProperty({under_2_years:'Under 2 Years',two_years:'2 Years',three_to_four_years:'3–4 Years',under_4_years:'Under 4 Years',gymini:'Gymini',recreational:'Recreational',advanced:'Advanced',mens_squad:"Men’s Squad",mens_development:"Men’s Development Squad",womens_squad:"Women’s Squad",womens_development:"Women’s Development Squad"},'gymtots',{value:'Gymtots',enumerable:false}));
  function classify(value){
    const entries = (Array.isArray(value)?value:[value]).flatMap(v=>String(v??'').split(/[,;\n|]+/)).map(s=>s.trim()).filter(Boolean);
    const result = new Set(), review = [], unmapped = [];
    let staff = false;
    for(const text of entries){
      staff ||= /coach|manager|director/i.test(text);
      const development = /\bdevelopment\b/i.test(text);
      if(/gymtots/i.test(text))result.add('gymtots');
      if(/gymini/i.test(text))result.add('gymini');
      if(/advanced/i.test(text))result.add('advanced');
      else if(/recreational/i.test(text))result.add('recreational');
      if(/\bMA\b/i.test(text))result.add(development?'mens_development':'mens_squad');
      if(/\bWA\b/i.test(text))result.add(development?'womens_development':'womens_squad');
      if(!/gymtots|gymini|advanced|recreational|\bMA\b|\bWA\b|coach|manager|director/i.test(text)&&!/^\w+day\b/i.test(text))unmapped.push('Unmapped entry: '+text);
    }
    // Class keywords can occur anywhere in the field; dates and notes are not separate enrolments.
    if(!result.size&&!staff)review.push(...unmapped);
    return {groups:[...result],staff,review};
  }
  // Gymtots organisation only: do not apply age-label matching to Dynamo exports.
  function classifyGymtots(value){
    const entries=(Array.isArray(value)?value:[value]).flatMap(v=>String(v??'').normalize('NFKC').replace(/[–—]/g,'-').split(/[,;\n|]+/)).map(s=>s.trim()).filter(Boolean);
    const result=new Set(),unmapped=[];let staff=false;
    for(const text of entries){
      staff ||= /coach|manager|director/i.test(text);
      if(/gymini|\b4\s*-\s*7(?:\s*years?\b|\b)/i.test(text))result.add('gymini');
      else if(/\bunder\s*2\b/i.test(text))result.add('under_2_years');
      else if(/\b3\s*-\s*4\s*years?\b/i.test(text))result.add('three_to_four_years');
      else if(/\bunder\s*4\b/i.test(text))result.add('under_4_years');
      else if(/\b2\s*years?\b/i.test(text))result.add('two_years');
      else if(!/coach|manager|director/i.test(text))unmapped.push('Unmapped entry: '+text);
    }
    return {groups:[...result],staff,review:!result.size&&!staff?unmapped:[]};
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
    const profile=account?.gymnasts?.find(g=>g.id===gymnastId);if(event.minAge!=null||event.maxAge!=null){const dob=profile?.date_of_birth;if(!/^\d{4}-\d{2}-\d{2}$/.test(dob||'')||!event.date)return false;const age=Number(event.date.slice(0,4))-Number(dob.slice(0,4))-(event.date.slice(5)<dob.slice(5)?1:0);if(age<0||(event.minAge!=null&&age<event.minAge)||(event.maxAge!=null&&age>event.maxAge))return false;}
    if(event.audience==='everyone')return true;
    const g=account?.gymnasts?.find(g=>g.id===gymnastId&&g.active);
    if(!g)return false;
    if(event.audience==='members')return g.groups.length>0;
    return event.audience==='groups'&&g.groups.some(id=>(event.allowedGroups||[]).includes(id));
  }
  function isMember(gymnast){return gymnast?.active===true&&Array.isArray(gymnast.groups)&&gymnast.groups.length>0;}
  function requiresBgExpiry(g){return isMember(g)&&g.groups.some(id=>!['under_2_years','two_years','under_4_years'].includes(id));}
  function quote(event,account,gymnastId){
    if(!eligible(event,account,gymnastId))return {eligible:false,priceCents:null};
    // Discounts belong to the selected active gymnast, not their siblings.
    return {eligible:true,priceCents:isMember(account?.gymnasts?.find(g=>g.id===gymnastId))?event.memberPriceCents:event.nonMemberPriceCents};
  }
  const api=Object.freeze({groups,classify,classifyGymtots,accounts,cents,eligible,quote,isMember,requiresBgExpiry});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.DynamoMembership=api;
})(globalThis);
