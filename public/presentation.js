// Keep the original layout while connecting account and booking entry points.
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('click',event=>{
 if(event.target.closest('[data-static-control],button[type="submit"]'))event.preventDefault();
 const toggle=event.target.closest('[aria-controls][aria-expanded]');
 if(toggle){const panel=document.getElementById(toggle.getAttribute('aria-controls'));if(panel){const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));panel.hidden=open;}}
});

let dynamoLoggedIn=false;
document.querySelectorAll('a[href]').forEach(link=>{const url=new URL(link.getAttribute('href'),location.origin);if(url.origin===location.origin&&/^\/parties\/(biggym-member|biggym-nonmember|smallgym-nonmember|non-member)\/$/.test(url.pathname))link.href='/book/?kind=party';});
document.addEventListener('click',event=>{const login=event.target.closest('.login-social-bar button');if(login){event.preventDefault();location.assign(dynamoLoggedIn?'/account/':'/auth/');return;}const control=event.target.closest('button,[data-static-control]');if(control&&/^(book|book now|book online)$/i.test(control.textContent.trim())){event.preventDefault();location.assign('/book/?kind='+ (location.pathname.includes('parties')?'party':'event'));}});
fetch('/api/login/',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(response=>{if(response.ok){dynamoLoggedIn=true;document.querySelectorAll('.login-social-bar .HuH6Ex').forEach(label=>label.textContent='My Account');}}).catch(()=>{});
