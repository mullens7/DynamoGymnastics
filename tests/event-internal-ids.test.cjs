const {test}=require('node:test'),assert=require('node:assert/strict');
const {adminEvents}=require('../server/event-internal-ids.cjs');
test('management gets permanent parent and individual activity references',()=>{
 const result=adminEvents([{id:'parent',internal_id:'A1B2',details:{name:'Fun Sessions',sessions:[{id:'child',label:'Morning'}]}},{id:'child',internal_id:'G6J3',details:{parentId:'parent'}}]);
 assert.equal(result.length,1);assert.equal(result[0].internalId,'A1B2');assert.equal(result[0].sessions[0].internalId,'G6J3');
});
test('legacy single-session events retain their reference',()=>{assert.equal(adminEvents([{id:'one',internal_id:'X9Y8',details:{name:'Single'}}])[0].internalId,'X9Y8');});
