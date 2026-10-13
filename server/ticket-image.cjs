const sharp=require('sharp'),fontkit=require('@pdf-lib/fontkit'),QRCode=require('qrcode');
const font=fontkit.create(Buffer.from(require('./email-assets/party-font.json').content,'base64'));
const logo=Buffer.from(require('./email-assets/party-logo.json').content,'base64');
function width(text,size){return font.layout(text).glyphs.reduce((n,g)=>n+g.advanceWidth,0)*size/font.unitsPerEm;}
function lines(text,size,max){const out=[];let line='';for(const char of String(text||'').replace(/[\r\n]/g,' ')){if(line&&width(line+char,size)>max){out.push(line);line='';}line+=char;}if(line)out.push(line);return out;}
function lettering(text,x,y,size,color='#25364b',center=false){const run=font.layout(text),scale=size/font.unitsPerEm;let cursor=center?x-width(text,size)/2:x;return run.glyphs.map((g,i)=>{const p=run.positions[i],path=`<path d="${g.path.toSVG()}" transform="translate(${cursor+p.xOffset*scale},${y-p.yOffset*scale}) scale(${scale},${-scale})" fill="${color}"/>`;cursor+=p.xAdvance*scale;return path;}).join('');}
function ticketDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return '';return new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'Europe/London'}).format(new Date(value+'T12:00:00Z'))+', '+value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4);}
async function buildTicketImage(row,qr=QRCode.toBuffer){
 const number=row.ticket_number;if(!/^DYN-[A-F0-9]{4}-[A-F0-9]{4}$/.test(number))throw Error('INVALID_TICKET');
 const s=row.session||{},child=[row.gymnast?.first_name,row.gymnast?.last_name].filter(Boolean).join(' ')||'Gymnast';
 let y=222,body=lettering('EVENT TICKET',400,184,20,'#1656a4',true);
 for(const [text,size,color] of [[s.name||'Dynamo activity',36,'#1656a4'],[child,30,'#25364b'],[ticketDate(s.date),25,'#25364b'],[(s.time||'')+(s.endTime?' – '+s.endTime:''),29,'#25364b'],[s.label,23,'#596b80'],[s.optionName,23,'#596b80'],[s.packageName?'Package: '+s.packageName:'',21,'#596b80']]){if(!text)continue;for(const line of lines(text,size,688)){y+=size*1.35;body+=lettering(line,400,y,size,color,true);}y+=10;}
 const divider=y+22,qrTop=Math.ceil(divider+35),height=qrTop+500;
 body+=`<path d="M48 ${divider}H752" stroke="#cbd8e8" stroke-width="2" stroke-dasharray="10 9"/>`;
 body+=lettering(number,400,qrTop+440,27,'#1656a4',true)+lettering('Show this ticket at event check-in',400,qrTop+477,20,'#596b80',true);
 const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}"><rect width="800" height="${height}" fill="#eef3fa"/><rect x="18" y="18" width="764" height="${height-36}" rx="24" fill="#ffffff"/><path d="M42 18H758Q782 18 782 42V142H18V42Q18 18 42 18" fill="#1656a4"/>${body}</svg>`);
 const logoPng=await sharp(logo).resize({width:360,height:98,fit:'inside'}).png().toBuffer();const lm=await sharp(logoPng).metadata();
 const code=await qr(number,{width:400,margin:4,errorCorrectionLevel:'M',type:'png'});
 return sharp(svg).composite([{input:logoPng,left:Math.round((800-lm.width)/2),top:36},{input:code,left:200,top:qrTop}]).png().toBuffer();
}
module.exports={buildTicketImage,ticketDate};
