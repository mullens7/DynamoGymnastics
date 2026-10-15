(() => {
 const hosts=['dynamogymnastics.co.uk','www.dynamogymnastics.co.uk','auth.dynamogymnastics.co.uk','manage.dynamogymnastics.co.uk'];
 if(!hosts.includes(location.hostname))return;
 const page=new URL(location.href);
 if(page.hostname!=='dynamogymnastics.co.uk'){
  if(page.pathname==='/')page.pathname=page.hostname==='auth.dynamogymnastics.co.uk'?'/auth/':page.hostname==='manage.dynamogymnastics.co.uk'?'/manage/':'/';
  page.hostname='dynamogymnastics.co.uk';location.replace(page.href);return;
 }
 function update(link){
  let url;try{url=new URL(link.getAttribute('href'),location.href);}catch{return;}
  if(url.protocol!=='https:'||!hosts.includes(url.host))return;
  const target='dynamogymnastics.co.uk';
  if(url.pathname.startsWith('/auth/')&&url.searchParams.has('next')){
   const next=url.searchParams.get('next');if(next.startsWith('/'))url.searchParams.set('next',new URL(next,location.origin).href);
  }
  url.hostname=target;link.href=url.href;
 }
 const refresh=()=>document.querySelectorAll('a[href]').forEach(update);
 refresh();new MutationObserver(refresh).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link)update(link);},true);
})();
