(async()=>{
 const list=document.getElementById('results-list');
 try{
  const response=await fetch('/api/results/',{cache:'no-store'});if(!response.ok)throw Error();const {records}=await response.json();list.replaceChildren();
  if(!records.length){const p=document.createElement('p');p.textContent='Competition results will appear here when published.';list.append(p);}
  for(const r of records){
   const card=document.createElement('article');card.className='card';
   const heading=document.createElement('h2');heading.textContent=r.name;
   const date=document.createElement('p');date.className='eyebrow';date.textContent=new Date(r.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
   card.append(date,heading);
   if(r.description){const text=document.createElement('p');text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';text.textContent=r.description;card.append(text);}
   if(r.link){const url=new URL(r.link);if(url.protocol==='https:'&&!url.username&&!url.password){const a=document.createElement('a');a.className='text-link';a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='View full results ↗';card.append(a);}}
   list.append(card);
  }
 }catch{list.textContent='Results could not be loaded. Please refresh or contact the Dynamo team.';}
})();
