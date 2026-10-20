const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function context(extra={}){const ctx={...extra};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/manage/checkin-details.js','utf8'),ctx);return ctx;}
test('check-in form collects each field type and rejects missing values',()=>{
 const ctx=context(),fields=[{id:'phone',label:'Emergency phone',type:'phone'},{id:'terms',label:'Parent led',type:'acknowledgement'},{id:'shirt',label:'Shirt',type:'multiselect'}];
 const values=new Map([['answer:booking:phone',' 07123456789 '],['answer:booking:terms',true],['answer:booking:shirt',['S','M']]]),form={get:k=>values.get(k),has:k=>values.has(k),getAll:k=>values.get(k)||[]};
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.readCheckInDetails(form,fields,'booking'))),{phone:'07123456789',terms:true,shirt:['S','M']});
 values.delete('answer:booking:phone');assert.throws(()=>ctx.readCheckInDetails(form,fields,'booking'),/Emergency phone/);
 values.set('answer:booking:phone','07123456789');values.set('answer:booking:shirt',[]);assert.throws(()=>ctx.readCheckInDetails(form,fields,'booking'),/Shirt/);
});
test('manual check-in opens collection when needed, without claiming attendance was saved',async()=>{
 const calls=[],ctx=context({attendeeEvent:'session',api:async(path,options)=>{calls.push(JSON.parse(options.body));return {needsDetails:true,bookingId:'booking',fields:[]};},loadData:async()=>{throw Error('Must not announce completion yet');},toast:()=>{throw Error('Must not announce completion yet');}});let opened;
 ctx.openCheckInDetails=(result,request)=>opened={result,request};const button={disabled:false,isConnected:true,dataset:{checkin:'booking',checked:'false'}};
 await ctx.checkInParticipant(button);assert.equal(opened.result.needsDetails,true);assert.equal(opened.request.eventId,'session');assert.equal(calls.length,1);assert.equal(button.disabled,false);
});
test('ticket scanner routes incomplete tickets to collection and stops the camera',async()=>{
 let opened,stopped=0,loaded=0;const ctx={attendeeEvent:'session',document:{getElementById:()=>({})},api:async()=>({needsDetails:true,bookingId:'booking',fields:[]}),loadData:async()=>loaded++,setTimeout:()=>{},toast:()=>{}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/manage/ticket-scanner.js','utf8'),ctx);ctx.stopTicketScanner=()=>stopped++;ctx.openCheckInDetails=(result,request)=>opened={result,request};
 await ctx.scanTicket('DYN-1234-ABCD');assert.equal(stopped,1);assert.equal(loaded,0);assert.equal(opened.request.eventId,'session');assert.equal(opened.request.ticketNumber,'DYN-1234-ABCD');
});
