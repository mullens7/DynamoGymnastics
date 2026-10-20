function readCheckInDetails(form,fields,bookingId){
 const answers={};
 for(const field of fields){const key='answer:'+bookingId+':'+field.id;const value=field.type==='multiselect'?form.getAll(key):field.type==='acknowledgement'?form.has(key):String(form.get(key)||'').trim();
  if(value===false||value===''||Array.isArray(value)&&!value.length)throw Error('Complete '+field.label+'.');answers[field.id]=value;
 }
 return answers;
}
function openCheckInDetails(result,request,afterSaved){
 stopTicketScanner();const fields=result.fields||[],id=result.bookingId;
 modal('<h2>Complete check-in details</h2><p>'+esc(result.gymnastName||'This gymnast')+' — complete the missing information before checking in.</p>'+questionInputs({id},fields)+(result.needsMedical?medicalInputs({id,medical_details:null}):'')+'<p id="checkin-details-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" class="primary">Save & check in</button></div>',async form=>{
  const button=$('#dialog-form button[type="submit"]');button.disabled=true;
  try{const answers=readCheckInDetails(form,fields,id),updated=await api('/api/admin-records/?kind=attendees',{method:'POST',body:JSON.stringify({...request,answers,...(result.needsMedical?{medicalNone:form.has('medicalNone:'+id),medicalDetails:String(form.get('medical:'+id)||'').trim()}:{})})});
   if(updated.needsDetails){openCheckInDetails(updated,request,afterSaved);$('#checkin-details-error').textContent='The event’s requested information has changed. Please complete the remaining fields.';return;}
   $('#dialog').close();await loadData();window.notifyCheckInChanged?.();toast('Checked in.');afterSaved?.(updated);
  }catch(error){$('#checkin-details-error').textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}
 });
 wireBookingInputs();
}
let checkInActionBusy=false;
async function checkInParticipant(button){
 if(checkInActionBusy)return;checkInActionBusy=true;button.disabled=true;const request={bookingId:button.dataset.checkin,eventId:attendeeEvent,checked:button.dataset.checked!=='true'};
 try{const result=await api('/api/admin-records/?kind=attendees',{method:'POST',body:JSON.stringify(request)});
  if(result.needsDetails){openCheckInDetails(result,request);return;}
  await loadData();window.notifyCheckInChanged?.();toast('Check-in updated.');
 }catch(error){toast(error.message);}finally{checkInActionBusy=false;if(button.isConnected)button.disabled=false;}
}
