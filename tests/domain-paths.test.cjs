const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/domain-routes.js','utf8');
function run(href,links=[]){let redirected;const url=new URL(href),anchors=links.map(h=>({getAttribute:()=>h,href:h}));const context={URL,location:{href,hostname:url.hostname,origin:url.origin,replace:v=>redirected=v},document:{body:{},querySelectorAll:()=>anchors,addEventListener(){}},MutationObserver:class{observe(){}}};vm.runInNewContext(source,context);return {redirected,links:anchors.map(a=>a.href)};}
test('legacy portal hosts redirect to the main domain and preserve destination details',()=>{
 assert.equal(run('https://auth.dynamogymnastics.co.uk/?next=%2Fbook%2F').redirected,'https://dynamogymnastics.co.uk/auth/?next=%2Fbook%2F');
 assert.equal(run('https://manage.dynamogymnastics.co.uk/').redirected,'https://dynamogymnastics.co.uk/manage/');
 assert.equal(run('https://manage.dynamogymnastics.co.uk/manage/party-print/?booking=fixture#print').redirected,'https://dynamogymnastics.co.uk/manage/party-print/?booking=fixture#print');
});
test('main-domain portal navigation stays on the main domain; external links stay untouched',()=>{
 const r=run('https://dynamogymnastics.co.uk/manage/', ['/auth/?next=%2Fmanage%2F','https://manage.dynamogymnastics.co.uk/manage/','https://example.invalid/manage/']);
 assert.equal(r.redirected,undefined);
 assert.equal(new URL(r.links[0]).hostname,'dynamogymnastics.co.uk');
 assert.equal(new URL(r.links[0]).searchParams.get('next'),'https://dynamogymnastics.co.uk/manage/');
 assert.equal(r.links[1],'https://dynamogymnastics.co.uk/manage/');
 assert.equal(r.links[2],'https://example.invalid/manage/');
});
