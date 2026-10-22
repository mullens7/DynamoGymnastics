const {test}=require('node:test');
const assert=require('node:assert/strict');
const {repair}=require('../server/stripe-webhook-maintenance.cjs');
const env={STRIPE_CONNECTED_ACCOUNT_ID:'acct_1UQ6B6KQHXgZnl4d'};
const id='we_1UQTDM3sIEuSW71hDzhHqXBB',url='https://dynamogymnastics.co.uk/api/stripe-webhook/';
test('webhook maintenance changes only the known endpoint URL and is idempotent',async()=>{
 let endpoint={id,status:'enabled',url:'https://dynamo-gymnastics.vercel.app/api/stripe-webhook/'},updates=0;
 const client={webhookEndpoints:{retrieve:async key=>{assert.equal(key,id);return endpoint;},update:async(key,params)=>{assert.equal(key,id);assert.deepEqual(params,{url});updates++;return endpoint={...endpoint,...params};}}};
 assert.equal((await repair(env,client)).unchanged,false);
 assert.equal((await repair(env,client)).unchanged,true);assert.equal(updates,1);
});
test('webhook maintenance refuses unrelated account or changed endpoint',async()=>{
 const client={webhookEndpoints:{retrieve:async()=>({id,status:'enabled',url:'https://other.example/'})}};
 await assert.rejects(repair({},client),/ACCOUNT_MISMATCH/);
 await assert.rejects(repair(env,client),/ENDPOINT_MISMATCH/);
});
