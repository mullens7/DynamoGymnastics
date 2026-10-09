let syncRunning=false;
document.querySelector('.sync-member').addEventListener('click',()=>{
 if(!signedIn){unlock();return;}
 if(syncRunning){toast('A member sync is already running.');return;}
 modal(`<h2>Sync Members</h2><p>Update membership from Thrive4’s Contacts export.</p><p class="help">No emails are sent. Existing accounts, purchases and transaction history are retained. Former members keep their account with non-member access.</p><p id="sync-status" role="status" class="help">Ready to sync.</p><div id="sync-diagnostic"></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close">Close</button><button id="sync-start" class="primary" type="submit">Sync Members</button></div>`,async()=>{
  if(syncRunning)return;syncRunning=true;
  const status=$('#sync-status'),start=$('#sync-start');$('#sync-diagnostic').textContent='';
  start.disabled=true;status.textContent='Syncing members… This can take up to two minutes.';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),145000);
  try{
   const result=await api('/api/sync-members/',{method:'POST',signal:controller.signal,body:JSON.stringify({mode:'sync'})});
   await loadData();
   status.textContent=`${result.unchanged?'Membership unchanged.':'Sync completed.'} ${result.accounts} accounts, ${result.members} member accounts, ${result.staff} staff accounts. History retained. No emails sent.${loaded?'':' The sync succeeded, but records could not be refreshed. Use Refresh to reload them.'}`;
   if(result.unmappedRows){const panel=$('#sync-diagnostic'),note=document.createElement('p');note.className='help';note.textContent=`${result.unmappedRows} contacts have no recognised class or staff role. Unrecognised labels:`;panel.append(note);for(const item of result.unmappedClasses||[]){const line=document.createElement('p');line.className='help';line.textContent=`${item.label} (${item.rows} rows)`;panel.append(line);}}
  }catch(error){status.textContent=error.name==='AbortError'?'The sync has not returned a result yet. Refresh Contacts to check the saved records before trying again.':error.message||'The sync could not be completed.';}
  finally{clearTimeout(timeout);syncRunning=false;start.disabled=false;}
 });
});
