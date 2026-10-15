const {createHash}=require('node:crypto');
const {classify}=require('../public/manage/membership.js');
class RosterError extends Error {constructor(code,review){super(code);this.code=code;this.stage='validation';if(review)this.review=review;}}
function invalid(reason,row,column){const error=new RosterError('INVALID_ROSTER');error.validation={reason,...(Number.isInteger(row)?{row}:{}),...(column?{column}:{})};return error;}
const normal=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
function text(cell){
 if(cell.type===6)throw invalid('A formula was found where a plain exported value is required.',cell.row); // Formulas are not identity fields.
 const v=cell.value;if(v instanceof Date)return v.toISOString().slice(0,10);
 if(v&&typeof v==='object'){if(v.richText)return v.richText.map(x=>x.text).join('');if(v.text)return String(v.text);throw invalid('An unsupported Excel cell value was found.',cell.row);}
 return String(v??'').trim();
}
async function readWorkbook(buffer){
 const Excel=require('exceljs'),workbook=new Excel.Workbook();
 try{await workbook.xlsx.load(buffer);}catch{throw invalid('The downloaded file could not be opened as an XLSX workbook.');}
 const candidates=[];
 for(const sheet of workbook.worksheets){
  for(let i=1;i<=Math.min(sheet.rowCount,10);i++){
   const row=sheet.getRow(i),columns=[];row.eachCell((cell,index)=>columns.push({index,label:text(cell)}));
   const keys=columns.map(c=>normal(c.label));
   if(keys.some(k=>['timeandclass','timeclass'].includes(k))&&keys.some(k=>['owneremail','accountowneremail','emailaddress','email'].includes(k))){candidates.push({sheet,header:i,columns});break;}
  }
 }
 if(candidates.length!==1){const error=invalid(candidates.length?'More than one worksheet contains the contact export headings.':'No worksheet contains both the Time and Class and owner email headings in its first ten rows.');error.missingColumns=candidates.length===0;throw error;}
 const result=candidates[0];if(result.sheet.rowCount>20001)throw invalid('The export exceeds the 20,000-contact limit.');
 result.rows=[];result.sheet.eachRow((row,index)=>{if(index>result.header&&row.actualCellCount)result.rows.push(row);});
 if(!result.rows.length)throw new RosterError('EMPTY_ROSTER');return result;
}
function columnMap(columns,mapping){
 const byName=new Map();for(const c of columns){const key=normal(c.label);if(byName.has(key))throw invalid('Two export column headings have the same name.');byName.set(key,c.index);}
 const required=['email','firstName','lastName','timeClass'];const mapped={};
 for(const [field,label] of Object.entries(mapping)){if(field==='activeValues'||field==='membershipPolicy'||field==='identityPolicy')continue;const index=byName.get(normal(label));if(!index)throw Object.assign(new RosterError('ROSTER_MAPPING_REQUIRED'),{missingColumns:true});mapped[field]=index;}
 if((!mapped.id&&(mapping.identityPolicy!=='email_name_dob'||!mapped.dateOfBirth))||required.some(k=>!mapped[k])||(!mapped.status&&mapping.membershipPolicy!=='assigned_classes'))throw new RosterError('ROSTER_MAPPING_REQUIRED');
 if(mapped.status&&(!Array.isArray(mapping.activeValues)||!mapping.activeValues.length))throw new RosterError('ROSTER_MAPPING_REQUIRED');return mapped;
}
function canonicalDate(value){
 if(!value)return null;
 let match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value),iso=value;
 if(!match){match=/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(value);if(!match)throw new RosterError('IDENTITY_REVIEW_REQUIRED');iso=match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');}
 const date=new Date(iso+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==iso)throw new RosterError('IDENTITY_REVIEW_REQUIRED');return iso;
}
function profileIdentity(email,firstName,lastName,dateOfBirth){
 if(!dateOfBirth)throw new RosterError('IDENTITY_REVIEW_REQUIRED');
 const canonical=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
 return 'derived:'+createHash('sha256').update(JSON.stringify([canonical(email),canonical(firstName),canonical(lastName),dateOfBirth])).digest('hex');
}
function prepareRoster(workbook,mapping,report={}){
 const columns=columnMap(workbook.columns,mapping),owners=new Map(),seen=new Set(),unmapped=new Map();
 report.unmappedRows=0;report.unmappedClasses=[];
 for(const row of workbook.rows){
  const value=field=>{try{return columns[field]?text(row.getCell(columns[field])):'';}catch(error){error.validation={...error.validation,row:row.number,column:field};throw error;}};
  const email=value('email').toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw invalid('The account owner email is missing or invalid.',row.number,'Owner email');
  const timeClass=value('timeClass'),rule=classify(timeClass);
  // Unknown labels grant no member or staff benefits.
  if(rule.review.length){report.unmappedRows++;const label=timeClass.slice(0,200);unmapped.set(label,(unmapped.get(label)||0)+1);}
  const active=columns.status?mapping.activeValues.map(normal).includes(normal(value('status'))):rule.groups.length>0||rule.staff;
  let owner=owners.get(email);if(!owner){owner={email,ownerName:value('ownerName'),member:false,staff:false,gymnasts:[]};owners.set(email,owner);}
  owner.staff ||= active&&rule.staff;
  if(rule.groups.length){const firstName=value('firstName'),lastName=value('lastName');if(!firstName||!lastName)throw invalid('A gymnast with a recognised class is missing a first or last name.',row.number,'Gymnast name');
   const dateOfBirth=canonicalDate(value('dateOfBirth'));
   const id=columns.id?value('id'):profileIdentity(email,firstName,lastName,dateOfBirth);
   if(!id||seen.has(id))throw new RosterError('IDENTITY_REVIEW_REQUIRED');seen.add(id);
   owner.gymnasts.push({sourceId:id,firstName,lastName,dateOfBirth,bgNumber:value('bgNumber'),timeClass,groups:rule.groups,active});owner.member ||= active;
  }
 }
 report.unmappedClasses=[...unmapped].slice(0,20).map(([label,rows])=>({label,rows}));
 return [...owners.values()];
}
// Reference reconciliation: immutable account IDs and all unrelated history survive.
function reconcile(existing,roster,makeId){
 const accounts=new Map(existing.map(a=>[a.email.toLowerCase(),structuredClone(a)]));
 for(const a of accounts.values()){a.member=false;a.staff=false;for(const g of a.gymnasts||[])g.active=false;}
 for(const owner of roster){let a=accounts.get(owner.email);if(!a){a={id:makeId(),email:owner.email,gymnasts:[]};accounts.set(owner.email,a);}
  a.member=owner.member;a.staff=owner.staff;a.ownerName=owner.ownerName;
  for(const g of owner.gymnasts){const previous=a.gymnasts.find(x=>x.sourceId===g.sourceId);if(previous)Object.assign(previous,g);else a.gymnasts.push({...g});}
 }
 return [...accounts.values()];
}
module.exports={RosterError,readWorkbook,prepareRoster,reconcile,canonicalDate,profileIdentity};
