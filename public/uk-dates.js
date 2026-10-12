(function(root){
 const validISO=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 function format(value){if(!value)return '';if(typeof value==='string'&&validISO(value))return value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'2-digit',month:'2-digit',year:'numeric'}).format(date);}
 function parse(value){const match=String(value||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match)return '';const iso=match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');return validISO(iso)?iso:'';}
 const api={format,parse,validISO};root.DynamoDates=api;if(typeof module!=='undefined')module.exports=api;if(typeof document==='undefined')return;
 function enhance(input){if(input.dataset.ukDateReady)return;input.dataset.ukDateReady='true';
  const wrapper=document.createElement('span');wrapper.className='uk-date-field';input.before(wrapper);
  const text=document.createElement('input');text.type='text';text.inputMode='numeric';text.placeholder='dd/mm/yyyy';text.maxLength=10;text.autocomplete='off';text.className='uk-date-text';text.id=(input.id||'uk-date-'+Math.random().toString(36).slice(2))+'-display';text.setAttribute('aria-label',input.getAttribute('aria-label')||'Date (dd/mm/yyyy)');
  const labels=[...document.querySelectorAll('label')].filter(label=>label.htmlFor===input.id);for(const label of labels){label.htmlFor=text.id;text.removeAttribute('aria-label');}
  const button=document.createElement('button');button.type='button';button.className='uk-date-calendar';button.setAttribute('aria-label','Choose date');button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>';
  input.classList.add('uk-date-source');input.tabIndex=-1;input.setAttribute('aria-hidden','true');wrapper.append(text,button,input);
  const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  function validate(){const iso=parse(text.value);text.setCustomValidity(text.value&&!iso?'Enter a valid date as dd/mm/yyyy.':iso&&input.min&&iso<input.min?'Choose a date on or after '+format(input.min)+'.':iso&&input.max&&iso>input.max?'Choose a date on or before '+format(input.max)+'.':'');}
  function sync(){text.value=format(input.value);text.required=input.required;text.disabled=input.disabled;text.readOnly=input.readOnly;button.disabled=input.disabled||input.readOnly;validate();}
  Object.defineProperty(input,'value',{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
  function commit(){const iso=parse(text.value);descriptor.set.call(input,iso);validate();if(iso||!text.value)input.dispatchEvent(new Event('change',{bubbles:true}));}
  text.addEventListener('input',()=>{descriptor.set.call(input,parse(text.value));validate();});text.addEventListener('change',commit);text.addEventListener('blur',()=>{const iso=parse(text.value);if(iso)text.value=format(iso);});
  input.addEventListener('input',sync);input.addEventListener('change',sync);input.addEventListener('invalid',event=>{event.preventDefault();text.focus();text.reportValidity();});
  button.onclick=()=>{try{input.showPicker();}catch{text.focus();}};
  new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['min','max','disabled','readonly','required','value']});sync();
 }
 function scan(){document.querySelectorAll('input[type="date"]').forEach(enhance);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})(typeof window==='undefined'?globalThis:window);
