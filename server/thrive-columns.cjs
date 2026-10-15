const {RosterError}=require('./member-roster.cjs');
// Thrive4 always prepends first/last name to Contacts exports; they are not selectable columns.
const fields=['timeClass','ownerName','email','bgNumber','dateOfBirth','id','status'];
function requiredColumns(env){
 let mapping;try{mapping=JSON.parse(env.THRIVE_EXPORT_MAPPING||'');}catch{throw new RosterError('ROSTER_MAPPING_REQUIRED');}
 return [...new Set(fields.map(field=>mapping[field]).filter(label=>typeof label==='string'&&label.trim()).map(label=>label.trim()))];
}
function columnLabel(label){
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp('^\\s*\\*?\\s*'+label.replace(/^\s*\*\s*/,'').trim().split(/\s+/).map(escape).join('\\s+')+'\\s*\\*?\\s*$','i');
}
async function ensureExportColumns(page,env){
 const labels=requiredColumns(env);if(!labels.length)throw new RosterError('ROSTER_MAPPING_REQUIRED');
 let currentColumn;
 try{
  await page.getByRole('button',{name:'Manage columns',exact:true}).click({timeout:10000});
  const dialog=page.getByRole('dialog',{name:'Manage table columns',exact:true});
  await dialog.waitFor({state:'visible',timeout:10000});
  let changed=false;
  for(const label of labels){
   currentColumn=label;const matcher=columnLabel(label);
   // Existing selected columns are plain rows. Leave their order and all
   // unrelated selections intact; the searchable selector adds missing rows.
   if(await dialog.getByText(matcher,{exact:true}).count())continue;
   const add=dialog.locator('.ant-select').filter({hasText:'Add new column...'});
   await add.click({timeout:5000});
   await add.locator('input[role="combobox"]').fill(label.replace(/^\s*\*\s*/,''),{timeout:5000});
   const option=page.locator('.ant-select-dropdown:visible').getByText(matcher,{exact:true});
   await option.click({timeout:5000});
   await dialog.getByText(matcher,{exact:true}).waitFor({state:'visible',timeout:5000});changed=true;
  }
  await dialog.getByRole('button',{name:changed?'Save':'Cancel',exact:true}).click({timeout:5000});
  await dialog.waitFor({state:'hidden',timeout:10000});
  return {changed,columns:labels.length};
 }catch{
  const error=new RosterError('COLUMN_SETUP_FAILED');error.stage='contacts';
  error.validation={reason:'The required export columns could not be confirmed in Thrive4 Manage columns. Existing membership records were preserved.',...(currentColumn?{column:currentColumn}:{})};throw error;
 }
}
module.exports={requiredColumns,columnLabel,ensureExportColumns};
