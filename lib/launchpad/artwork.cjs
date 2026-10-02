'use strict';
const {createHash}=require('node:crypto');
const {AppError,ownerAddress}=require('./policy.cjs');
const MAX_IMAGE_BYTES=256*1024;
function artwork(input,origin){
  const owner=ownerAddress(input.owner),name=typeof input.name==='string'?input.name.trim():'',symbol=typeof input.symbol==='string'?input.symbol.trim().toUpperCase():'';
  if(Buffer.byteLength(name)<2||Buffer.byteLength(name)>32||/[\x00-\x1f]/.test(name)||!/^[A-Z0-9]{2,10}$/.test(symbol))throw new AppError('Enter a token name (2–32 bytes) and ticker (2–10 letters/numbers).');
  if(typeof input.description!=='string'||input.description.length>1000)throw new AppError('Description must be at most 1,000 characters.');
  if(typeof input.image!=='string'||input.image.length>350000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.image))throw new AppError('Invalid image data.');
  const bytes=Buffer.from(input.image,'base64'),type=input.type;
  const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid||bytes.length<12||bytes.length>MAX_IMAGE_BYTES)throw new AppError('Choose a PNG, JPG or WebP image. Optimized artwork must be under 256 KB.');
  const id=createHash('sha256').update(JSON.stringify([name,symbol,input.description,type,input.image])).digest('hex').slice(0,32);
  const image=`${origin}/api/launchpad/artwork/${id}`;
  const metadata={name,symbol,description:input.description,image,properties:{files:[{uri:image,type}],category:'image'}};
  return {id,owner,type,image:input.image,metadata,uri:`${origin}/api/launchpad/metadata/${id}`};
}
module.exports={artwork,MAX_IMAGE_BYTES};
