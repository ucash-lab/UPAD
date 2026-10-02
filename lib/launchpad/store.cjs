'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
class Store {
  constructor(filename = ':memory:', network = 'devnet') {
    this.network = network;
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, signature TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS launches (mint TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mentions (mint TEXT NOT NULL, post_id TEXT NOT NULL, author_id TEXT NOT NULL, username TEXT NOT NULL, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(mint, post_id));
      CREATE TABLE IF NOT EXISTS syncs (mint TEXT PRIMARY KEY, synced INTEGER NOT NULL, start INTEGER NOT NULL, posts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const existing=this.db.prepare("SELECT value FROM settings WHERE key='network'").get();
    const legacy=this.db.prepare('SELECT data FROM launches LIMIT 1').get();
    if ((existing && existing.value!==network) || (legacy && JSON.parse(legacy.data).network!==network)) { this.db.close(); throw new Error('Database network mismatch. Use a separate database for each Solana network.'); }
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES ('network', ?)").run(network);
  }
  create(kind, data) {
    if(data.network && data.network!==this.network)throw new Error('Intent network mismatch.');
    data={...data,network:this.network};
    // Only unsigned/partially signed transactions are persisted, never private keys.
    this.db.prepare("DELETE FROM intents WHERE created < ? AND status = 'prepared'").run(Date.now() - 86400000);
    const id = randomUUID(); this.db.prepare('INSERT INTO intents VALUES (?, ?, ?, ?, NULL, ?)').run(id, kind, JSON.stringify(data), 'prepared', Date.now());
    return this.intent(id);
  }
  intent(id) { const row = this.db.prepare('SELECT * FROM intents WHERE id = ?').get(id); return row ? { id: row.id, kind: row.kind, ...JSON.parse(row.data), status: row.status, signature: row.signature } : null; }
  artwork(id){const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get('artwork:'+id);return row?JSON.parse(row.value):null;}
  saveArtwork(data){this.db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('artwork:'+data.id,JSON.stringify(data));return this.artwork(data.id);}
  mark(id, status, signature) { this.db.prepare('UPDATE intents SET status = ?, signature = COALESCE(?,signature) WHERE id = ?').run(status, signature || null, id); }
  publish(intent) {
    if(intent.network!==this.network)throw new Error('Launch network mismatch.');
    const data = { name: intent.name, symbol: intent.symbol, uri: intent.uri, owner: intent.owner, feeBps: intent.feeBps, strategy: intent.strategy, cadenceMinutes: intent.cadenceMinutes, mint: intent.mint, pool: intent.pool, config: intent.config, signature: intent.signature, network: this.network, createdAt: Date.now() };
    this.db.prepare('INSERT OR IGNORE INTO launches VALUES (?, ?, ?)').run(data.mint, JSON.stringify(data), data.createdAt);
    return this.launch(data.mint);
  }
  launch(mint) { const row = this.db.prepare('SELECT data FROM launches WHERE mint = ?').get(mint); return row ? JSON.parse(row.data) : null; }
  launches() { return this.db.prepare('SELECT data FROM launches ORDER BY created DESC LIMIT 100').all().map(row=>JSON.parse(row.data)); }
  replaceMentions(mint, rows, start, synced = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM mentions WHERE mint=?').run(mint);
      const add = this.db.prepare('INSERT OR IGNORE INTO mentions VALUES (?, ?, ?, ?, ?, ?)');
      for (const row of rows) add.run(mint, row.id, row.authorId, row.username, row.fingerprint, row.created);
      this.db.prepare('INSERT OR REPLACE INTO syncs VALUES (?, ?, ?, ?)').run(mint, synced, start, rows.length);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  leaderboard(mint) {
    const progress=this.db.prepare('SELECT value FROM settings WHERE key=?').get('x-progress:'+mint);
    if(progress)return JSON.parse(progress.value).report;
    const sync = this.db.prepare('SELECT * FROM syncs WHERE mint=?').get(mint) || null;
    const summary = sync ? this.db.prepare('SELECT COUNT(*) AS authors, COALESCE(SUM(count),0) AS uniqueMentions FROM (SELECT COUNT(DISTINCT fingerprint) AS count FROM mentions WHERE mint=? GROUP BY author_id)').get(mint) : null;
    return { sync, summary, window: sync ? {start:sync.start,end:sync.start+86400000} : null, rows: this.db.prepare('SELECT author_id AS authorId, username, COUNT(DISTINCT fingerprint) AS count FROM mentions WHERE mint=? GROUP BY author_id ORDER BY count DESC,author_id LIMIT 100').all(mint), paymentsEnabled: false };
  }
  xStatus() { const row=this.db.prepare("SELECT value FROM settings WHERE key='x-status'").get();return row?JSON.parse(row.value):null; }
  saveXIdentity(identity) {
    const key='x-identity:'+identity.authorId;
    const old=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if(old){const saved=JSON.parse(old.value);if(saved.privyUserId!==identity.privyUserId || saved.wallet!==identity.wallet)throw new (require('./policy.cjs').AppError)('This X account already has a different reward wallet. Account recovery is required.',409);}
    this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key,JSON.stringify(identity));
  }
  xProgress(mint){const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get('x-progress:'+mint);return row?JSON.parse(row.value).state:null;}
  saveXProgress(mint,state,report){this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('x-progress:'+mint,JSON.stringify({state,report}));}
  reserveXBudget(){
    this.db.exec('BEGIN IMMEDIATE');
    try{const row=this.db.prepare("SELECT value FROM settings WHERE key='x-budget-v3'").get();const result=require('./x-budget.cjs').reservationPlan(row?JSON.parse(row.value):[]);if(result.allowed)this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('x-budget-v3',?)").run(JSON.stringify(result.timestamps));this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  allow(key,limit=30,window=60000){
    this.db.exec('BEGIN IMMEDIATE');
    try{const id='limit:'+key,now=Date.now(),row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(id);let value=row?JSON.parse(row.value):null;if(!value||value.expires<=now)value={count:0,expires:now+window};value.count++;this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(id,JSON.stringify(value));this.db.exec('COMMIT');return value.count<=limit;}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  saveXStatus(status) { this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('x-status',?)").run(JSON.stringify(status)); }
  close() { this.db.close(); }
}
module.exports = { Store };
