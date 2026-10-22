const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/join-the-waiting-list/rules.js');
const base={status:'Published',location:'Hamble',day:'Tuesday',start:'16:00',end:'17:00'};
const records=[{...base,id:'g',category:'Gyminis',ageMode:'school',maxAgeYears:6,maxAgeMonths:11},{...base,id:'r',category:'Recreational',ageMode:'age',minAgeYears:7,minAgeMonths:0},{...base,id:'other',location:'West End',category:'Gyminis',ageMode:'school',maxAgeYears:6,maxAgeMonths:11}];
const date='2026-10-22',children=[{first:'Test',last:'Child',dob:'2021-06-01',classes:['g']},{first:'Test',last:'Sibling',dob:'2017-06-01',classes:['r']}];
test('waiting list uses reception intake, exact seventh birthday and published age rules',()=>{
 assert.deepEqual(R.eligible(records,'2021-06-01',date).map(c=>c.id),['g']);assert.deepEqual(R.eligible(records,'2019-10-22',date).map(c=>c.id),['r']);assert.equal(R.eligible(records,'2023-10-22',date).length,0);
});
test('siblings match location, day and full time interval across categories',()=>{const shared=R.crossover(records,children,date);assert.equal(shared.length,1);assert.equal(shared[0].location,'Hamble');assert.deepEqual(shared[0].classes.map(c=>c[0].id),['g','r']);assert.equal(R.crossover(records.map(c=>c.id==='r'?{...c,end:'17:15'}:c),children,date).length,0);});
test('waiting list rejects forged, age-ineligible, missing and mismatched preferences',()=>{const input={parent:'Test Parent',email:'test@example.invalid',children,together:true};assert.equal(R.validate(input,records,date).children.length,2);for(const ids of [[],['r'],['deleted'],['g','g']])assert.throws(()=>R.validate({...input,children:[{...children[0],classes:ids}]},records,date));assert.throws(()=>R.validate({...input,children:[{...children[0],classes:['other']},children[1]]},records,date));});
test('preview handler validates server-side without sheet or email writes and rejects cross-origin',async()=>{
 const {makeWaitingListHandler}=require('../server/waiting-list.cjs');const handler=makeWaitingListHandler({VERCEL_ENV:'preview'},{schedule:async()=>records});const res=()=>({setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
 const a=res();await handler({method:'POST',headers:{origin:'https://preview.example',host:'preview.example'},body:{parent:'Test Parent',email:'test@example.invalid',children}},a);assert.equal(a.code,200);assert.equal(a.body.preview,true);assert.match(a.body.confirmation,/Test Child/);
 const b=res();await handler({method:'POST',headers:{origin:'https://wrong.example',host:'preview.example'},body:{}},b);assert.equal(b.code,403);
});
test('compact preferences distinguish all sessions, whole days and individual times in weekday order',()=>{
 const sessions=[{id:'t4',day:'Tuesday',start:'16:00',end:'17:00'},{id:'t5',day:'Tuesday',start:'17:00',end:'18:00'},{id:'w5',day:'Wednesday',start:'17:00',end:'18:00'},{id:'w6',day:'Wednesday',start:'18:00',end:'19:00'},{id:'s930',day:'Saturday',start:'09:30',end:'10:30'}];
 assert.equal(R.preference([...sessions].reverse(),sessions),'Any');
 assert.equal(R.preference(sessions.slice(0,4),sessions),'Tues, Weds');
 assert.equal(R.preference([sessions[2],sessions[0]],sessions),'Tues 4pm, Weds 5pm');
 assert.equal(R.preference([sessions[0],sessions[1],sessions[2]],sessions),'Tues, Weds 5pm');
 assert.equal(R.preference([sessions[4]],sessions),'Sat');
 assert.equal(R.preference([sessions[4]],[...sessions,{id:'s1030',day:'Saturday',start:'10:30',end:'11:30'}]),'Sat 9:30am');
});
test('compact preference is calculated from all eligible Hamble classes, excluding West End',()=>{
 const value=R.validate({parent:'Test Parent',email:'test@example.invalid',children:[children[0]]},records,date);
 assert.equal(value.children[0].preference,'Any');
});
