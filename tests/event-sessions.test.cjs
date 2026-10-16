const {test}=require('node:test'),assert=require('node:assert/strict');const {validateEvent,slugify}=require('../server/event-model.cjs'),{eligible}=require('../public/manage/membership.js');
const input=()=>({name:'Trampoline Takeoff',status:'Published',audience:'everyone',allowedGroups:[],memberPriceCents:500,nonMemberPriceCents:700,sessions:[{date:'2027-11-01',time:'10:00',capacity:20,label:'Under 9s',minAge:0,maxAge:8}]});
test('event URLs default from titles and custom slugs are strictly constrained',()=>{assert.equal(validateEvent(input()).slug,'trampoline-takeoff');assert.equal(validateEvent({...input(),slug:'novice'}).slug,'novice');for(const slug of ['../admin','a/b','Hello World',''])assert.throws(()=>validateEvent({...input(),slug}));assert.equal(slugify('Novice Festival 2027'),'novice-festival-2027');});
test('sessions have independent valid dates, age ranges, capacities and stable IDs',()=>{const v=validateEvent(input());assert.match(v.sessions[0].id,/^[a-f0-9-]{36}$/);assert.equal(validateEvent({...input(),sessions:v.sessions}).sessions[0].id,v.sessions[0].id);for(const s of [{date:'2027-02-30'},{minAge:9,maxAge:8},{capacity:0},{time:'25:00'}])assert.throws(()=>validateEvent({...input(),sessions:[{...input().sessions[0],...s}]}));});
test('age on the session date controls each gymnast, including birthday boundaries and unknown DOB',()=>{const gymnasts=[{id:'seven',date_of_birth:'2020-11-02'},{id:'eleven',date_of_birth:'2016-01-01'},{id:'unknown'}];const event={audience:'everyone',date:'2027-11-01',maxAge:8};assert.equal(eligible(event,{gymnasts},'seven'),true);assert.equal(eligible(event,{gymnasts},'eleven'),false);assert.equal(eligible(event,{gymnasts},'unknown'),false);assert.equal(eligible({...event,maxAge:11},{gymnasts},'eleven'),true);assert.equal(eligible({...event,date:'2029-11-02'},{gymnasts},'seven'),false);});
test('direct event links are opt-in and cannot claim existing website routes',()=>{
 assert.equal(validateEvent(input()).rootLink,false);
 assert.equal(validateEvent({...input(),slug:'novice',rootLink:true}).rootLink,true);
 for(const slug of ['auth','manage','account','book','staff','awards','results','gallery','classes','parties','contact-us','terms','policies','api','assets'])assert.throws(()=>validateEvent({...input(),slug,rootLink:true}),/reserved/);
 assert.equal(validateEvent({...input(),slug:'classes',rootLink:false}).slug,'classes');
});
test('event sessions support date-only, start-only and start/end timing without inventing a time',()=>{
 const make=session=>validateEvent({...input(),sessions:[{...input().sessions[0],...session}]}).sessions[0];
 assert.equal(make({time:'',endTime:''}).time,'');
 assert.equal(make({time:undefined}).time,'');
 assert.equal(make({time:'09:30'}).endTime,'');
 assert.equal(make({time:'09:30',endTime:'12:00'}).endTime,'12:00');
 for(const s of [{time:'',endTime:'12:00'},{time:'09:30',endTime:'09:30'},{time:'09:30',endTime:'08:00'},{time:'09:30',endTime:'25:00'}])assert.throws(()=>make(s));
});
