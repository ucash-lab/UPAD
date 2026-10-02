export function isMobileBrowser(navigator) {
  return /Android|iPhone|iPad|iPod/i.test(navigator?.userAgent || '') ||
    (/Macintosh/i.test(navigator?.userAgent || '') && navigator?.maxTouchPoints > 1);
}
export function walletBrowseLinks(location) {
  // Never forward OAuth codes, tokens, arbitrary query strings or untrusted return URLs.
  const origin='https://www.upad.cash';
  const allowedHash=/^#(?:markets|launch|yappers|vault|setup|token\/[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  const target=origin+'/'+(allowedHash.test(location?.hash || '')?location.hash:'#markets');
  const suffix=encodeURIComponent(target)+'?ref='+encodeURIComponent(origin);
  return {phantom:'https://phantom.app/ul/browse/'+suffix,solflare:'https://solflare.com/ul/v1/browse/'+suffix};
}
// Called from the actual picker click, not a delayed effect. In particular MWA
// must start app handoff while the browser still recognizes the user's gesture.
export function connectPickedWallet(context,name,flush,report) {
  const choice=context.wallets.find(w=>w.adapter.name===name);
  if(!choice)return;
  if(!['Installed','Loadable'].includes(choice.readyState))return;
  flush(()=>context.select(name));
  if(choice.adapter.connected || choice.adapter.connecting)return;
  try {Promise.resolve(choice.adapter.connect()).catch(report);} catch(error){report(error);}
}
