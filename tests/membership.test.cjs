const {test}=require('node:test');const assert=require('node:assert/strict');const m=require('../public/manage/membership.js');
test('supplied classes and overrides',()=>{
 const examples=[['Wednesday 7.00-9.00, Girls Advanced Recreational','advanced'],['Wednesday 4.00-5.00, Gymini','gymini'],['Saturday 10.30-11.30, Recreational','recreational'],['MA Development 5 Hours','mens_development'],['WA Mini Club A 9 Hours','womens_squad'],['WA Development 4 Hours','womens_development'],['MA Junior 9 Hours','mens_squad']];
 for(const [text,id] of examples)assert.deepEqual(m.classify(text).groups,[id]);
 for(const text of ['Junior Coach','Senior Coach','General Manager and Club Welfare Officer','Director'])assert.deepEqual(m.classify(text),{groups:[],staff:true,review:[]});
});
test('exact tokens, casing, separate classes, abbreviation review',()=>{
 assert.deepEqual(m.classify('Manager, Gymnasium, Water').groups,[]);
 assert.deepEqual(m.classify('wa development, MA Senior 12 Hours').groups,['womens_development','mens_squad']);
 assert.deepEqual(m.classify('Gymini; Boys Advanced Recreational; Recreational').groups,['gymini','advanced','recreational']);
 assert.equal(m.classify('WA Dev Comp 9 Hours').review.length,1);
});
test('owner grouping, staff parent, staff only, inactive and missing IDs',()=>{
 const a=m.accounts([{email:' OWNER@example.invalid ',gymnastId:'1',name:'Child A',timeClass:'Girls Advanced Recreational, Junior Coach',active:true},{email:'owner@example.invalid',gymnastId:'2',name:'Child B',timeClass:'Gymini',active:true},{email:'staff@example.invalid',name:'Staff',timeClass:'Manager',active:true},{email:'inactive@example.invalid',gymnastId:'3',timeClass:'MA Senior',active:false},{email:'unknown@example.invalid',timeClass:'Gymini',active:true}]);
 assert.equal(a.length,4);assert.equal(a[0].staff,true);assert.equal(a[0].member,true);assert.equal(a[0].gymnasts.length,2);
 assert.equal(a[1].member,false);assert.equal(a[1].gymnasts.length,0);assert.equal(a[1].staff,true);
 assert.equal(a[2].member,false);assert.equal(a[3].member,false);
});
test('pricing and per-gymnast restrictions, no sibling privilege',()=>{
 const a=m.accounts([{email:'a',gymnastId:'1',timeClass:'Gymini',active:true},{email:'a',gymnastId:'2',timeClass:'MA Senior',active:true}])[0];
 const e={audience:'groups',allowedGroups:['mens_squad'],memberPriceCents:1000,nonMemberPriceCents:1500};
 assert.equal(m.quote(e,a,'1').eligible,false);assert.deepEqual(m.quote(e,a,'2'),{eligible:true,priceCents:1000});assert.equal(m.eligible(e,null,'2'),false);
 assert.deepEqual(m.quote({...e,audience:'everyone'},null),{eligible:true,priceCents:1500});
 assert.equal(m.eligible({...e,audience:'members'},a,'unknown'),false);
 assert.equal(m.cents('0'),0);assert.equal(m.cents('10.01'),1001);assert.throws(()=>m.cents('-1'));assert.throws(()=>m.cents('1.001'));
 assert.equal(m.quote({...e,memberPriceCents:1500},a,'2').priceCents,1500);
});
