const {test}=require('node:test'),assert=require('node:assert/strict');
const {requiredColumns,columnLabel,ensureExportColumns}=require('../server/thrive-columns.cjs');
const env={THRIVE_EXPORT_MAPPING:JSON.stringify({firstName:'first name',lastName:'last name',timeClass:'time and class',ownerName:'account owner',email:'owner email',bgNumber:'*bg membership number',dateOfBirth:'date of birth',identityPolicy:'email_name_dob',membershipPolicy:'assigned_classes'})};
function fixture(initial,{missing}={}){
 const selected=[...initial],actions=[];let option,query;
 const match=(matcher,value)=>typeof matcher==='string'?matcher===value:matcher.test(value);
 const row=matcher=>({count:async()=>selected.filter(value=>match(matcher,value)).length,waitFor:async()=>assert.ok(selected.some(value=>match(matcher,value)))});
 const add={click:async()=>actions.push('open selector'),locator:()=>({fill:async value=>query=value})};
 const dialog={waitFor:async()=>{},getByText:row,locator:selector=>{assert.equal(selector,'.ant-select');return {filter:()=>add};},getByRole:(role,{name})=>({click:async()=>actions.push(name)})};
 const page={getByRole:(role,{name})=>role==='dialog'?(assert.equal(name,'Manage table columns'),dialog):{click:async()=>actions.push(name)},locator:selector=>{if(selector.includes('.ant-drawer-content'))return {filter:({hasText})=>{assert.ok(hasText.test('Manage Table Columns'));return {last:()=>dialog};}};assert.equal(selector,'.ant-select-dropdown:visible');return {getByText:matcher=>({click:async()=>{if(query===missing)throw Error('private DOM/token');option=query;assert.ok(matcher.test(option));selected.push(option);actions.push('add '+option);}})};}};
 return {page,selected,actions};
}
test('column labels tolerate case, whitespace and optional custom-field star; automatic names are not selected',()=>{
 assert.ok(columnLabel('*bg membership number').test('BG membership number'));assert.ok(columnLabel('time and class').test('Time  and Class'));assert.equal(columnLabel('owner email').test('email'),false);
 const columns=requiredColumns(env);assert.equal(columns.includes('first name'),false);assert.equal(columns.includes('last name'),false);assert.equal(columns.includes('email_name_dob'),false);assert.equal(columns.length,5);
});
test('missing required columns are added without removing or reordering existing staff selections',async()=>{
 const f=fixture(['Name','country','account owner']);const result=await ensureExportColumns(f.page,env);
 assert.equal(result.changed,true);assert.deepEqual(f.selected.slice(0,3),['Name','country','account owner']);assert.ok(f.selected.includes('time and class'));assert.ok(f.selected.includes('owner email'));assert.ok(f.actions.includes('Save'));assert.equal(f.actions.includes('Reset to defaults'),false);
 const previous=[...f.selected];f.actions.length=0;assert.equal((await ensureExportColumns(f.page,env)).changed,false);assert.deepEqual(f.selected,previous);assert.deepEqual(f.actions,['Manage columns','Cancel']);
});
test('changed controls or unavailable columns stop before export and identify the field without raw DOM',async()=>{
 const f=fixture(['account owner'],{missing:'owner email'});
 await assert.rejects(ensureExportColumns(f.page,env),error=>{assert.equal(error.code,'COLUMN_SETUP_FAILED');assert.equal(error.stage,'contacts');assert.equal(error.validation.column,'owner email');assert.equal(JSON.stringify(error).includes('private DOM'),false);return true;});assert.equal(f.actions.includes('Save'),false);
});
