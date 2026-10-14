import sharp from 'sharp';
import {cpSync,rmSync,existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
if(!existsSync('public/index.html')) throw new Error('Homepage missing');
rmSync('dist',{recursive:true,force:true});
cpSync('public','dist',{recursive:true});
function prepareDomains(path){for(const entry of readdirSync(path,{withFileTypes:true})){const file=path+'/'+entry.name;if(entry.isDirectory())prepareDomains(file);else if(entry.name.endsWith('.html')){const html=readFileSync(file,'utf8');writeFileSync(file,html.replace('</body>','<script src="/domain-routes.js" defer></script></body>'));}}}
prepareDomains('dist');
cpSync('node_modules/heic2any/dist/heic2any.min.js','dist/assets/heic2any-0.0.4.min.js');
cpSync('node_modules/heic2any/LICENSE.md','dist/assets/heic2any-LICENSE.md');
cpSync('node_modules/qr-scanner/qr-scanner.umd.min.js','dist/assets/qr-scanner-1.4.2.min.js');
cpSync('node_modules/qr-scanner/qr-scanner-worker.min.js','dist/assets/qr-scanner-worker.min.js');
cpSync('node_modules/qr-scanner/LICENSE','dist/assets/qr-scanner-LICENSE');
// Booking signatures are hosted images, so saving email attachments saves tickets only.
const signatureAssets=JSON.parse(readFileSync('server/email-assets/signature.json','utf8'));
mkdirSync('dist/assets/email',{recursive:true});
for(const [name,asset] of Object.entries(signatureAssets)){
 if(!/^signature-[a-z]+$/.test(name))throw new Error('Invalid signature asset name');
 const png=Buffer.from(asset.content,'base64');
 if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid signature PNG');
 writeFileSync('dist/assets/email/'+name+'.png',png);
}
// A tightly cropped logo avoids the whitespace and divider of the old signature slice.
await sharp(Buffer.from(signatureAssets['signature-logo'].content,'base64')).extract({left:60,top:190,width:480,height:150}).resize({width:480}).png().toFile('dist/assets/email/dynamo-logo.png');
console.log('Static website built in dist/');

