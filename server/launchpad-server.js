'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Chain, verifySigned } = require('../lib/launchpad/chain.cjs');
const { Store } = require('../lib/launchpad/store.cjs');
const { AppError, PLATFORM, validateLaunch, address, ownerAddress } = require('../lib/launchpad/policy.cjs');
const { scanPage, progressReport, checkSearchAccess } = require('../lib/launchpad/x-tracker.cjs');
const { X_BUDGET, reserveXRequest } = require('../lib/launchpad/x-budget.cjs');
const { loadXBearerToken } = require('../lib/launchpad/x-credentials.cjs');
const { getNetwork } = require('../lib/launchpad/network.cjs');
const { artwork } = require('../lib/launchpad/artwork.cjs');
const staticHandler = require('./index.js').server.listeners('request')[0];
function base58(bytes) { const chars='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let x=BigInt('0x'+Buffer.from(bytes).toString('hex')), out=''; while(x){out=chars[Number(x%58n)]+out;x/=58n;} for(const b of bytes){if(b!==0)break;out='1'+out;} return out; }
function equalSecret(a,b) { return typeof a === 'string' && typeof b === 'string' && b.length >= 32 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)); }
async function body(req,limit=16000) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError('JSON content type required.',415);
  if(req.body!==undefined){const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(raw)>limit)throw new AppError('Request is too large.',413);try{return JSON.parse(raw);}catch{throw new AppError('Invalid JSON.');}}
  let raw=''; for await (const chunk of req) { raw += chunk; if(Buffer.byteLength(raw)>limit) throw new AppError('Request is too large.',413); }
  try { return JSON.parse(raw); } catch { throw new AppError('Invalid JSON.'); }
}
function createLaunchpadServer({ chain = new Chain(), store, xToken = loadXBearerToken(), adminToken = process.env.LAUNCHPAD_ADMIN_TOKEN, publicHosts = [], xFetch = fetch } = {}) {
  const network=getNetwork(chain.networkName || 'devnet');
  store=store || new Store(':memory:',network.name);
  if(store.network!==network.name)throw new Error('Server/database network mismatch.');
  const busy = new Set(), rates = new Map();
  const server = http.createServer(async(req,res)=>{
    const json=(code,value)=>{ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}); res.end(JSON.stringify(value)); };
    const host = req.headers.host;
    const hosted=publicHosts.length>0;
    const allowedHosts = hosted ? publicHosts : [`localhost:${req.socket.localPort}`,`127.0.0.1:${req.socket.localPort}`];
    if (!allowedHosts.includes(host)) return json(403,{error:'Request host is not authorized.'});
    let url; try { url=new URL(req.url,`http://${host}`); } catch { return json(400,{error:'Invalid URL'}); }
    if (!url.pathname.startsWith('/api/launchpad/')) return staticHandler(req,res);
    try {
      if (!['GET','POST'].includes(req.method)) throw new AppError('Method not allowed.',405);
      if(hosted && !await store.allow('public-api',600))throw new AppError('Service is busy. Please retry shortly.',429);
      if (req.method==='POST') {
        const validOrigin = allowedHosts.map(h=>`${hosted?'https':'http'}://${h}`).includes(req.headers.origin);
        const admin = equalSecret(req.headers.authorization, adminToken ? `Bearer ${adminToken}` : undefined);
        if (!validOrigin && !admin) throw new AppError('Same-origin request required.',403);
        if(hosted && !await store.allow('public-writes',30))throw new AppError('Too many requests. Wait a minute.',429);
        const key=req.socket.remoteAddress; const now=Date.now();
        const rate=rates.get(key); if(!rate || rate.until<now) rates.set(key,{count:1,until:now+60000}); else if(++rate.count>30) throw new AppError('Too many requests. Wait a minute.',429);
      }
      const route=url.pathname.slice('/api/launchpad/'.length);
      const assetMatch=route.match(/^(artwork|metadata)\/([a-f0-9]{32})$/);
      if(req.method==='GET' && assetMatch){
        const saved=await store.artwork(assetMatch[2]);if(!saved)throw new AppError('Token artwork not found.',404);
        const isImage=assetMatch[1]==='artwork';
        res.writeHead(200,{'Content-Type':isImage?saved.type:'application/json; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'});
        return res.end(isImage?Buffer.from(saved.image,'base64'):JSON.stringify(saved.metadata));
      }
      if(req.method==='POST' && route==='artwork'){
        const origin=hosted?'https://www.upad.cash':`http://${host}`;
        const data=artwork(await body(req,360000),origin),existing=await store.artwork(data.id);
        if(existing)return json(200,{id:existing.id,uri:existing.uri,image:existing.metadata.image});
        // Unsigned wallet addresses are not authentication. A shared global cap is mandatory.
        if(!await store.allow('artwork-global',20,86400000))throw new AppError('Today’s image upload limit has been reached. Saved artwork remains available.',429);
        const saved=await store.saveArtwork(data);
        return json(201,{id:saved.id,uri:saved.uri,image:saved.metadata.image});
      }
      if(req.method==='POST' && ['x/check','x/sample'].includes(route)) {
        if(!equalSecret(req.headers.authorization,adminToken?`Bearer ${adminToken}`:undefined))throw new AppError('Operator authorization required.',403);
        const input=await body(req), mint=address(input.mint);
        await reserveXRequest(store,input,{probe:route==='x/check',legacyHttp:Number(process.env.X_LAST_CHECK_HTTP)||null});
        try {
          if(route==='x/sample'){
            const state=await scanPage(mint,xToken,null,xFetch);
            await store.saveXStatus({http:200,searchAccessVerified:true,checkedAt:Date.now()});
            // Private response only. Never register this token or publish its sample.
            return json(200,{...progressReport(mint,state),published:false,budget:X_BUDGET});
          }
          const status=await checkSearchAccess(mint,xToken,xFetch);await store.saveXStatus(status);return json(200,status);
        }catch(e){await store.saveXStatus({http:e.xHttp||503,searchAccessVerified:false,checkedAt:Date.now()});throw e;}
      }
      if(req.method==='GET' && route==='health') {
        let rpc; try { rpc={ready:true,...await chain.network()}; } catch { rpc={ready:false,error:'RPC network verification or Meteora program check failed. No transactions can be submitted.'}; }
        const xStatus=store.xStatus?await store.xStatus():null;
        return json(200,{network:network.name,networkLabel:network.label,walletChain:network.walletChain,mainnetEnabled:network.name==='mainnet-beta',rpc,privateRpcConfigured:Boolean(chain.privateRpcConfigured),productionVerified:false,platformRecipient:PLATFORM,platformShareBps:2000,creatorShareBps:8000,xTrackingConfigured:Boolean(xToken),xLastCheckHttp:xStatus?.http??(Number(process.env.X_LAST_CHECK_HTTP)||null),xLastCheckedAt:xStatus?.checkedAt||null,xSearchAccessVerified:xStatus?.searchAccessVerified===true,xBudget:X_BUDGET,xPayoutsEnabled:false,enabledStrategies:['creator'],graduatedTradingEnabled:true});
      }
      if(req.method==='GET' && route==='markets') return json(200,{markets:await store.launches()});
      if(req.method==='GET' && route==='balance') { await chain.network(); return json(200,{lamports:await chain.connection.getBalance(new (require('@solana/web3.js').PublicKey)(ownerAddress(url.searchParams.get('owner'))))}); }
      if(req.method==='POST' && route==='launch/prepare') {
        const input=await body(req);
        if(input.artworkId){
          if(!/^[a-f0-9]{32}$/.test(input.artworkId))throw new AppError('Choose your token image again.');
          const saved=await store.artwork(input.artworkId);
          if(!saved||saved.metadata.name!==input.name.trim()||saved.metadata.symbol!==input.symbol.trim().toUpperCase())throw new AppError('Token details changed. Upload the artwork again.');
          input.uri=saved.uri;
        }
        const data=validateLaunch(input,network.name);
        const prepared=await chain.prepareLaunch(data);
        return json(201,await store.create('launch',{...data,...prepared}));
      }
      const intentMatch=route.match(/^intents\/([a-f0-9-]{36})$/);
      if(req.method==='GET' && intentMatch) {
        let intent=await store.intent(intentMatch[1]); if(!intent) throw new AppError('Transaction not found.',404);
        if(intent.signature && !['confirmed','failed','expired'].includes(intent.status)) {
          const status=await chain.status(intent.signature,intent);
          if(status==='confirmed') {
            if(intent.kind==='launch') { await chain.confirmLaunch(intent); await store.publish(intent); }
            await store.mark(intent.id,'confirmed');
          } else if(['failed','expired'].includes(status)) await store.mark(intent.id,status);
          intent=await store.intent(intent.id);
        }
        return json(200,intent);
      }
      if(req.method==='POST' && route==='submit') {
        const input=await body(req); const intent=await store.intent(input.id);
        if(!intent) throw new AppError('Transaction not found.',404);
        if(intent.network!==network.name)throw new AppError('Transaction network mismatch.',409);
        // Verify even on retries so an arbitrary caller cannot substitute a transfer.
        const signed=verifySigned(input.signedTransaction,intent);
        const signature=base58(signed.signature);
        if(intent.signature && intent.signature!==signature) throw new AppError('A different transaction was already submitted.',409);
        if(intent.status==='confirmed') return json(200,{id:intent.id,signature,status:'confirmed'});
        if(['failed','expired'].includes(intent.status))throw new AppError('This transaction is closed. Check its receipt before preparing another action.',409);
        if(intent.expiresAt<Date.now() && !intent.signature) throw new AppError('Review expired. Prepare a fresh transaction; no funds were sent.',409);
        if(busy.has(intent.id)) return json(202,{id:intent.id,signature,status:'submitted'});
        const lease=store.acquire?await store.acquire('submit:'+intent.id):true;
        if(!lease)return json(202,{id:intent.id,signature,status:'submitted'});
        busy.add(intent.id);
        try {
        const recorded=await store.mark(intent.id,'submitted',signature);
        if(recorded===false)throw new AppError('Receipt state changed. Refresh before retrying.',409);
        try { await chain.broadcast(input.signedTransaction,intent); }
        catch(e) {
          if(e.name==='SendTransactionError') { await store.mark(intent.id,'failed'); return json(409,{id:intent.id,signature,status:'failed',error:'The network rejected the transaction during preflight. Check wallet funding and pool state before preparing another action.'}); }
          // Preserve the signature on uncertain delivery. Never create a new transfer automatically.
          return json(202,{id:intent.id,signature,status:'submitted',notice:'Submission was not confirmed. Check the receipt before retrying; no second transaction was created.'});
        }
        } finally { busy.delete(intent.id); if(store.release)await store.release('submit:'+intent.id,lease); }
        return json(202,{id:intent.id,signature,status:'submitted'});
      }
      const marketMatch=route.match(/^markets\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\/(trade|claim|mentions|sync-x))?$/);
      if(marketMatch) {
        const mint=address(marketMatch[1]), action=marketMatch[2]; const launch=await store.launch(mint);
        if(!launch) throw new AppError('Verified UCash market not found.',404);
        if(req.method==='GET' && !action) return json(200,{...launch,...await chain.market(launch,url.searchParams.get('owner'))});
        if(req.method==='GET' && action==='mentions') return json(200,await store.leaderboard(mint));
        if(req.method==='POST' && (action==='trade' || action==='claim')) {
          const input=await body(req);
          const prepared=action==='trade' ? await chain.prepareTrade(launch,input) : await chain.prepareClaim(launch,input.owner,input.role,input.position);
          return json(201,await store.create(action,{...prepared,mint,pool:launch.pool}));
        }
        if(req.method==='POST' && action==='sync-x') {
          if(!equalSecret(req.headers.authorization,adminToken?`Bearer ${adminToken}`:undefined)) throw new AppError('Operator authorization required.',403);
          const approval=await body(req);
          const last=(await store.leaderboard(mint)).sync; if(last && Date.now()-last.synced<300000) throw new AppError('This market was checked recently.',429);
          const key='x:'+mint; if(busy.has(key)) throw new AppError('Sync already running.',409);
          const lease=store.acquire?await store.acquire(key):true;if(!lease)throw new AppError('Sync already running.',409);
          busy.add(key);
          try {
            const current=(await store.leaderboard(mint)).sync;if(current && Date.now()-current.synced<300000)throw new AppError('This market was checked recently.',429);
            const previous=await store.xProgress(mint);
            await reserveXRequest(store,approval,{legacyHttp:Number(process.env.X_LAST_CHECK_HTTP)||null});
            let result;
            try {result=await scanPage(mint,xToken,previous,xFetch);}
            catch(e){await store.saveXStatus({http:e.xHttp||503,searchAccessVerified:false,checkedAt:Date.now()});throw e;}
            await store.saveXProgress(mint,result,progressReport(mint,result));
            await store.saveXStatus({http:200,searchAccessVerified:true,checkedAt:Date.now()});
            return json(200,await store.leaderboard(mint));
          } finally { busy.delete(key);if(store.release)await store.release(key,lease); }
        }
      }
      if(req.method==='POST' && route==='payouts') throw new AppError('X-linked payouts are not enabled: approved X use, verified wallet attribution and an audited distribution path are required.',409);
      throw new AppError('Not found.',404);
    } catch(e) { json(e.status || 503,{error:e.status?e.message:'The chain service could not complete this request. Check RPC connectivity and retry. No success was assumed.'}); }
  });
  server.requestTimeout=25000; server.headersTimeout=10000;
  return {server,store};
}
if(require.main===module) {
  require('dotenv').config({path:path.resolve(__dirname,'../.env')});
  const dataDir=path.resolve(__dirname,'../.launchpad-data'); fs.mkdirSync(dataDir,{recursive:true});
  const network=getNetwork();
  const {server,store}=createLaunchpadServer({store:new Store(path.join(dataDir,network.name+'.sqlite'),network.name)});
  server.listen(Number(process.env.PORT || 8798),'127.0.0.1',()=>console.log(`UCash launchpad: http://localhost:${server.address().port}/ (${network.label}; wallet approval required)`));
  const stop=()=>server.close(()=>{store.close();process.exit(0);}); process.on('SIGINT',stop); process.on('SIGTERM',stop);
}
module.exports={createLaunchpadServer,base58};
