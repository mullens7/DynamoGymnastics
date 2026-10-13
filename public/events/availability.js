(function(root){
function status(remaining,capacity){const left=Math.max(0,Number(remaining)||0),total=Math.max(0,Number(capacity)||0);if(left===0)return {tone:'red',label:'Session Fully Booked'};if(total===0||left*100>total*30)return {tone:'green',label:'Spaces available'};if(left*100>=total*20)return {tone:'orange',label:'Limited spaces remaining'};return {tone:'red',label:'Few spaces remaining'};}
function formatDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return '';const d=new Date(value+'T12:00:00Z');if(Number.isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'Europe/London'}).format(d)+', '+value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);}
const api={status,formatDate};if(typeof module==='object'&&module.exports)module.exports=api;else root.DynamoEventAvailability=api;
})(typeof globalThis!=='undefined'?globalThis:this);
