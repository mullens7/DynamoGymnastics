import {cpSync,rmSync,existsSync} from 'node:fs';
if(!existsSync('public/index.html')) throw new Error('Homepage missing');
rmSync('dist',{recursive:true,force:true});
cpSync('public','dist',{recursive:true});
cpSync('node_modules/heic2any/dist/heic2any.min.js','dist/assets/heic2any-0.0.4.min.js');
cpSync('node_modules/heic2any/LICENSE.md','dist/assets/heic2any-LICENSE.md');
console.log('Static website built in dist/');
