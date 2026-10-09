(() => {
 const toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('#site-nav');
 const close=()=>{nav.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation menu');};
 toggle.addEventListener('click',()=>{const open=nav.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');});
 nav.addEventListener('click',event=>{if(event.target.closest('a'))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){close();toggle.focus();}});
 document.addEventListener('click',event=>{if(!event.target.closest('.site-header'))close();});
 const form=document.querySelector('#contact-form');
 if(form)form.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);location.href='mailto:admin@dynamogymnastics.co.uk?subject='+encodeURIComponent('Website enquiry: '+data.get('first')+' '+data.get('last'))+'&body='+encodeURIComponent('Gymnast: '+data.get('first')+' '+data.get('last')+'\n\n'+data.get('message'));});
 fetch('/api/login/',{credentials:'same-origin',cache:'no-store',redirect:'error'}).then(response=>{if(response.ok)document.querySelectorAll('[data-account-link]').forEach(link=>{link.textContent='My account';link.href='/account/';});}).catch(()=>{});
})();
