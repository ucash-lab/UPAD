const {test}=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server/index.js');
test('public preview serves the launchpad and blocks source/secrets',async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  try{const home=await fetch(base+'/');assert.equal(home.status,200);assert.match(await home.text(),/UPAD/);
    assert.equal((await fetch(base+'/wallet.js?v=test')).status,200);
    for(const p of ['/.env','/package.json','/server/index.js','/assets/unknown.png'])assert.equal((await fetch(base+p)).status,404);
  }finally{await new Promise(r=>server.close(r));}
});
