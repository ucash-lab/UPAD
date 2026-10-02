'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Keypair,PublicKey}=require('@solana/web3.js');
const {NATIVE_MINT}=require('@solana/spl-token');
const {artwork}=require('../lib/launchpad/artwork.cjs');
const {Chain}=require('../lib/launchpad/chain.cjs');
const {PLATFORM}=require('../lib/launchpad/policy.cjs');
const {Store}=require('../lib/launchpad/store.cjs');
const {createLaunchpadServer}=require('../server/launchpad-server.js');
const http=require('node:http');
function request(url,options={}){return new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:{get:name=>res.headers[name]},json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes});});});req.on('error',reject);req.end(options.body);});}
const input={owner:Keypair.generate().publicKey.toBase58(),name:'Test Meme',symbol:'MEME',description:'Local fixture only',type:'image/png',image:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6xoAAAAASUVORK5CYII='};
test('artwork validates type, sizes, identity and yields immutable short URLs',()=>{
 const a=artwork(input,'https://www.upad.cash');assert.ok(a.uri.length<100);assert.equal(artwork({...input,owner:Keypair.generate().publicKey.toBase58()},'https://www.upad.cash').id,a.id);
 assert.notEqual(artwork({...input,description:'changed'},'https://www.upad.cash').id,a.id);
 for(const patch of [{image:'<svg/>'},{type:'image/svg+xml'},{image:Buffer.alloc(300000).toString('base64')},{name:'a'.repeat(33)},{owner:'invalid'},{symbol:'!BAD'},{description:'a'.repeat(1001)}])assert.throws(()=>artwork({...input,...patch},'https://www.upad.cash'));
});
test('Meteora nested poolState is used for confirmation identity and fee validation',async()=>{
 const c=new Chain(),mint=Keypair.generate().publicKey,config=Keypair.generate().publicKey,creator=new PublicKey(input.owner);
 const state={baseMint:mint,config,creator};c.client.state.getPool=async()=>({poolState:state});
 c.client.state.getPoolConfig=async()=>({feeClaimer:new PublicKey(PLATFORM),creatorTradingFeePercentage:80,quoteMint:NATIVE_MINT});
 const launch={network:'mainnet-beta',mint:mint.toBase58(),config:config.toBase58(),owner:input.owner,pool:mint.toBase58()};
 assert.equal((await c.validatePool(launch)).state,state);await assert.rejects(()=>c.validatePool({...launch,mint:config.toBase58()}),/identity/);
 c.client.state.getPool=async()=>null;await assert.rejects(()=>c.validatePool(launch),/identity/);
});
test('insufficient rent is reported before signing with no broadcast',async()=>{
 const {Transaction,SystemProgram}=require('@solana/web3.js'),payer=Keypair.generate();
 const tx=new Transaction({feePayer:payer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:new PublicKey(PLATFORM),lamports:1}));
 const c=new Chain();c.connection.simulateTransaction=async()=>({value:{err:{InstructionError:[2,{Custom:1}]},logs:['Transfer: insufficient lamports 869880, need 5974080']}});
 await assert.rejects(()=>c.simulate({transaction:tx.serialize({requireAllSignatures:false}).toString('base64'),owner:payer.publicKey.toBase58()},'Launch'),/Not enough SOL.*0.005974080 SOL.*No transaction was sent/);
});
test('upload, public image/metadata, duplicate reuse and launch identity work without external requests',async()=>{
 const store=new Store(':memory:','mainnet-beta');let prepared;
 const chain={networkName:'mainnet-beta',prepareLaunch:async data=>{prepared=data;return {transaction:'fixture',expiresAt:Date.now()+90000};}};
 const {server}=createLaunchpadServer({chain,store,publicHosts:['www.upad.cash'],xToken:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/api/launchpad/`;
 const headers={Host:'www.upad.cash',Origin:'https://www.upad.cash','Content-Type':'application/json'};
 const post=(route,data)=>request(base+route,{method:'POST',headers,body:JSON.stringify(data)});
 try{
  const response=await post('artwork',input);assert.equal(response.status,201);const saved=await response.json();
  assert.equal((await post('artwork',input)).status,200);
  const meta=await request(base+'metadata/'+saved.id,{headers});assert.equal(meta.status,200);assert.equal((await meta.json()).name,input.name);
  const image=await request(base+'artwork/'+saved.id,{headers});assert.equal(image.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),input.image);
  const launch={...input,artworkId:saved.id,feeBps:100,cadenceMinutes:60,strategy:'creator',network:'mainnet-beta',acceptNetwork:true,acceptRealFunds:true,acceptFees:true};
  assert.equal((await post('launch/prepare',launch)).status,201);assert.equal(prepared.uri,saved.uri);
  assert.equal((await post('launch/prepare',{...launch,name:'Different'})).status,400);
  assert.equal(store.launches().length,0);
  assert.equal((await post('artwork',{...input,image:'A'.repeat(370000)})).status,413);
 }finally{await new Promise(r=>server.close(r));store.close();}
});
