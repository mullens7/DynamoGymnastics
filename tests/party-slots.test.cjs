const {test}=require('node:test'),assert=require('node:assert/strict');
const {slots}=require('../server/party-slots.cjs');
const base={name:'Party',start:'2026-10-11',end:'2027-12-31',days:[0],times:['13:00'],guests:20,room:'Big gym',memberPriceCents:10000,nonMemberPriceCents:15000};
test('recurring slots include weekly Sundays through the end date with prices and room',()=>{const result=slots(base);assert.equal(result[0].date,'2026-10-11');assert.equal(result.at(-1).date,'2027-12-26');assert.equal(result.length,64);assert.equal(result.every(s=>new Date(s.date).getUTCDay()===0&&s.time==='13:00'&&s.status==='Pending'),true);assert.equal(result[0].memberPriceCents,10000);});
test('invalid ranges, empty weekdays, invalid times and excessive recurrence reject',()=>{for(const input of [{days:[]},{times:['25:00']},{end:'2020-01-01'},{end:'2030-01-01'},{start:'2026-02-30'}])assert.throws(()=>slots({...base,...input}));});
