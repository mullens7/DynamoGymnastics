(function(root){
 const classes=typeof module!=='undefined'?require('../classes/rules.js'):root.DynamoClasses;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function eligible(records,dob,date=today()){return records.filter(c=>c.status==='Published'&&(c.location||'Hamble')==='Hamble'&&['Gyminis','Recreational'].includes(c.category)&&classes.eligible(c,dob,date));}
 const key=c=>[c.location||'Hamble',c.day,c.start,c.end].join('|');
 function crossover(records,children,date=today()){
  const lists=children.map(c=>eligible(records,c.dob,date));if(lists.length<2)return [];
  return [...new Set(lists[0].map(key))].filter(k=>lists.every(list=>list.some(c=>key(c)===k))).map(k=>({key:k,classes:lists.map(list=>list.filter(c=>key(c)===k)),...lists[0].find(c=>key(c)===k)}));
 }

 const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],shortDays=['Mon','Tues','Weds','Thurs','Fri','Sat','Sun'];
 function clock(time){const [h,m]=time.split(':').map(Number);return (h%12||12)+(m?':'+String(m).padStart(2,'0'):'')+(h<12?'am':'pm');}
 function preference(selected,available){
  if(!selected.length)return '';
  const ids=new Set(selected.map(c=>c.id));
  if(available.length&&available.every(c=>ids.has(c.id))&&selected.every(c=>available.some(a=>a.id===c.id)))return 'Any';
  return days.flatMap((day,i)=>{const chosen=selected.filter(c=>c.day===day).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)),all=available.filter(c=>c.day===day);if(!chosen.length)return [];
   if(all.length&&all.every(c=>ids.has(c.id)))return [shortDays[i]];
   return [shortDays[i]+' '+[...new Set(chosen.map(c=>clock(c.start)+(all.some(a=>a.start===c.start&&a.end!==c.end)?'–'+clock(c.end):'')))].join(' / ')];
  }).join(', ');
 }
 function validate(input,records,date=today()){
  const clean=(v,n)=>typeof v==='string'&&v.trim()&&v.trim().length<=n&&!/[\r\n\x00-\x1f]/.test(v)?v.trim():'';
  const parent=clean(input.parent,160),email=clean(input.email,254)?.toLowerCase();
  if(!parent||!email||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email))throw Error('Enter your full name and a valid email address.');
  if(!Array.isArray(input.children)||!input.children.length||input.children.length>8)throw Error('Add between one and eight children.');
  const children=input.children.map((c,i)=>{const first=clean(c.first,80),last=clean(c.last,80),available=eligible(records,c.dob,date);if(!first||!last||!available.length)throw Error('Check the name, date of birth and eligible classes for child '+(i+1)+'.');
   if(!Array.isArray(c.classes)||!c.classes.length||c.classes.length>100||new Set(c.classes).size!==c.classes.length||c.classes.some(id=>!available.some(r=>r.id===id)))throw Error('Select at least one currently eligible class for '+first+'.');
   const chosen=c.classes.map(id=>available.find(r=>r.id===id));return {first,last,dob:c.dob,classes:chosen,preference:preference(chosen,available)};});
  if(input.together===true){if(children.length<2)throw Error('Add another child to choose shared sessions.');const keys=children.map(c=>[...new Set(c.classes.map(key))].sort().join(','));if(keys.some(k=>k!==keys[0]))throw Error('Choose the same day, time and location for all children.');}
  return {parent,email,together:input.together===true,children};
 }
 const api={eligible,crossover,key,validate,today,preference};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DynamoWaitingList=api;
})(globalThis);
