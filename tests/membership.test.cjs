const {test}=require('node:test');const assert=require('node:assert/strict');const m=require('../public/manage/membership.js');
test('supplied classes and overrides',()=>{
 const examples=[['Wednesday 7.00-9.00, Girls Advanced Recreational','advanced'],['Wednesday 4.00-5.00, Gymini','gymini'],['Saturday 10.30-11.30, Recreational','recreational'],['MA Development 5 Hours','mens_development'],['WA Mini Club A 9 Hours','womens_squad'],['WA Development 4 Hours','womens_development'],['MA Junior 9 Hours','mens_squad']];
 for(const [text,id] of examples)assert.deepEqual(m.classify(text).groups,[id]);
 for(const text of ['Junior Coach','Senior Coach','General Manager and Club Welfare Officer','Director'])assert.deepEqual(m.classify(text),{groups:[],staff:true,review:[]});
});
test('exact tokens, casing, separate classes, Dev remains regular squad',()=>{
 assert.deepEqual(m.classify('Manager, Gymnasium, Water').groups,[]);
 assert.deepEqual(m.classify('wa development, MA Senior 12 Hours').groups,['womens_development','mens_squad']);
 assert.deepEqual(m.classify('Gymini; Boys Advanced Recreational; Recreational').groups,['gymini','advanced','recreational']);
 assert.deepEqual(m.classify('WA Dev Comp 9 Hours'),{groups:['womens_squad'],staff:false,review:[]});
 assert.deepEqual(m.classify('MA Dev 5 Hours').groups,['mens_squad']);
 assert.deepEqual(m.classify('WA Devon 9 Hours').groups,['womens_squad']);
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

test('class keywords determine membership despite accompanying time and label fragments',()=>{
 assert.deepEqual(m.classify('Wednesday, 7.00-9.00, Girls Advanced Recreational'),{groups:['advanced'],staff:false,review:[]});
 assert.deepEqual(m.classify('09:00-10:00, Gymini, Summer session'),{groups:['gymini'],staff:false,review:[]});
 assert.deepEqual(m.classify('Club Welfare Officer, General Manager'),{groups:[],staff:true,review:[]});
 assert.equal(m.classify('Waiting list').groups.length,0);assert.equal(m.classify('Waiting list').staff,false);assert.equal(m.classify('Waiting list').review.length,1);
 assert.deepEqual(m.classify('MA Development, 5 Hours').groups,['mens_development']);
});

test('Gymtots is an active member group and available for event restrictions',()=>{
 for(const label of ['Saturday 9.45-10.25, Gymtots','Saturday 9.45-10.20, gymtots'])assert.deepEqual(m.classify(label),{groups:['gymtots'],staff:false,review:[]});
 assert.equal(m.groups.gymtots,'Gymtots');
 const account=m.accounts([{email:'parent@example.invalid',gymnastId:'gymtots-child',timeClass:'Gymtots',active:true}])[0];
 assert.equal(account.member,true);assert.equal(m.eligible({audience:'groups',allowedGroups:['gymtots']},account,'gymtots-child'),true);
});
test('Gymtots-only age rules classify every supplied class label with correct precedence',()=>{
 const cases=[
 ["Monday - West End Under 2's - 9.30 - 10.10am",'under_2_years'],
 ['Tuesday - West End Gymini 4-7 Years 4.00-4.45pm','gymini'],
 ['Friday - West End 2 Years - 10.20 - 11.00am','two_years'],
 ['Wednesday - Hamble 2 Years - 10.20-11.00am','two_years'],
 ['Friday - West End Gymini 4-7 Years - 4.00-4.45pm','gymini'],
 ['Friday - West End 2 Years - 10.20-11.00am','two_years'],
 ['Monday - West End Under 2 Years - 9.30-10.20am','under_2_years'],
 ['Tuesday - Hamble 2 Years - 10.20-11.00am','two_years'],
 ["Tuesday - Hamble Under 2's - 9.30-10.10am",'under_2_years'],
 ['Thursday - Hamble 3-4 Years - 11.20-12.00','three_to_four_years'],
 ["Saturday - West End Under 4's Fun Session- 9.30-10.10am",'under_4_years']];
 for(const [label,group] of cases)assert.deepEqual(m.classifyGymtots(label),{groups:[group],staff:false,review:[]},label);
 assert.deepEqual(m.classifyGymtots('Under 2 Years').groups,['under_2_years']);assert.deepEqual(m.classifyGymtots('3 – 4 years').groups,['three_to_four_years']);assert.deepEqual(m.classifyGymtots('4-7 Years').groups,['gymini']);assert.deepEqual(m.classifyGymtots('Under 4 Years').groups,['under_4_years']);
});
test('new Gymtots groups are selectable and support eligibility without altering Dynamo classification',()=>{
 const ids=['under_2_years','two_years','three_to_four_years','under_4_years'];for(const id of ids)assert.ok(Object.keys(m.groups).includes(id));assert.equal(Object.keys(m.groups).includes('gymtots'),false);
 assert.deepEqual(m.classify('Monday Under 2 Years').groups,[]);assert.deepEqual(m.classify('Gymtots').groups,['gymtots']);assert.deepEqual(m.classify('Boys Advanced Recreational').groups,['advanced']);
 for(const id of ids){const a={member:true,gymnasts:[{id:'child',active:true,groups:[id]}]};assert.equal(m.eligible({audience:'groups',allowedGroups:[id]},a,'child'),true);assert.equal(m.eligible({audience:'groups',allowedGroups:['gymini']},a,'child'),false);}
 assert.deepEqual(m.classifyGymtots('Under 2 Years, Junior Coach'),{groups:['under_2_years'],staff:true,review:[]});assert.deepEqual(m.classifyGymtots('Senior Coach'),{groups:[],staff:true,review:[]});assert.equal(m.classifyGymtots('Gymtots').groups.length,0);assert.equal(m.classifyGymtots('Waiting list').review.length,1);
});
