const {test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../client/mobile-wallet.mjs');
test('mobile wallet support includes Android, iPhone and desktop-mode iPad',async()=>{
  const {isMobileBrowser}=await modulePromise;
  for(const userAgent of ['Mozilla Android Chrome','Mozilla iPhone Safari','Mozilla iPad Safari'])assert.equal(isMobileBrowser({userAgent}),true);
  assert.equal(isMobileBrowser({userAgent:'Mozilla Macintosh Safari',maxTouchPoints:5}),true);
  assert.equal(isMobileBrowser({userAgent:'Mozilla Macintosh Safari',maxTouchPoints:0}),false);
  assert.equal(isMobileBrowser({userAgent:'Mozilla Windows Chrome'}),false);
});
test('official wallet browse links preserve the UPAD route but never pass secret query strings',async()=>{
  const {walletBrowseLinks}=await modulePromise;
  const links=walletBrowseLinks({origin:'https://evil.example',hash:'#launch',search:'?code=secret&token=secret'});
  assert.ok(links.phantom.startsWith('https://phantom.app/ul/browse/'));
  assert.ok(links.solflare.startsWith('https://solflare.com/ul/v1/browse/'));
  for(const value of Object.values(links)){assert.match(decodeURIComponent(value),/https:\/\/www.upad.cash\/#launch/);assert.doesNotMatch(value,/secret|evil/);}
  assert.match(decodeURIComponent(walletBrowseLinks({hash:'#token?access_token=secret'}).phantom),/#markets/);
});
test('picker connects within the click stack after selection, without a delayed effect',async()=>{
  const {connectPickedWallet}=await modulePromise;const events=[];
  const adapter={name:'Mobile Wallet Adapter',connected:false,connecting:false,connect:()=>{events.push('connect');return Promise.resolve();}};
  const context={wallets:[{adapter,readyState:'Loadable'}],select:()=>events.push('select')};
  connectPickedWallet(context,adapter.name,fn=>{events.push('flush');fn();},()=>events.push('error'));
  events.push('click-ended');assert.deepEqual(events,['flush','select','connect','click-ended']);
  adapter.connecting=true;connectPickedWallet(context,adapter.name,fn=>fn(),()=>{});assert.equal(events.filter(x=>x==='connect').length,1);
});
test('missing wallet does not claim connection and user rejections are surfaced',async()=>{
  const {connectPickedWallet}=await modulePromise;let connects=0,error;
  const adapter={name:'Phantom',connect:()=>{connects++;return Promise.reject(new Error('User declined'));}};
  const choice={adapter,readyState:'NotDetected'},context={wallets:[choice],select:()=>{}};
  connectPickedWallet(context,'Phantom',fn=>fn(),e=>error=e);assert.equal(connects,0);
  choice.readyState='Installed';connectPickedWallet(context,'Phantom',fn=>fn(),e=>error=e);await Promise.resolve();assert.equal(error.message,'User declined');
});
