const {sourceConfigurations}=require('./roster-sources.cjs');
const {exportContacts}=require('./thrive-export.cjs');
const {readWorkbook}=require('./member-roster.cjs');
async function inspectInsurance(env,input){
 const source=sourceConfigurations(env).find(s=>s.key===input.source);if(!source)throw Error('SOURCE_NOT_FOUND');
 if(!Array.isArray(input.names)||input.names.length>5||input.names.some(n=>typeof n!=='string'||n.length>160))throw Error('INVALID_NAMES');
 const download=await exportContacts(source.env,{includeWorkbook:true});
 const workbook=await readWorkbook(download.workbook,{allowClassHeading:source.key==='gymtots'}),normal=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
 const names=new Set(input.names.map(normal)),first=workbook.columns.find(c=>normal(c.label)==='firstname'),last=workbook.columns.find(c=>normal(c.label)==='lastname');
 const fields=workbook.columns.filter(c=>/date|expir|renew|insurance/i.test(c.label)&&!/birth/i.test(c.label));
 const matches=workbook.rows.filter(row=>names.has(normal(row.getCell(first.index).text+' '+row.getCell(last.index).text))).map(row=>({name:row.getCell(first.index).text+' '+row.getCell(last.index).text,fields:fields.map(c=>({heading:c.label,value:row.getCell(c.index).value,type:row.getCell(c.index).type}))}));
 return {source:source.name,columns:workbook.columns.map(c=>c.label),matches};
}
module.exports={inspectInsurance};
