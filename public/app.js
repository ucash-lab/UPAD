import * as wallet from './wallet.js?v=546c45609408';
import { renderYapperReport } from './yappers.js';
import { installIcons } from './icons.js';
import { prepareImage } from './artwork.js';
installIcons();
const $ = id => document.getElementById(id);
const PLATFORM = 'C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT';
let markets = [], health = null, pending = null, toastTimer, checking = false;
let selectedArtwork=null,artworkVersion=0;
const node = (tag,text='',className='') => {const e=document.createElement(tag);e.textContent=text;e.className=className;return e;};
function link(text,href,className=''){const e=node('a',text,className);e.href=href;if(href.startsWith('https:')){e.target='_blank';e.rel='noopener noreferrer';}return e;}
function button(text,fn,className='button subtle'){const e=node('button',text,className);e.type='button';e.addEventListener('click',fn);return e;}
function error(id,message){$(id).textContent=message || '';$(id).hidden=!message;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
const short=a=>a ? a.slice(0,5)+'…'+a.slice(-5) : '';
const sol=u=>(Number(u)/1e9).toLocaleString(undefined,{maximumFractionDigits:9});
function tokenArtwork(m){if(!/^https:\/\/www\.upad\.cash\/api\/launchpad\/metadata\/[a-f0-9]{32}$/.test(m.uri||''))return null;const img=node('img');img.src=m.uri.replace('/metadata/','/artwork/');img.alt=m.name+' token artwork';img.width=56;img.height=56;img.loading='lazy';img.className='token-artwork';return img;}
const networkLabel=()=>health?.networkLabel || 'Network not verified';
const currency=()=>health?.mainnetEnabled?'SOL':'test SOL';
const explorer=(kind,id)=>`https://explorer.solana.com/${kind}/${encodeURIComponent(id)}${health?.network==='devnet'?'?cluster=devnet':''}`;
async function api(path,options={}){
  const response=await fetch('/api/launchpad/'+path,{...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error || 'Request failed.');return data;
}
const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
function empty(title,copy,action){const e=node('div','','empty');e.append(node('span','✦','empty-orb'),node('h3',title),node('p',copy));if(action)e.append(action);return e;}
function facts(entries){const dl=node('dl');for(const [key,value] of entries){const row=node('div');row.append(node('dt',key),node('dd',String(value)));dl.append(row);}return dl;}
const receiptKey=()=>health?.network==='devnet'?'ucash.launchpad.receipts.v1':'ucash.launchpad.receipts.mainnet.v1';
function receipts(){if(!health)return [];try{const data=JSON.parse(localStorage.getItem(receiptKey()) || '[]');return Array.isArray(data)?data.filter(x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)).slice(-30):[];}catch{return [];}}
function remember(id){try{localStorage.setItem(receiptKey(),JSON.stringify([...new Set([...receipts(),id])].slice(-30)));}catch{toast('Receipt storage is unavailable. Keep your transaction link.');}}
function renderNetwork(){
  document.querySelectorAll('[data-network-label]').forEach(e=>e.textContent=networkLabel());
  $('hero-network').textContent='Wallet-signed launches · '+networkLabel();
  $('network-acceptance').textContent=`I accept the permanent settings on ${networkLabel()}: 1 billion tokens, 6 decimals, 10 SOL graduation threshold, 20% of supply at graduation, and permanently locked 20/80 migration liquidity positions. Review these before signing.`;
  $('real-funds-check').hidden=!health?.mainnetEnabled;form.elements.acceptRealFunds.required=Boolean(health?.mainnetEnabled);
  $('review-warning').textContent=health?.mainnetEnabled?'MAINNET: your signature can spend real SOL on fees, rent and trades. This integration has not completed an end-to-end funded test or independent security review. Inspect your wallet simulation.':'Devnet uses test SOL. Inspect the network and transaction in your wallet.';
  $('prepare-launch').disabled=!health?.rpc.ready;
  renderMarkets();
}
async function checkHealth(){
  if(checking)return;checking=true;$('network-status').textContent='Checking the launch service…';
  try{const next=await api('health');if(health && health.network!==next.network){pending=null;$('review-dialog').close();form.elements.acceptNetwork.checked=false;form.elements.acceptRealFunds.checked=false;}health=next;wallet.configure(health.walletChain);$('network-status').textContent=health.rpc.ready?(health.mainnetEnabled?'Mainnet connected · real SOL · end-to-end test pending':'Devnet connected · test SOL only'):'RPC unavailable · transactions paused';$('network-dot').classList.toggle('ready',health.rpc.ready);renderNetwork();}
  catch{health=null;$('network-status').textContent='Launch service unavailable · transactions paused; try checking again';$('network-dot').classList.remove('ready');}
  finally{checking=false;renderReadiness();$('prepare-launch').disabled=!health?.rpc.ready;}
}
function renderReadiness(){
  const entries=[['Launch backend',health?'Connected':'Offline','Persistent network-separated records and validated wallet signatures.'],[networkLabel(),health?.rpc.ready?'Connected':'Unavailable','Genesis hash and launch program checked against the selected network.'],['RPC connection',health?.privateRpcConfigured?'Custom endpoint':'Public Solana RPC','No provider account required. Shared RPC may time out or rate-limit requests.'],['Wallet',wallet.getAddress()?'Connected':'Connect wallet','Your wallet must have SOL on the displayed network.'],['Creator / platform fees','Implemented','20/80 after protocol fees; signed claims, not automatic payments.'],['Exact-CA X tracking',health?.xTrackingConfigured?'Configured':'Needs API access','Small approved scans with saved progress, explicit coverage and shared budget limits.'],['Yapper payments','Disabled','Needs approved X use, identity-to-wallet verification and a reviewed distributor.'],['Graduated-pool trading','Integrated · unverified live','DAMM v2 quotes and wallet-owned fee claims. Migration uses Meteora’s service.'],['Production verification','Incomplete','Funded launch → buy → sell → fee claims → graduation test and security review still required.']];
  $('readiness').replaceChildren(...entries.map(([title,status,copy])=>{const e=node('div','','readiness-row'),body=node('div',title);body.append(node('small',copy));e.append(body,node('span',status,'pill'));return e;}));
  $('tracking-status').textContent=health?.xSearchAccessVerified?`X access last verified${health.xLastCheckedAt?' · '+new Date(health.xLastCheckedAt).toLocaleString():''}. Saved counts appear after each approved scan. Partial coverage is labeled; payouts are not enabled.`:health?.xLastCheckHttp&&health.xLastCheckHttp!==200?'Paid X searches are paused. The operator must review access/billing and explicitly approve a small recheck. Previously saved counts remain available; refreshing does not spend X credits.':health?.xTrackingConfigured?'X is configured. Counts need an approved scan; there are no automatic paid searches or payouts.':'X tracking needs private API configuration and an approved scan.';
  $('tracking-budget').textContent=health?.xBudget?'Budget protection: at most 10 posts per approved request, 1 request per hour and 5 requests per rolling 24 hours across the launchpad. Refresh only reads saved counts. No automatic scans.':'Checking tracking budget…';
}
function renderMarkets(){
  const q=$('market-search').value.trim().toLowerCase();const list=markets.filter(m=>[m.name,m.symbol,m.mint].some(x=>x.toLowerCase().includes(q)));
  $('market-count').textContent=`${markets.length} confirmed ${markets.length===1?'launch':'launches'}`;
  $('market-list').replaceChildren(...list.map(m=>{const a=link('',`#token/${m.mint}`,'token-card');const top=node('div','','mini-token'),identity=node('div');identity.append(node('h3',m.name),node('p','$'+m.symbol+' / SOL'));top.append(node('span',m.symbol[0]),identity);const bottom=node('div','','card-bottom');bottom.append(node('span',m.network==='mainnet-beta'?'Mainnet':'Devnet','pill'),node('span','Open market ↗'));a.append(top,node('p',short(m.mint)),node('span',`${m.feeBps/100}% trading fee`,'pill'),bottom);return a;}));
  if(!list.length)$('market-list').append(empty(q?'Nothing matches that search.':'Your next idea could be first.',q?'Try a different name, ticker or contract address.':'Only chain-confirmed UCash launches appear here. Connect your wallet and review the launch settings to create one.',link('Open launch studio ↗','#launch','button subtle')));
  const selected=$('tracker-token').value;$('tracker-token').replaceChildren(...markets.map(m=>{const o=node('option',m.name+' · $'+m.symbol);o.value=m.mint;return o;}));
  if(!markets.length){const o=node('option','No confirmed tokens yet');o.value='';$('tracker-token').append(o);}else if(markets.some(m=>m.mint===selected))$('tracker-token').value=selected;
  $('market-list').querySelectorAll('.token-card').forEach((card,i)=>{const art=tokenArtwork(list[i]);if(art)card.querySelector('.mini-token>span')?.replaceWith(art);});
}
async function loadMarkets(){try{markets=(await api('markets')).markets;renderMarkets();}catch(e){$('market-count').textContent='Unavailable';$('market-list').replaceChildren(empty('The launch service is not connected.',e.message,link('Check readiness ↗','#setup','button subtle')));}}
function openWallet(){try{wallet.openModal();}catch(e){toast(e.message);}}
wallet.onError(toast);
wallet.onAccount(()=>{const a=wallet.getAddress();renderReadiness();loadVault();if(location.hash.startsWith('#token/'))loadToken(location.hash.split('/')[1]);if(pending&&pending.owner!==a){pending=null;$('review-dialog').close();}});
$('connect-wallet').onclick=openWallet;
// Wallet discovery must not depend on RPC health or the backend finishing its request.
wallet.configure('solana:mainnet');
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
function requireWallet(){if(!health?.rpc.ready)throw new Error('Network verification is not ready. Check launch readiness first.');if(!wallet.getAddress()){openWallet();throw new Error('Connect your wallet before preparing a transaction.');}return wallet.getAddress();}
function review(intent){pending=intent;error('review-error','');$('review-title').textContent=intent.kind==='launch'?'Your token, ready for review.':intent.kind==='trade'?'Check your trade.':'Claim your earned fees.';
  if(intent.network!==health?.network || intent.walletChain!==health?.walletChain)throw new Error('Prepared transaction network does not match the displayed network.');
  const rows=[['Network',networkLabel()],['Signing wallet',intent.owner],['Simulation',intent.simulated?'Passed':'Not verified'],['Network fee',intent.estimatedNetworkFeeLamports==null?'Unavailable':sol(intent.estimatedNetworkFeeLamports)+' '+currency()],['Priority fee (included)',sol(intent.priorityFeeLamports||0)+' '+currency()]];
  if(intent.estimatedWalletDebitLamports!=null)rows.push(['Simulated wallet debit',sol(intent.estimatedWalletDebitLamports)+' '+currency()+' (estimate; inspect wallet)']);
  if(intent.kind==='launch') rows.push(['Token',intent.name+' / '+intent.symbol],['Contract address',intent.mint],['Buy / sell fee',intent.feeBps/100+'%'],['After-protocol split','20% UCash / 80% creator'],['Permanent settings','1B supply · 10 SOL graduation · 20/80 locked positions'],['Account rent','Additional to network fee; included in simulated debit when available']);
  if(intent.kind==='trade')rows.push(['Action',intent.side],['Minimum received',intent.minimumAmountOut+' atomic units'],['Quote expires','About 90 seconds; chain expiry may be sooner']);
  if(intent.kind==='claim')rows.push(['Destination',intent.owner],['Asset','Accrued pool fees'],['Venue',intent.venue==='damm-v2'?'Graduated DAMM v2 position':'Bonding curve']);
  $('review-content').replaceChildren(facts(rows));$('sign-transaction').disabled=false;$('review-dialog').showModal();
}
const form=$('launch-form');
$('token-image').onchange=async()=>{const version=++artworkVersion;selectedArtwork=null;error('launch-error','');$('artwork-preview').hidden=true;$('artwork-status').textContent='Preparing image…';try{const prepared=await prepareImage(form.elements.artwork.files[0]);if(version!==artworkVersion)return;selectedArtwork=prepared;$('artwork-preview').src=prepared.preview;$('artwork-preview').hidden=false;$('artwork-status').textContent='Image ready. It will be saved with your token details before wallet review.';}catch(e){if(version===artworkVersion){error('launch-error',e.message);$('artwork-status').textContent='Choose another image.';}}};
function preview(){const name=form.elements.name.value.trim(),symbol=form.elements.symbol.value.trim().toUpperCase();$('token-name').textContent=name||'Your next big idea';$('token-symbol').textContent='$'+(symbol||'TICKER')+' / SOL';$('token-initial').textContent=symbol[0]||'U';const fee=Number(form.elements.fee.value);$('fee-example').replaceChildren(...facts([['Trading fees',`${(10*fee).toFixed(2)} SOL`],['Protocol example',`${(2*fee).toFixed(2)} SOL`],['UCash platform',`${(1.6*fee).toFixed(2)} SOL`],['Creator budget',`${(6.4*fee).toFixed(2)} SOL`]]).children);}
form.addEventListener('input',preview);$('platform-address').textContent=PLATFORM;preview();
form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;const btn=$('prepare-launch');btn.disabled=true;error('launch-error','');try{
  const owner=requireWallet();if(!selectedArtwork)throw new Error('Choose your token image and wait for it to finish preparing.');
  const raw=form.elements.fee.value;if(!/^\d+(?:\.\d{1,2})?$/.test(raw))throw new Error('Use a fee with at most two decimals.');
  const details={owner,name:form.elements.name.value.trim(),symbol:form.elements.symbol.value.trim().toUpperCase(),description:form.elements.description.value};
  const launch={...details,feeBps:Math.round(Number(raw)*100),cadenceMinutes:Number(form.elements.cadence.value),strategy:'creator',network:health.network,acceptNetwork:form.elements.acceptNetwork.checked,acceptRealFunds:form.elements.acceptRealFunds.checked,acceptFees:form.elements.acceptFees.checked};
  btn.textContent='Saving token image…';const uploaded=await post('artwork',{...details,image:selectedArtwork.image,type:selectedArtwork.type});
  $('artwork-status').textContent='Artwork and token details saved. Hosted by UPAD; no third-party storage account required.';
  if(wallet.getAddress()!==owner)throw new Error('Your wallet changed. Review the launch again.');
  btn.textContent='Preparing & simulating…';const intent=await post('launch/prepare',{...launch,artworkId:uploaded.id});review(intent);
}catch(e){error('launch-error',e.message);}finally{btn.disabled=!health?.rpc.ready;btn.textContent='Review launch transaction ↗';}};
async function pollReceipt(id){for(let i=0;i<15;i++){const intent=await api('intents/'+id);if(intent.status==='confirmed'){toast('Transaction confirmed on '+networkLabel()+'.');await loadMarkets();await loadVault();if(intent.kind==='launch')location.hash='token/'+intent.mint;return;}if(['failed','expired'].includes(intent.status))throw new Error('Transaction '+intent.status+'. Inspect its explorer receipt before preparing another action.');await new Promise(r=>setTimeout(r,2500));}toast('Confirmation is still pending. Check Fees & receipts before retrying.');await loadVault();}
$('sign-transaction').onclick=async()=>{if(!pending)return;const intent=pending;const btn=$('sign-transaction');btn.disabled=true;error('review-error','');try{if(Date.now()>intent.expiresAt)throw new Error('Review expired. Close this window and prepare a fresh transaction.');if(intent.network!==health?.network)throw new Error('Network changed. Prepare a fresh review.');const signedTransaction=await wallet.sign(intent.transaction,intent.owner,intent.walletChain);remember(intent.id);const response=await post('submit',{id:intent.id,signedTransaction});$('review-dialog').close();pending=null;toast(response.notice||'Submitted to '+networkLabel()+'. Waiting for confirmation…');await pollReceipt(intent.id);}catch(e){if($('review-dialog').open)error('review-error',e.message);else toast(e.message);}finally{btn.disabled=false;}};
async function loadVault(){const a=wallet.getAddress();$('wallet-summary').replaceChildren(node('h3',a?'Your connected wallet':'Your wallet is not connected.'));if(a){$('wallet-summary').append(node('code',a));try{const b=await api('balance?owner='+encodeURIComponent(a));$('wallet-summary').append(node('p',sol(b.lamports)+' '+currency(),'muted'));}catch{$('wallet-summary').append(node('p','Balance unavailable. Check RPC status.','muted'));}}
  const box=$('receipt-list');box.replaceChildren();for(const id of receipts().reverse()){try{const r=await api('intents/'+id);const row=node('div',r.kind+' · '+r.status,'receipt');if(r.signature)row.append(link('View transaction ↗',explorer('tx',r.signature)));else row.append(node('small','No transaction signature has been recorded.'));row.append(button('Check confirmation',()=>pollReceipt(id).catch(e=>toast(e.message))));box.append(row);}catch{box.append(node('p','A saved receipt is unavailable from this server.','muted'));}}
}
let yapperRequest = 0;
async function loadYappers(){
  const request = ++yapperRequest, mint = $('tracker-token').value;
  if(!mint){$('leaderboard').replaceChildren(empty('A conversation starts with a token.','Launch a token first. No sample authors or scores are shown.'));return;}
  $('leaderboard').replaceChildren(node('p','Loading saved X counts…','muted'));
  try { const data = await api(`markets/${mint}/mentions`); if(request !== yapperRequest || $('tracker-token').value !== mint)return; renderYapperReport($('leaderboard'),mint,data); }
  catch(e){if(request === yapperRequest)$('leaderboard').replaceChildren(node('p',e.message,'error'));}
}
async function loadToken(mint){const target=$('token-detail');target.replaceChildren(node('p','Reading the verified pool…','muted'));try{if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))throw new Error('Invalid token address.');const owner=wallet.getAddress(),m=await api(`markets/${mint}`+(owner?'?owner='+encodeURIComponent(owner):''));if(location.hash!=='#token/'+mint)return;target.replaceChildren();const title=node('div','','detail-heading');title.append(node('h1',m.name+' · $'+m.symbol),node('span',m.migrated?'Graduated':'Bonding curve','pill'));target.append(title,node('p',mint,'detail-address'));
  const grid=node('div','','trade-grid'),info=node('div','','panel');info.append(facts([[m.migrated?'Final curve reserve':'Quote reserve',sol(m.quoteReserve)+' '+currency()],['Curve creator claimable',sol(m.creatorClaimable)+' '+currency()],['Curve platform claimable',sol(m.platformClaimable)+' '+currency()],['Trading fee',m.feeBps/100+'%'],['Your token balance',m.tokenBalance===null?'Connect wallet':(Number(m.tokenBalance)/1e6).toLocaleString()]]),link('Inspect trading pool ↗',explorer('address',m.graduated?.pool||m.pool),'button subtle'));
  for(const role of ['creator','platform'])if(role==='creator'?owner===m.owner:owner===PLATFORM)info.append(button(role==='creator'?'Claim creator fees':'Claim platform fees',async()=>{try{review(await post(`markets/${mint}/claim`,{owner:requireWallet(),role}));}catch(e){toast(e.message);}},'button primary'));
  if(m.graduated){info.append(node('h3','Your graduated fee positions'),node('p','Fees follow position ownership. Added liquidity can change each position’s share of total pool fees.','muted'));for(const p of m.graduated.positions){info.append(node('p',short(p.address)+' · '+sol(p.quoteClaimable)+' '+currency()),button('Claim position fees',async()=>{try{review(await post(`markets/${mint}/claim`,{owner:requireWallet(),position:p.address}));}catch(e){toast(e.message);}}));}if(!m.graduated.positions.length)info.append(node('p',owner?'No fee position owned by this wallet.':'Connect your wallet to load its fee positions.','muted'));}
  const trade=node('form','','panel'),sideLabel=node('label','Trade'),side=node('select'),amountLabel=node('label','Amount'),amount=node('input'),slipLabel=node('label','Slippage'),slip=node('select');for(const [v,t] of [['buy','Buy with SOL'],['sell','Sell token']]){const o=node('option',t);o.value=v;side.append(o);}amount.inputMode='decimal';amount.required=true;amount.placeholder='0.01';for(const [v,t] of [['50','0.5%'],['100','1%'],['300','3%']]){const o=node('option',t);o.value=v;slip.append(o);}sideLabel.append(side);amountLabel.append(amount);slipLabel.append(slip);const submit=node('button','Review trade ↗','button primary wide');submit.type='submit';submit.disabled=m.graduationPending;trade.append(node('h2','A little trade.'),node('p',m.migrated?'DAMM v2 · graduated pool':'Meteora bonding curve','muted'),sideLabel,amountLabel,slipLabel,submit);if(m.graduationPending)trade.append(node('p','Graduation threshold reached. Trading resumes when Meteora completes migration.','notice'),link('Open Meteora migrator ↗','https://migrator.meteora.ag','button subtle'));trade.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{review(await post(`markets/${mint}/trade`,{owner:requireWallet(),side:side.value,amount:amount.value,slippageBps:Number(slip.value)}));}catch(e){toast(e.message);}finally{submit.disabled=m.graduationPending;}};grid.append(info,trade);target.append(grid);
}catch(e){target.replaceChildren(node('p',e.message,'error'));}}
function route(){const raw=location.hash.slice(1)||'markets';const [key,mint]=raw.split('/');const page=['markets','launch','token','yappers','vault','setup'].includes(key)?key:'markets';document.querySelectorAll('[data-page]').forEach(e=>e.hidden=e.dataset.page!==page);document.querySelectorAll('[data-nav]').forEach(e=>{e.classList.toggle('active',e.dataset.nav===page);if(e.dataset.nav===page)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});if(page==='yappers')loadYappers();if(page==='vault')loadVault();if(page==='token')loadToken(mint);}
$('market-search').oninput=renderMarkets;$('refresh-markets').onclick=loadMarkets;$('check-health').onclick=checkHealth;$('refresh-yappers').onclick=loadYappers;$('tracker-token').onchange=loadYappers;window.addEventListener('hashchange',route);route();renderReadiness();Promise.all([checkHealth(),loadMarkets()]).then(()=>{if(location.hash==='#yappers')loadYappers();});
