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
 let currentColumn,step='opening Manage columns';
 try{
  await page.getByRole('button',{name:'Manage columns',exact:true}).click({timeout:10000});
  step='finding the Manage Table Columns panel';
  const dialog=page.locator('.ant-drawer-content:visible, .ant-modal-content:visible').filter({hasText:/manage\s+table\s+columns/i}).last();
  await dialog.waitFor({state:'visible',timeout:10000});
  let changed=false;
  for(const label of labels){
   currentColumn=label;step='checking existing columns';const matcher=columnLabel(label);
   // Existing selected columns are plain rows. Leave their order and all
   // unrelated selections intact; the searchable selector adds missing rows.
   if(await dialog.getByText(matcher,{exact:true}).count())continue;
   step='adding a missing column';
   const add=dialog.locator('.ant-select').filter({hasText:'Add new column...'});
   await add.click({timeout:5000});
   await add.locator('input[role="combobox"]').fill(label.replace(/^\s*\*\s*/,''),{timeout:5000});
   const option=page.locator('.ant-select-dropdown:visible').getByText(matcher,{exact:true});
   await option.click({timeout:5000});
   await dialog.getByText(matcher,{exact:true}).waitFor({state:'visible',timeout:5000});changed=true;
  }
  step=changed?'saving the column layout':'closing the unchanged column layout';
  await dialog.getByRole('button',{name:changed?'Save':'Cancel',exact:true}).click({timeout:5000});
  await dialog.waitFor({state:'hidden',timeout:10000});
  return {changed,columns:labels.length};
 }catch{
  const error=new RosterError('COLUMN_SETUP_FAILED');error.stage='contacts';
  error.validation={reason:'Column setup stopped while '+step+'. Existing membership records were preserved.',...(currentColumn?{column:currentColumn}:{})};throw error;
 }
}
module.exports={requiredColumns,columnLabel,ensureExportColumns};
