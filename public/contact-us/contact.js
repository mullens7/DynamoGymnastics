document.getElementById('contact-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),status=document.getElementById('contact-status');
 button.disabled=true;button.textContent='Sending…';status.textContent='';
 try{const response=await fetch('/api/contact/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form))),redirect:'error'});const body=await response.json();if(!response.ok)throw Error(body.message);status.textContent='Thank you — your message has been sent to the Dynamo team.';form.reset();}
 catch(e){status.textContent=e.message||'Your message could not be sent. Please email or call us.';}
 finally{button.disabled=false;button.textContent='Send message';}
});
