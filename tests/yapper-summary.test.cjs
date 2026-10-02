'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Store} = require('../lib/launchpad/store.cjs');
test('yapper totals cover all authors, not just the top 100 displayed', () => {
  const store = new Store();
  try {
    assert.equal(store.leaderboard('mint').summary, null);
    const rows = Array.from({length:105},(_,i)=>({id:String(i),authorId:String(i),username:'user'+i,fingerprint:'post'+i,created:1}));
    rows.push({...rows[0],id:'extra'});
    store.replaceMentions('mint',rows,1000,90000000);
    const result = store.leaderboard('mint');
    assert.equal(result.rows.length,100);
    assert.equal(result.summary.authors,105);
    assert.equal(result.summary.uniqueMentions,105);
    assert.equal(result.window.end,86401000);
    assert.equal(result.paymentsEnabled,false);
    store.replaceMentions('mint',[],1000);
    assert.equal(store.leaderboard('mint').summary.uniqueMentions,0);
  } finally {store.close();}
});
