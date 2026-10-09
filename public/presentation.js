// Presentation only. No authentication, booking, payment or submission.
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('click',event=>{
 if(event.target.closest('[data-static-control],button[type="submit"]'))event.preventDefault();
 const toggle=event.target.closest('[aria-controls][aria-expanded]');
 if(toggle){const panel=document.getElementById(toggle.getAttribute('aria-controls'));if(panel){const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!open));panel.hidden=open;}}
});
