let galleryPhotos=[],galleryLoading=false,galleryLoaded=false;
async function renderGallery(){
 $('#content').innerHTML=title('Gallery','Add or remove photos shown on the website.','<button class="primary" id="add-gallery-photos">+ Add photos</button><input id="gallery-upload" type="file" accept="image/*" multiple hidden>')+'<p id="gallery-status" role="status"></p><div class="admin-gallery">'+galleryPhotos.map(p=>`<article><img loading="lazy" src="${esc(p.src)}" alt="${esc(p.alt)}"><button class="danger" data-remove-photo="${esc(p.id)}">Remove photo</button></article>`).join('')+'</div>';
 $('#gallery-upload').onchange=uploadGallery;$('#add-gallery-photos').onclick=()=>$('#gallery-upload').click();
 if(!galleryLoaded&&!galleryLoading){galleryLoading=true;try{const response=await api('/api/gallery/?admin=1');galleryPhotos=response.records;galleryLoaded=true;if(tab==='gallery')renderGallery();}catch(e){if(tab==='gallery')$('#gallery-status').textContent=e.message;}finally{galleryLoading=false;}}
}
async function photoData(file){
 if(!file.type.startsWith('image/')||file.size>25000000)throw Error('Choose an image smaller than 25 MB.');
 const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 let data=canvas.toDataURL('image/jpeg',.85).split(',')[1];if(data.length>2000000)data=canvas.toDataURL('image/jpeg',.65).split(',')[1];if(data.length>2000000)throw Error('This image is too large. Please choose a smaller photo.');return data;
}
async function uploadGallery(event){
 const input=event.target,files=[...input.files];input.disabled=true;let added=0;
 try{for(const file of files){$('#gallery-status').textContent=`Uploading photo ${added+1} of ${files.length}…`;await api('/api/gallery/',{method:'POST',body:JSON.stringify({image:await photoData(file)})});added++;}galleryLoaded=false;await renderGallery();toast(added+' photo'+(added===1?'':'s')+' added.');}
 catch(e){galleryLoaded=false;await renderGallery();$('#gallery-status').textContent=(added?added+' photos added. ':'')+e.message;}
 finally{input.disabled=false;input.value='';}
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-remove-photo]');if(!button)return;const id=button.dataset.removePhoto;modal('<h2>Remove photo?</h2><p>This photo will no longer appear in the gallery.</p><p id="gallery-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" class="danger">Remove photo</button></div>',async()=>{try{await api('/api/gallery/?id='+encodeURIComponent(id),{method:'DELETE'});$('#dialog').close();galleryLoaded=false;await renderGallery();toast('Photo removed.');}catch(e){$('#gallery-error').textContent=e.message;}});});
