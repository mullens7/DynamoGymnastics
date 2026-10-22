const {GoogleAuth}=require('google-auth-library');
const SHEET='1CMIZvPMCHg_MyFUc1zdW65_DbXwRMqIuwwPkJJJ6gcs',TAB=1013960675;
function client(env){let credentials;try{credentials=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON||'');}catch{throw Error('GOOGLE_NOT_CONFIGURED');}if(credentials.type!=='service_account'||!credentials.client_email?.endsWith('.iam.gserviceaccount.com')||!credentials.private_key?.includes('BEGIN PRIVATE KEY'))throw Error('GOOGLE_NOT_CONFIGURED');return new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/spreadsheets']});}
async function request(auth,path,body){try{return (await auth.request({url:'https://sheets.googleapis.com/v4/spreadsheets/'+SHEET+path,method:body?'POST':'GET',...(body?{data:body}:{}),timeout:20000,retry:false})).data;}catch(e){const error=Error('GOOGLE_SHEETS_FAILED');error.status=e.response?.status;throw error;}}
async function inspect(env,auth=client(env)){
 const meta=await request(auth,'?fields=spreadsheetId,sheets.properties');const sheet=meta.sheets?.find(s=>s.properties.sheetId===TAB)?.properties;
 if(!sheet||sheet.title!=='Current'||sheet.gridProperties.columnCount<9)throw Error('WAITING_SHEET_LAYOUT_CHANGED');
 const values=await request(auth,"/values/"+encodeURIComponent("'Current'!A1:I2"));
 if(!String(values.values?.[0]?.join(' ')||'').includes('Waiting List'))throw Error('WAITING_SHEET_LAYOUT_CHANGED');
 return {ok:true,sheetId:SHEET,tab:sheet.title,columns:sheet.gridProperties.columnCount,configured:true};
}
async function exists(auth,id){const response=await request(auth,'/developerMetadata:search',{dataFilters:[{developerMetadataLookup:{metadataKey:'dynamo_waiting_submission',metadataValue:id,visibility:'DOCUMENT'}}]});return (response.matchedDeveloperMetadata||[]).length>0;}
function cells(data){const text=v=>({userEnteredValue:{stringValue:String(v)}});return data.children.map(c=>({values:[{userEnteredValue:{formulaValue:'=ROW()-1'}},text(c.first),text(c.last),{userEnteredValue:{numberValue:(Date.parse(c.dob+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000},userEnteredFormat:{numberFormat:{type:'DATE',pattern:'dd/mm/yyyy'}}},text(data.email),text(data.parent),text(c.classes[0].category==='Gyminis'?'Gymini':'Recreational'),text(c.classes.map(r=>`${r.day} ${r.start}–${r.end}`).join('; ')),text((data.together?'Siblings to attend the same day and time. ':'')+'Website waiting-list submission.')]}));}
async function append(env,id,data,{recoverOnly=false,auth=client(env)}={}){
 if(await exists(auth,id))return {confirmed:true,existing:true};
 if(recoverOnly)return {confirmed:false};
 await inspect(env,auth);
 // Append all siblings and a receipt in one atomic Sheets request. Caller holds
 // a persistent claim; uncertain requests are never blindly appended again.
 await request(auth,':batchUpdate',{requests:[{appendCells:{sheetId:TAB,rows:cells(data),fields:'userEnteredValue,userEnteredFormat.numberFormat'}},{createDeveloperMetadata:{developerMetadata:{metadataKey:'dynamo_waiting_submission',metadataValue:id,visibility:'DOCUMENT',location:{spreadsheet:true}}}}]});
 return {confirmed:true,existing:false};
}
module.exports={client,inspect,append,cells,SHEET,TAB};
