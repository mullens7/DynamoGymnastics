/* Test connection only. Credentials stay in server environment variables. */
let syncTestRunning=false;
document.querySelector('.sync-member').addEventListener('click',()=>{
 if(syncTestRunning){toast('An export test is already running.');return;}
 modal(`<h2>Sync Members</h2><p>Update membership from Thrive4’s Contacts export.</p><p class="help">No emails are sent. Existing accounts, purchases and transaction history are retained. Former members keep their account with non-member access.</p><details><summary>First-time setup</summary><p class="help">Create a free Browserless account. In Vercel’s Dynamo project, add server-only secrets: BROWSERLESS_TOKEN, THRIVE_EMAIL, THRIVE_PASSWORD and SYNC_TEST_KEY. Use a random test key of at least 32 characters, then redeploy. Never enter your Thrive4 password here.</p></details><label for="sync-mode">Action</label><select id="sync-mode" name="mode"><option value="sync">Sync membership records</option><option value="inspect">Check export columns (no changes)</option><option value="test">Test login and download (no changes)</option></select><label for="sync-key">Administrator test key</label><input id="sync-key" name="testKey" type="password" required minlength="32" maxlength="512" autocomplete="off"><p id="sync-status" role="status" class="help">Ready for a connection test once server configuration is complete.</p><div id="sync-diagnostic"></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close">Close</button><button id="sync-start" class="primary" type="submit">Run selected action</button></div>`,async f=>{
  if(syncTestRunning)return;syncTestRunning=true;
  const status=document.querySelector('#sync-status'),start=document.querySelector('#sync-start');
  const mode=f.get('mode');document.querySelector('#sync-diagnostic').textContent='';
  start.disabled=true;status.textContent=mode==='sync'?'Syncing members… No emails will be sent.':'Logging in and checking the export… No records will be changed.';
  const testKey=f.get('testKey');document.querySelector('#sync-key').value='';
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),145000);
  try{
   const response=await fetch('/api/sync-members/',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+testKey,'Content-Type':'application/json'},body:JSON.stringify({mode}),cache:'no-store',redirect:'error'});
   let result;try{result=await response.json()}catch{throw new Error('The export service could not be reached. Check that the latest Vercel deployment has finished.');}
   if(!response.ok&&result.diagnostic){
    const panel=document.querySelector('#sync-diagnostic');panel.textContent='';
    const note=document.createElement('p');note.className='help';note.textContent='Export control: '+result.diagnostic.reason+'.';panel.append(note);
    if(result.diagnostic.image){const detail=document.createElement('details');const label=document.createElement('summary');label.textContent='Show masked Thrive4 page';detail.append(label);const img=document.createElement('img');img.alt='Thrive4 export page with contact rows masked';img.style.width='100%';img.src='data:image/jpeg;base64,'+result.diagnostic.image;detail.append(img);panel.append(detail);}
   }
   if(!response.ok)throw new Error((result.message||'The connection test failed.')+(result.stage?' Step: '+result.stage+'.':''));
   if(mode==='sync'){
    try{
     const contactResponse=await fetch('/api/member-contacts/',{headers:{Authorization:'Bearer '+testKey},cache:'no-store',redirect:'error'});
     if(!contactResponse.ok)throw new Error('Contacts unavailable');const contacts=await contactResponse.json();
     data.contacts=contacts.accounts.map(a=>({id:a.id,name:a.owner_name||a.email,email:a.email,member:a.roster_member,staff:a.roster_staff,membership:a.roster_member?'Active member':'Non-member',account:'Active',review:[],gymnasts:a.dynamo_gymnasts.map(g=>({id:g.id,name:g.first_name+' '+g.last_name,active:g.active,groups:g.groups,dateOfBirth:g.date_of_birth,bgNumber:g.bg_number})),gymnast:a.dynamo_gymnasts.map(g=>g.first_name+' '+g.last_name).join(', ')||'No linked gymnast'}));
     window.dynamoLiveContacts=true;render();
    }catch{status.textContent='Sync completed, but Contacts could not be refreshed. No emails were sent.';return;}
    status.textContent=`${result.unchanged?'Export unchanged.':'Sync completed.'} ${result.accounts} accounts, ${result.members} member accounts, ${result.staff} staff accounts. History retained. No emails sent.`;return;}
   if(mode==='inspect'){status.textContent=`Export checked: ${result.rowCount} rows. No records changed or emails sent.`;const panel=document.querySelector('#sync-diagnostic');const columns=document.createElement('p');columns.className='help';columns.textContent='Export columns: '+result.columns.join(' · ');panel.append(columns);return;}
   status.textContent=`Download test completed: ${result.format.toUpperCase()}, ${Math.ceil(result.bytes/1024)} KB, ${(result.elapsedMs/1000).toFixed(1)} seconds. Membership records were not changed.`;
  }catch(error){status.textContent=error.name==='AbortError'?'The server did not return a result within the test time limit. Please close this panel and contact the administrator.':error.message||'The export test could not be completed.';}
  finally{clearTimeout(timeout);syncTestRunning=false;start.disabled=false;}
 });
});
