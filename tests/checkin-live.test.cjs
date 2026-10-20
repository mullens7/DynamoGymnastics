const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){const ctx={setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/manage/checkin-live.js','utf8'),ctx);return ctx;}
test('visible check-in refreshes every two seconds and immediately on wake, without overlapping requests',async()=>{
 const ctx=fixture(),timers=new Map(),calls=[],applied=[];let active=true,resolve;
 const live=ctx.createCheckInLive({isActive:()=>active,fetchLatest:()=>{calls.push(1);return new Promise(r=>resolve=r);},applyLatest:v=>applied.push(v),onError:e=>{throw e;},schedule:(fn,delay)=>{timers.set(fn,delay);return fn;},cancel:id=>timers.delete(id)});
 const first=live.wake();assert.equal(calls.length,1);await live.wake();assert.equal(calls.length,1);
 resolve('visible');await first;assert.deepEqual(applied,['visible']);assert.equal([...timers.values()][0],0);
 const next=[...timers.keys()][0]();assert.equal(calls.length,2);resolve('hidden');await next;assert.deepEqual(applied,['visible','hidden']);assert.equal([...timers.values()][0],2000);
 active=false;live.pause();assert.equal(timers.size,0);await live.wake();assert.equal(calls.length,2);
});
test('check-in discards late responses after leaving the page, and reports failures while retrying',async()=>{
 const ctx=fixture(),applied=[],errors=[],timers=[];let active=true,resolve,reject;
 const live=ctx.createCheckInLive({isActive:()=>active,fetchLatest:()=>new Promise((a,b)=>{resolve=a;reject=b;}),applyLatest:v=>applied.push(v),onError:e=>errors.push(e.message),schedule:(fn,delay)=>{timers.push({fn,delay});return fn;},cancel:()=>{}});
 const first=live.wake();active=false;live.pause();resolve('stale');await first;assert.deepEqual(applied,[]);assert.equal(timers.length,0);
 active=true;const second=live.wake();reject(Error('offline'));await second;assert.deepEqual(errors,['offline']);assert.equal(timers[0].delay,2000);
});
test('live updates preserve expanded details and search position without rendering unchanged records',()=>{
 const ctx=fixture();let renderCount=0,opened=false,focused=false,selection;
 const records=[{id:'booking',responses:[{id:'phone',value:'07123'}]}];
 Object.assign(ctx,{loadFailures:{},data:{attendees:[],checkinSessions:[]},renderAttendees:()=>renderCount++,document:{activeElement:{id:'attendee-search',selectionStart:2,selectionEnd:4},querySelectorAll:selector=>selector.includes('[open]')?[{dataset:{bookingDetails:'booking'}}]:[{dataset:{bookingDetails:'booking'},set open(v){opened=v;}}]},window:{scrollY:100,scrollTo:(x,y)=>assert.equal(y,100)},$:()=>({focus:()=>focused=true,setSelectionRange:(...s)=>selection=s})});
 ctx.updateLiveCheckIn({records,sessions:[]});assert.equal(renderCount,1);assert.equal(opened,true);assert.equal(focused,true);assert.deepEqual(selection,[2,4]);
 ctx.updateLiveCheckIn({records,sessions:[]});assert.equal(renderCount,1);
 ctx.updateLiveCheckIn({records:[{id:'booking',responses:[]}],sessions:[]});assert.equal(renderCount,2);assert.equal(ctx.data.attendees[0].responses.length,0);
});
