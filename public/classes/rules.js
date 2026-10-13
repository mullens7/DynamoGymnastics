(function(root){
 const categories=['Stay & Play','Gymtots','Gyminis','Recreational','Adult Gymnastics'],days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 function minutes(time){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return null;const [h,m]=time.split(':').map(Number);return h*60+m;}
 function duration(start,end){const a=minutes(start),b=minutes(end);return a===null||b===null||b<=a?null:b-a;}
 function durationLabel(n){return [Math.floor(n/60)?Math.floor(n/60)+' hr'+(n>=120?'s':''):'',n%60?n%60+' mins':''].filter(Boolean).join(' ');}
 function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
 function schoolStart(dob){if(!validDate(dob))return null;return (Number(dob.slice(0,4))+4+(dob.slice(5)>'08-31'?1:0))+'-09-01';}
 function eligible(record,dob,today){if(!validDate(dob)||!validDate(today)||dob>today)return false;if(record.ageMode==='school')return today>=schoolStart(dob);const total=Number(dob.slice(0,4))*12+Number(dob.slice(5,7))-1+record.minAgeYears*12+record.minAgeMonths,year=Math.floor(total/12),month=total%12+1,day=Math.min(Number(dob.slice(8)),new Date(Date.UTC(year,month,0)).getUTCDate());return today>=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');}
 function ageLabel(r){if(r.ageMode==='school')return 'Reception age and above';const parts=[r.minAgeYears?r.minAgeYears+' year'+(r.minAgeYears===1?'':'s'):'',r.minAgeMonths?r.minAgeMonths+' month'+(r.minAgeMonths===1?'':'s'):''].filter(Boolean);return parts.length?'From '+parts.join(' '):'All ages';}
 const api={categories,days,duration,durationLabel,schoolStart,eligible,ageLabel};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DynamoClasses=api;
})(globalThis);
