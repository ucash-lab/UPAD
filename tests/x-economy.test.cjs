'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {scanPage,progressReport}=require('../lib/launchpad/x-tracker.cjs');
const {reserveXRequest,reservationPlan}=require('../lib/launchpad/x-budget.cjs');
const {Store}=require('../lib/launchpad/store.cjs');
const {PostgresStore}=require('../lib/launchpad/postgres-store.cjs');
const {createLaunchpadServer}=require('../server/launchpad-server.js');
const mint='So11111111111111111111111111111111111111112';
const post=(id,now,text='post '+mint)=>({id,author_id:'7',text,created_at:new Date(now-60000).toISOString()});
const page=(data,next)=>({ok:true,status:200,json:async()=>({data,includes:{users:[{id:'7',username:'tester'}]},meta:{next_token:next}})});
test('rolling daily quota cannot reset at midnight or a fixed-window boundary',()=>{
  const h=3600000,history=[0,21*h,22*h,23*h,24*h-1];
  const at25=reservationPlan(history,25*h);assert.equal(at25.allowed,true);
  assert.equal(reservationPlan(at25.timestamps,26*h).allowed,false);
  assert.throws(()=>reservationPlan(['bad'],Date.now()),/budget/);
});
test('pages persist partial counts and resume the identical window; completed windows are not scanned again',async()=>{
  const store=new Store(),now=Date.now();let calls=0;
  try {
    const first=await scanPage(mint,'fake',null,async(url)=>{calls++;assert.equal(url.searchParams.get('max_results'),'10');return page([post('1',now)],'next-page');},now);
    store.saveXProgress(mint,first,progressReport(mint,first));
    assert.equal(store.leaderboard(mint).coverage.complete,false);assert.equal(store.leaderboard(mint).summary.uniqueMentions,1);
    const saved=store.xProgress(mint);
    const second=await scanPage(mint,'fake',saved,async(url)=>{calls++;assert.equal(url.searchParams.get('next_token'),'next-page');assert.equal(Date.parse(url.searchParams.get('start_time')),first.start);assert.equal(Date.parse(url.searchParams.get('end_time')),first.end);return page([post('1',now),post('2',now),post('3',now,'different '+mint)]);},now+3600000);
    const report=progressReport(mint,second);assert.equal(report.coverage.complete,true);assert.equal(report.summary.uniqueMentions,2);assert.equal(second.rows.length,3);assert.equal(report.paymentsEnabled,false);
    assert.equal(JSON.stringify(report).includes('next-page'),false);
    const third=await scanPage(mint,'fake',second,async(url)=>{calls++;assert.equal(Date.parse(url.searchParams.get('start_time')),second.end);assert.equal(url.searchParams.has('next_token'),false);return page([]);},now+7200000);
    assert.equal(third.rows.length,3);assert.equal(calls,3);
  } finally {store.close();}
});
test('expired cursors, 402, bad responses and timeouts preserve saved state without retrying',async()=>{
  const now=Date.now(),state=await scanPage(mint,'fake',null,async()=>page([post('1',now)],'next'),now),before=JSON.stringify(state);
  for(const fetcher of [async()=>({ok:false,status:402}),async()=>{throw new Error('timeout');},async()=>({ok:true,json:async()=>({errors:[{}]})})]){
    let calls=0;await assert.rejects(()=>scanPage(mint,'fake',state,async()=>{calls++;return fetcher();},now+3600000));assert.equal(calls,1);assert.equal(JSON.stringify(state),before);
  }
  let expiredCalls=0;await assert.rejects(()=>scanPage(mint,'fake',state,async()=>{expiredCalls++;},now+7*86400000),/expired/);assert.equal(expiredCalls,0);
});
test('a persisted global budget reserves ten slots, enforces five daily requests and pauses errors',async(t)=>{
  const store=new Store();let now=Date.now();t.mock.method(Date,'now',()=>now);
  try {
    await assert.rejects(()=>reserveXRequest(store,{}),/explicit approval/);
    await store.saveXStatus({http:402,checkedAt:now});
    await assert.rejects(()=>reserveXRequest(store,{approveMaxPosts:10}),/paused/);
    for(let i=0;i<5;i++){
      await reserveXRequest(store,{approveMaxPosts:10,resumePaidSearch:true},{probe:true});
      assert.equal(store.xStatus().http,202); // process failure leaves a durable pause
      await store.saveXStatus({http:200,searchAccessVerified:true,checkedAt:now});
      await assert.rejects(()=>reserveXRequest(store,{approveMaxPosts:10}),/Hourly/);
      now+=3600001;
    }
    await assert.rejects(()=>reserveXRequest(store,{approveMaxPosts:10}),/24-hour/);
    now+=86400001;await reserveXRequest(store,{approveMaxPosts:10});
  }finally{store.close();}
});
test('Postgres progress and public counts are saved together in one atomic network-scoped record',async()=>{
  const store=new PostgresStore('postgres://test:test@localhost/db','mainnet-beta');let captured;
  store.query=async(sql,args)=>{captured={sql,args};return {rows:[]};};
  try{await store.saveXProgress(mint,{updatedAt:123,cursor:'secret-cursor'},{coverage:{complete:false}});assert.match(captured.sql,/ON CONFLICT\(network,kind,id\)/);assert.equal(captured.args[0],'x-progress');assert.equal(captured.args[2].state.cursor,'secret-cursor');assert.equal(captured.args[2].report.coverage.complete,false);}finally{await store.close();}
});
test('a public refresh never spends quota; a failed approved scan pauses and keeps the partial leaderboard',async()=>{
  const store=new Store(),now=Date.now(),adminToken='a'.repeat(64);let calls=0;
  store.publish({mint,network:'devnet',name:'fixture',symbol:'T'});
  const state=await scanPage(mint,'fake',null,async()=>page([post('1',now)],'saved-page'),now-600000);
  store.saveXProgress(mint,state,progressReport(mint,state));
  const {server}=createLaunchpadServer({store,adminToken,xToken:'fake',chain:{network:async()=>({})},xFetch:async()=>{calls++;return {ok:false,status:402};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(auth,approval)=>fetch(base+'/api/launchpad/markets/'+mint+'/sync-x',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+adminToken}:{})},body:JSON.stringify(approval)});
  try{
    assert.equal((await fetch(base+'/api/launchpad/markets/'+mint+'/mentions')).status,200);assert.equal(calls,0);
    assert.equal((await request(false,{approveMaxPosts:10})).status,403);
    assert.equal((await request(true,{})).status,400);assert.equal(calls,0);
    assert.equal((await request(true,{approveMaxPosts:10})).status,503);assert.equal(calls,1);
    assert.equal(store.xStatus().http,402);assert.equal(store.xProgress(mint).cursor,'saved-page');
    assert.equal((await request(true,{approveMaxPosts:10})).status,409);assert.equal(calls,1);
    assert.equal(store.leaderboard(mint).coverage.complete,false);
  }finally{await new Promise(r=>server.close(r));store.close();}
});
