'use strict';
const {Chain}=require('../lib/launchpad/chain.cjs');
const {PostgresStore}=require('../lib/launchpad/postgres-store.cjs');
const {getNetwork}=require('../lib/launchpad/network.cjs');
const {createLaunchpadServer}=require('./launchpad-server.js');
let service;
module.exports=async(req,res)=>{
  try {
    if(!service){
      const network=getNetwork();
      // Exact aliases verified on this Vercel project; never trust a request-supplied host.
      const hosts=[process.env.VERCEL_URL,process.env.VERCEL_PROJECT_PRODUCTION_URL,process.env.UCASH_PUBLIC_HOST,'ucash-launchpad.vercel.app','upad.cash','www.upad.cash'].filter(h=>h&&/^[a-z0-9.-]+$/.test(h));
      if(!hosts.length)throw new Error('Host is not configured.');
      const store=new PostgresStore(process.env.DATABASE_URL,network.name);
      service=createLaunchpadServer({chain:new Chain(undefined,network.name),store,publicHosts:hosts,xToken:process.env.X_BEARER_TOKEN});
    }
    const url=new URL(req.url,'https://localhost');
    const route=url.searchParams.get('ucashRoute');
    if(route!==null){url.searchParams.delete('ucashRoute');url.pathname='/api/launchpad/'+route;req.url=url.pathname+url.search;}
    if(!req.url.startsWith('/api/launchpad/')){res.statusCode=404;return res.end('Not found');}
    return await service.server.listeners('request')[0](req,res);
  }catch{
    res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Launch service configuration is unavailable. No transaction was submitted.'}));
  }
};
