// Only the visible check-in screen polls. No overlapping requests or full management reloads.
function createCheckInLive({isActive,fetchLatest,applyLatest,onError,schedule=setTimeout,cancel=clearTimeout,interval=2000}){
 let timer=null,running=false,queued=false;
 function pause(){if(timer!==null)cancel(timer);timer=null;queued=false;}
 async function refresh(){
  pause();if(!isActive())return;if(running){queued=true;return;}running=true;
  try{const result=await fetchLatest();if(isActive())applyLatest(result);}
  catch(error){if(isActive())onError(error);}
  finally{running=false;if(isActive()){const delay=queued?0:interval;queued=false;timer=schedule(refresh,delay);}}
 }
 return {wake:refresh,pause};
}
function updateLiveCheckIn(result){
 const changed=loadFailures.attendees||JSON.stringify([data.attendees,data.checkinSessions])!==JSON.stringify([result.records,result.sessions||[]]);
 data.attendees=result.records;data.checkinSessions=result.sessions||[];delete loadFailures.attendees;
 if(!changed)return;
 const expanded=new Set([...document.querySelectorAll('[data-booking-details][open]')].map(n=>n.dataset.bookingDetails));
 const focus=document.activeElement,searchFocused=focus?.id==='attendee-search',selection=searchFocused?[focus.selectionStart,focus.selectionEnd]:null;
 const scroll=window.scrollY;
 renderAttendees();
 document.querySelectorAll('[data-booking-details]').forEach(n=>n.open=expanded.has(n.dataset.bookingDetails));
 if(searchFocused&&$('#attendee-search')){$('#attendee-search').focus({preventScroll:true});$('#attendee-search').setSelectionRange(...selection);}
 window.scrollTo(0,scroll);
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 window.dynamoCheckInLive=createCheckInLive({
  isActive:()=>signedIn&&loaded&&!loading&&tab==='attendees'&&can('attendees.checkin')&&!document.hidden,
  fetchLatest:()=>api('/api/admin-records/?kind=attendees',{signal:AbortSignal.timeout(12000)}),
  applyLatest:updateLiveCheckIn,
  onError:error=>{data.attendees=[];loadFailures.attendees=error.status===403?'Your role no longer allows event check-in.':'Live check-in could not update. Reconnecting automatically…';render();}
 });
 let channel;
 try{if('BroadcastChannel' in window){channel=new BroadcastChannel('dynamo-checkin');channel.onmessage=()=>window.dynamoCheckInLive.wake();}}catch{}
 window.notifyCheckInChanged=()=>{window.dynamoCheckInLive.wake();channel?.postMessage('changed');};
 window.addEventListener('focus',()=>window.dynamoCheckInLive.wake());
 window.addEventListener('online',()=>window.dynamoCheckInLive.wake());
 window.addEventListener('pageshow',()=>window.dynamoCheckInLive.wake());
 document.addEventListener('visibilitychange',()=>{if(document.hidden)window.dynamoCheckInLive.pause();else window.dynamoCheckInLive.wake();});
 window.dynamoCheckInLive.wake();
}
