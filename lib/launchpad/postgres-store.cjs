'use strict';
const {Pool} = require('pg');
const {randomUUID} = require('node:crypto');
class PostgresStore {
  constructor(connectionString, network) {
    if(!connectionString)throw new Error('Hosted database is not configured.');
    const url=new URL(connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Invalid database connection.');
    // Enforce certificate verification; do not accept insecure URL SSL overrides.
    for(const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl'])url.searchParams.delete(key);
    this.network=network;
    this.pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true},max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,query_timeout:15000,allowExitOnIdle:true});
    this.ready=null;
  }
  async init(){
    if(!this.ready)this.ready=this.pool.query(`CREATE TABLE IF NOT EXISTS ucash_lp_records(network TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, created BIGINT NOT NULL, PRIMARY KEY(network,kind,id));
      CREATE TABLE IF NOT EXISTS ucash_lp_limits(network TEXT NOT NULL,id TEXT NOT NULL,count INTEGER NOT NULL,expires BIGINT NOT NULL,PRIMARY KEY(network,id));
      CREATE TABLE IF NOT EXISTS ucash_lp_locks(network TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,expires BIGINT NOT NULL,PRIMARY KEY(network,id));`).catch(e=>{this.ready=null;throw e;});
    await this.ready;
  }
  async query(sql,args=[]){await this.init();return this.pool.query(sql,[this.network,...args]);}
  async get(kind,id){return (await this.query('SELECT data FROM ucash_lp_records WHERE network=$1 AND kind=$2 AND id=$3',[kind,id])).rows[0]?.data || null;}
  async create(kind,data){
    if(data.network&&data.network!==this.network)throw new Error('Intent network mismatch.');
    const id=randomUUID(), record={...data,network:this.network,id,kind,status:'prepared',signature:null};
    await this.query('INSERT INTO ucash_lp_records VALUES($1,$2,$3,$4,$5)',['intent',id,record,Date.now()]);return record;
  }
  intent(id){return this.get('intent',id);}
  artwork(id){return this.get('artwork',id);}
  async saveArtwork(data){await this.query('INSERT INTO ucash_lp_records VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',['artwork',data.id,data,Date.now()]);return this.artwork(data.id);}
  async mark(id,status,signature){
    // Never replace a recorded signature or regress a terminal receipt.
    const patch={status,...(signature?{signature}:{})};
    const result=await this.query(`UPDATE ucash_lp_records SET data=data || $3::jsonb WHERE network=$1 AND kind='intent' AND id=$2 AND data->>'status' NOT IN ('confirmed','failed','expired') AND ($4::text IS NULL OR data->>'signature' IS NULL OR data->>'signature'=$4) RETURNING id`,[id,JSON.stringify(patch),signature||null]);
    return result.rowCount>0;
  }
  async publish(intent){
    if(intent.network!==this.network)throw new Error('Launch network mismatch.');
    const data={};for(const k of ['name','symbol','uri','owner','feeBps','strategy','cadenceMinutes','mint','pool','config','signature'])data[k]=intent[k];
    data.network=this.network;data.createdAt=Date.now();
    await this.query('INSERT INTO ucash_lp_records VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',['launch',data.mint,data,data.createdAt]);return this.launch(data.mint);
  }
  launch(mint){return this.get('launch',mint);}
  async launches(){return (await this.query("SELECT data FROM ucash_lp_records WHERE network=$1 AND kind='launch' ORDER BY created DESC LIMIT 100")).rows.map(r=>r.data);}
  async replaceMentions(mint,rows,start,synced=Date.now()){
    const authors=new Map(),ids=new Set();
    for(const r of rows){if(ids.has(r.id))continue;ids.add(r.id);if(!authors.has(r.authorId))authors.set(r.authorId,{authorId:r.authorId,username:r.username,prints:new Set()});authors.get(r.authorId).prints.add(r.fingerprint);}
    const counts=[...authors.values()].map(r=>({authorId:r.authorId,username:r.username,count:r.prints.size})).sort((a,b)=>b.count-a.count || a.authorId.localeCompare(b.authorId));
    const report={sync:{mint,synced,start,posts:ids.size},summary:{authors:counts.length,uniqueMentions:counts.reduce((s,r)=>s+r.count,0)},window:{start,end:start+86400000},rows:counts.slice(0,100),paymentsEnabled:false};
    // A single atomic document prevents readers seeing partial windows.
    await this.query(`INSERT INTO ucash_lp_records VALUES($1,$2,$3,$4,$5) ON CONFLICT(network,kind,id) DO UPDATE SET data=EXCLUDED.data,created=EXCLUDED.created WHERE ucash_lp_records.created<=EXCLUDED.created`,['mentions',mint,report,synced]);
  }
  async leaderboard(mint){return (await this.get('x-progress',mint))?.report||await this.get('mentions',mint)||{sync:null,summary:null,window:null,rows:[],paymentsEnabled:false};}
  async xProgress(mint){return (await this.get('x-progress',mint))?.state||null;}
  async saveXProgress(mint,state,report){await this.query(`INSERT INTO ucash_lp_records VALUES($1,$2,$3,$4,$5) ON CONFLICT(network,kind,id) DO UPDATE SET data=EXCLUDED.data,created=EXCLUDED.created WHERE ucash_lp_records.created<=EXCLUDED.created`,['x-progress',mint,{state,report},state.updatedAt]);}
  async allow(key,limit=30,window=60000){
    const now=Date.now();const r=await this.query(`INSERT INTO ucash_lp_limits VALUES($1,$2,1,$3) ON CONFLICT(network,id) DO UPDATE SET count=CASE WHEN ucash_lp_limits.expires<=$4 THEN 1 ELSE ucash_lp_limits.count+1 END, expires=CASE WHEN ucash_lp_limits.expires<=$4 THEN EXCLUDED.expires ELSE ucash_lp_limits.expires END RETURNING count`,[key,now+window,now]);return r.rows[0].count<=limit;
  }
  async acquire(key,ttl=240000){const owner=randomUUID(),now=Date.now();const r=await this.query(`INSERT INTO ucash_lp_locks VALUES($1,$2,$3,$4) ON CONFLICT(network,id) DO UPDATE SET owner=EXCLUDED.owner,expires=EXCLUDED.expires WHERE ucash_lp_locks.expires<=$5 RETURNING owner`,[key,owner,now+ttl,now]);return r.rowCount?owner:null;}
  async release(key,owner){await this.query('DELETE FROM ucash_lp_locks WHERE network=$1 AND id=$2 AND owner=$3',[key,owner]);}
  xStatus(){return this.get('status','x-search');}
  async saveXIdentity(identity){
    // Atomic immutable ownership binding across all server instances.
    const r=await this.query(`INSERT INTO ucash_lp_records VALUES($1,'x-identity',$2,$3,$4)
      ON CONFLICT(network,kind,id) DO UPDATE SET data=EXCLUDED.data
      WHERE ucash_lp_records.data->>'privyUserId'=EXCLUDED.data->>'privyUserId'
      AND ucash_lp_records.data->>'wallet'=EXCLUDED.data->>'wallet' RETURNING id`,[identity.authorId,identity,Date.now()]);
    if(!r.rowCount)throw new (require('./policy.cjs').AppError)('This X account already has a different reward wallet. Account recovery is required.',409);
  }
  async reserveXBudget(){
    await this.init();const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      // One row across networks and all instances; lock it before allocating paid quota.
      await client.query("INSERT INTO ucash_lp_records VALUES ('_global','budget','x-v3','[]'::jsonb,$1) ON CONFLICT DO NOTHING",[Date.now()]);
      const row=await client.query("SELECT data FROM ucash_lp_records WHERE network='_global' AND kind='budget' AND id='x-v3' FOR UPDATE");
      const result=require('./x-budget.cjs').reservationPlan(row.rows[0].data);
      if(result.allowed)await client.query("UPDATE ucash_lp_records SET data=$1::jsonb,created=$2 WHERE network='_global' AND kind='budget' AND id='x-v3'",[JSON.stringify(result.timestamps),Date.now()]);
      await client.query('COMMIT');return result;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async saveXStatus(status){await this.query(`INSERT INTO ucash_lp_records VALUES($1,$2,$3,$4,$5) ON CONFLICT(network,kind,id) DO UPDATE SET data=EXCLUDED.data,created=EXCLUDED.created WHERE ucash_lp_records.created<=EXCLUDED.created`,['status','x-search',status,status.checkedAt]);}
  close(){return this.pool.end();}
}
module.exports={PostgresStore};
