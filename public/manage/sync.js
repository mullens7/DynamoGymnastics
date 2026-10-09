let syncRunning=false;
$('#dialog').addEventListener('cancel',event=>{if(syncRunning)event.preventDefault();});
document.querySelector('.sync-member').addEventListener('click',()=>{
 if(!signedIn){unlock();return;}
 if(syncRunning){toast('A member sync is already running.');return;}
 modal(`<h2>Sync Members</h2><p>Enter the four-digit staff code to confirm a manual sync.</p><label for="sync-pin">Confirmation code</label><input id="sync-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required autocomplete="off"><p class="help">Automatic syncs run at 00:00 and 12:00 UK time. No emails are sent, and account history is retained.</p><div id="sync-progress-wrap" hidden><div class="sync-progress-heading"><strong id="sync-percent">0%</strong><span id="sync-step">Preparing sync</span></div><progress id="sync-progress" value="0" max="100" aria-label="Member sync progress"></progress><p class="help">Progress follows the sync stages; remaining time can vary.</p></div><p id="sync-status" role="status" class="help"></p><div id="sync-diagnostic"></div><div class="dialog-actions"><button id="sync-close" class="secondary" type="button" data-action="close">Cancel</button><button id="sync-start" class="primary" type="submit">Sync Members</button></div>`,async f=>{
  if(syncRunning)return;syncRunning=true;
  const status=$('#sync-status'),start=$('#sync-start'),close=$('#sync-close'),pin=$('#sync-pin');
  const code=f.get('pin');pin.value='';pin.disabled=true;start.disabled=true;close.disabled=true;
  $('#sync-progress-wrap').hidden=false;$('#sync-diagnostic').textContent='';status.textContent='Confirming…';
  let displayed=0,target=0,animation;
  const showProgress=item=>{target=Math.max(target,Math.min(100,item.percent));$('#sync-step').textContent=item.label;cancelAnimationFrame(animation);const tick=()=>{if(displayed<target){displayed++;$('#sync-percent').textContent=displayed+'%';$('#sync-progress').value=displayed;animation=requestAnimationFrame(tick);}};tick();};
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),155000);
  try{
   const response=await fetch('/api/sync-members/',{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'sync',pin:code}),cache:'no-store',redirect:'error'});
   if(!response.ok){let error;try{error=await response.json();}catch{}if(response.status===401){signedIn=false;loaded=false;render();}throw Error(error?.message||'The sync could not be started.');}
   if(!response.body)throw Error('The progress connection is unavailable.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result;
   const receive=line=>{if(!line.trim())return;const item=JSON.parse(line);if(item.type==='progress'){status.textContent='Syncing members…';showProgress(item);}if(item.type==='error')throw Error(item.message);if(item.type==='complete')result=item.result;};
   while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let split;while((split=pending.indexOf('\n'))!==-1){receive(pending.slice(0,split));pending=pending.slice(split+1);}}
   pending+=decoder.decode();if(pending.trim())receive(pending);
   if(!result)throw Error('The connection ended before the sync result was confirmed. Refresh Contacts before trying again.');
   // 100% is reserved for the server's confirmed database commit.
   cancelAnimationFrame(animation);displayed=100;$('#sync-progress').value=100;$('#sync-percent').textContent='100%';$('#sync-step').textContent='Sync complete';
   await loadData();
   status.textContent=`${result.unchanged?'Membership unchanged.':'Sync completed.'} ${result.accounts} accounts, ${result.members} member accounts, ${result.staff} staff accounts. No emails sent.${loaded?'':' Use Refresh to reload the saved records.'}`;
   if(result.unmappedRows){const panel=$('#sync-diagnostic');for(const item of result.unmappedClasses||[]){const line=document.createElement('p');line.className='help';line.textContent=`Unrecognised class: ${item.label} (${item.rows} rows)`;panel.append(line);}}
   start.hidden=true;pin.hidden=true;$('label[for="sync-pin"]').hidden=true;close.textContent='Close';
  }catch(error){status.textContent=error.name==='AbortError'?'The sync result has not returned yet. Refresh Contacts before trying again.':error.message||'The sync could not be completed.';$('#sync-step').textContent='Sync stopped';}
  finally{clearTimeout(timeout);cancelAnimationFrame(animation);syncRunning=false;pin.disabled=false;start.disabled=false;close.disabled=false;}
 });
});
