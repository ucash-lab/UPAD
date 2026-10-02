export async function prepareImage(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a PNG, JPG or WebP image under 10 MB.');
  const bitmap=await createImageBitmap(file);
  try{
    const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.85));
    if(!blob||blob.size>256*1024)throw new Error('This image is too detailed. Choose a smaller image.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    return {image:data.split(',')[1],type:blob.type,preview:data};
  }finally{bitmap.close();}
}
