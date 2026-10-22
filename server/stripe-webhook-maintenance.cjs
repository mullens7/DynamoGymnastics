const {stripe}=require('./stripe-payments.cjs');
const ENDPOINT='we_1UQTDM3sIEuSW71hDzhHqXBB';
const OLD='https://dynamo-gymnastics.vercel.app/api/stripe-webhook/';
const URL='https://dynamogymnastics.co.uk/api/stripe-webhook/';
// Intentionally accepts no endpoint or URL from the caller. Update the existing
// platform endpoint, retaining its signing secret, event subscriptions and status.
async function repair(env,client=stripe(env)){
 if(env.STRIPE_CONNECTED_ACCOUNT_ID!=='acct_1UQ6B6KQHXgZnl4d')throw Error('ACCOUNT_MISMATCH');
 const endpoint=await client.webhookEndpoints.retrieve(ENDPOINT);
 if(endpoint.id!==ENDPOINT||endpoint.status!=='enabled'||![OLD,URL].includes(endpoint.url))throw Error('ENDPOINT_MISMATCH');
 const unchanged=endpoint.url===URL;
 const updated=unchanged?endpoint:await client.webhookEndpoints.update(ENDPOINT,{url:URL});
 if(updated.id!==ENDPOINT||updated.url!==URL||updated.status!=='enabled')throw Error('WEBHOOK_UPDATE_FAILED');
 return {ok:true,url:URL,enabled:true,unchanged};
}
module.exports={repair};
