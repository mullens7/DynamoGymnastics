(function(root){
 const categories=['Stay & Play','Gymtots','Gyminis','Recreational','Adult Gymnastics'],days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 function minutes(time){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return null;const [h,m]=time.split(':').map(Number);return h*60+m;}
 function duration(start,end){const a=minutes(start),b=minutes(end);return a===null||b===null||b<=a?null:b-a;}
 function durationLabel(n){return [Math.floor(n/60)?Math.floor(n/60)+' hr'+(n>=120?'s':''):'',n%60?n%60+' mins':''].filter(Boolean).join(' ');}
 function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
 function schoolStart(dob){if(!validDate(dob))return null;return (Number(dob.slice(0,4))+4+(dob.slice(5)>'08-31'?1:0))+'-09-01';}
 function atMonths(dob,months){const total=Number(dob.slice(0,4))*12+Number(dob.slice(5,7))-1+months,year=Math.floor(total/12),month=total%12+1,day=Math.min(Number(dob.slice(8)),new Date(Date.UTC(year,month,0)).getUTCDate());return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');}
 function eligible(record,dob,today){if(!validDate(dob)||!validDate(today)||dob>today)return false;const minimum=record.ageMode==='school'?schoolStart(dob):atMonths(dob,record.minAgeYears*12+record.minAgeMonths);if(today<minimum)return false;return record.maxAgeYears==null||today<atMonths(dob,record.maxAgeYears*12+(record.maxAgeMonths||0)+1);}
 function ageText(years,months){return [years?years+' year'+(years===1?'':'s'):'',months?months+' month'+(months===1?'':'s'):''].filter(Boolean).join(' ')||'0 months';}
 function ageLabel(r){const maximum=r.maxAgeYears!=null?' · up to '+ageText(r.maxAgeYears,r.maxAgeMonths||0)+' (inclusive)':'';if(r.ageMode==='school')return 'Reception age'+(maximum||' and above');return (r.minAgeYears||r.minAgeMonths?'From '+ageText(r.minAgeYears,r.minAgeMonths):maximum?'From birth':'All ages')+maximum;}
 const api={categories,days,duration,durationLabel,schoolStart,eligible,ageLabel};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DynamoClasses=api;
})(globalThis);
