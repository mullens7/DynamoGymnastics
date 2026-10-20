const {test}=require('node:test'),assert=require('node:assert/strict'),{validateFields,medicalValue}=require('../server/booking-fields.cjs');
test('custom field schemas reject ambiguous options and force acknowledgement confirmation',()=>{const field={id:'shirt',label:'T-shirt size',type:'dropdown',required:true,options:['S','M','L']};assert.deepEqual(validateFields([field]),[field]);for(const f of [{...field,options:[]},{...field,options:['S','S']},{...field,type:'unknown'}])assert.throws(()=>validateFields([f]));assert.throws(()=>validateFields([field,field]));assert.equal(validateFields([{id:'terms',label:'I confirm',type:'acknowledgement',required:false,options:[]}])[0].required,true);});
test('medical profile answers distinguish unknown from explicit None',()=>{assert.throws(()=>medicalValue({medicalDetails:''}));assert.equal(medicalValue({medicalNone:true}),'None');assert.equal(medicalValue({medicalDetails:'  Asthma  '}),'Asthma');assert.throws(()=>medicalValue({medicalDetails:'x'.repeat(5001)}));});
const vm=require('node:vm'),fs=require('node:fs');
test('booking controls require consent and medical information, while explicit None is reusable',()=>{const ctx={esc:x=>String(x??''),document:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/book/booking-inputs.js','utf8'),ctx);const g={id:'child',first_name:'Child',medical_details:null};assert.match(ctx.medicalInputs(g),/required/);assert.match(ctx.medicalInputs(g),/None — no medical/);assert.doesNotMatch(ctx.medicalInputs({...g,medical_details:'None'}),/<textarea/);const fields=[{id:'terms',label:'Parent led',type:'acknowledgement',required:true,options:[]},{id:'shirt',label:'Shirt',type:'multiselect',required:true,options:['S','M']}];assert.match(ctx.questionInputs(g,fields),/name="answer:child:terms" required/);const values=new Map([['answer:child:shirt',['S']],['medical:child','Asthma']]);const form={has:n=>values.has(n),get:n=>values.get(n),getAll:n=>values.get(n)||[]};assert.throws(()=>ctx.bookingAnswers(form,g,fields));values.set('answer:child:terms',true);const result=ctx.bookingAnswers(form,g,fields);assert.equal(result.answers.terms,true);assert.equal(result.answers.shirt[0],'S');assert.equal(result.medicalDetails,'Asthma');});

test('visibility is a validated opt-in and legacy fields remain compatible',()=>{
 const base={id:'phone',label:'Emergency telephone',type:'phone',required:true,options:[]};
 assert.deepEqual(validateFields([base]),[base]);
 for(const checkInVisible of [true,false])assert.equal(validateFields([{...base,checkInVisible}])[0].checkInVisible,checkInVisible);
 for(const checkInVisible of ['true',1,null])assert.throws(()=>validateFields([{...base,checkInVisible}]));
});
test('check-in renders approved answers and medical information as escaped text',()=>{
 const ctx={esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/manage/staff.js','utf8'),ctx);
 const html=ctx.checkInBookingDetails({medicalDetails:'<script>medical</script>',responses:[{label:'Shirt',value:['S','M']},{label:'Parent led',value:true},{label:'Notes',value:'<img src=x>'}]});
 assert.doesNotMatch(html,/<script>|<img /);assert.match(html,/&lt;script&gt;/);assert.match(html,/S, M/);assert.match(html,/Confirmed/);
 assert.match(ctx.checkInBookingDetails({responses:[]}),/Not recorded/);
});

test('check-in distinguishes an uncollected question from an unanswered optional question',()=>{
 const ctx={esc:x=>String(x??'')};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/manage/staff.js','utf8'),ctx);
 const html=ctx.checkInBookingDetails({responses:[{label:'Emergency telephone',value:null,notCollected:true},{label:'Optional notes',value:null}]});
 assert.match(html,/Emergency telephone<\/dt><dd>Not collected when this booking was made/);
 assert.match(html,/Optional notes<\/dt><dd>Not provided/);
});
