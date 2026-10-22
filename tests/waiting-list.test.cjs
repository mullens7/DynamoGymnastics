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
