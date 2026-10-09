import {cpSync,rmSync,existsSync} from 'node:fs';
if(!existsSync('public/index.html')) throw new Error('Homepage missing');
rmSync('dist',{recursive:true,force:true});
cpSync('public','dist',{recursive:true});
console.log('Static website built in dist/');
