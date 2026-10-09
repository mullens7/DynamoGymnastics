/* Test connection only. Credentials stay in server environment variables. */
let syncTestRunning=false;
document.querySelector('.sync-member').addEventListener('click',()=>{
 if(syncTestRunning){toast('An export test is already running.');return;}
 modal(`<h2>Test automatic export</h2><p>Log in to Thrive4 and download Dynamo’s Contacts export through Browserless.</p><p class="help">This tests the connection only. It does not update membership records or save the downloaded file.</p><details><summary>First-time setup</summary><p class="help">Create a free Browserless account. In Vercel’s Dynamo project, add server-only secrets: BROWSERLESS_TOKEN, THRIVE_EMAIL, THRIVE_PASSWORD and SYNC_TEST_KEY. Use a random test key of at least 32 characters, then redeploy. Never enter your Thrive4 password here.</p></details><label for="sync-key">Administrator test key</label><input id="sync-key" name="testKey" type="password" required minlength="32" maxlength="512" autocomplete="off"><p id="sync-status" role="status" class="help">Ready for a connection test once server configuration is complete.</p><div class="dialog-actions"><button class="secondary" type="button" data-action="close">Close</button><button id="sync-start" class="primary" type="submit">Test login and download</button></div>`,async f=>{
  if(syncTestRunning)return;syncTestRunning=true;
  const status=document.querySelector('#sync-status'),start=document.querySelector('#sync-start');
  start.disabled=true;status.textContent='Logging in and preparing the export… This can take up to two minutes.';
  const testKey=f.get('testKey');document.querySelector('#sync-key').value='';
  try{
   const response=await fetch('/api/sync-members/',{method:'POST',headers:{Authorization:'Bearer '+testKey,'Content-Type':'application/json'},body:'{}',cache:'no-store',redirect:'error'});
   let result;try{result=await response.json()}catch{throw new Error('The export service could not be reached. Check that the latest Vercel deployment has finished.');}
   if(!response.ok)throw new Error(result.message||'The connection test failed.');
   status.textContent=`Download test completed: ${result.format.toUpperCase()}, ${Math.ceil(result.bytes/1024)} KB, ${(result.elapsedMs/1000).toFixed(1)} seconds. Membership records were not changed.`;
  }catch(error){status.textContent=error.message||'The export test could not be completed.';}
  finally{syncTestRunning=false;start.disabled=false;}
 });
});
