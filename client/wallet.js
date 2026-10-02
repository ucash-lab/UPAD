import React, { useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { LedgerWalletAdapter } from '@solana/wallet-adapter-ledger';
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase';
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust';
import { Coin98WalletAdapter } from '@solana/wallet-adapter-coin98';
import { Transaction, clusterApiUrl } from '@solana/web3.js';
import { Buffer } from 'buffer';
import '@solana/wallet-adapter-react-ui/styles.css';
import './wallet-theme.css';
import { isMobileBrowser, walletBrowseLinks, connectPickedWallet } from './mobile-wallet.mjs';

globalThis.Buffer ??= Buffer;
const h = React.createElement;
const accountListeners = new Set(), errorListeners = new Set();
let chain, root, state, showModal, currentAddress = null, openWhenReady = false;
const publish = address => { if(currentAddress === address)return; currentAddress=address;accountListeners.forEach(fn=>fn(address)); };
const report = error => errorListeners.forEach(fn=>fn(error?.message || 'Wallet connection failed. Please try again.'));
function Bridge({ intendedChain }) {
  const context = useWallet(), modal = useWalletModal();
  useEffect(() => {
    if(chain !== intendedChain)return;
    state=context;showModal=()=>modal.setVisible(true);publish(context.publicKey?.toBase58() || null);
    if(openWhenReady){openWhenReady=false;showModal();}
  }, [context, modal, intendedChain]);
  const mobile=isMobileBrowser(globalThis.navigator), links=walletBrowseLinks(globalThis.location);
  return h(React.Fragment,null,h(WalletMultiButton),mobile && !context.connected &&
    h('div',{className:'mobile-wallet-actions'},
      h('span',null,'Open UPAD in your wallet app'),
      ...[['Phantom',links.phantom],['Solflare',links.solflare]].map(([name,href])=>{
        const icon=context.wallets.find(w=>w.adapter.name===name)?.adapter.icon;
        return h('a',{key:name,href,className:'mobile-wallet-link'},icon && h('img',{src:icon,alt:'',width:20,height:20}),name);
      })));
}
function GestureBoundary({children}) {
  const context=useWallet();
  const onClickCapture=event=>{
    const button=event.target.closest?.('.wallet-adapter-modal-list .wallet-adapter-button');
    if(!button)return;
    const label=button.querySelector('img')?.alt || '';
    const name=label.endsWith(' icon')?label.slice(0,-5):null;
    if(name)connectPickedWallet(context,name,flushSync,report);
  };
  // React portal events still pass through this parent, preserving the stock picker.
  return h('div',{className:'wallet-gesture-boundary',onClickCapture},children);
}
function WalletRoot({ intendedChain }) {
  const network = intendedChain === 'solana:devnet' ? 'devnet' : 'mainnet-beta';
  // WalletProvider automatically adds Wallet Standard wallets (including late registration)
  // and Mobile Wallet Adapter where supported. These are legacy/install fallbacks only.
  const adapters = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter({network}), new CoinbaseWalletAdapter(), new TrustWalletAdapter(), new Coin98WalletAdapter(), new LedgerWalletAdapter()], [network]);
  return h(ConnectionProvider, {endpoint:clusterApiUrl(network)},
    h(WalletProvider, {wallets:adapters,autoConnect:false,onError:report,localStorageKey:'ucash.wallet-adapter.'+network},
      h(GestureBoundary,null,h(WalletModalProvider, null, h(Bridge, {intendedChain})))));
}
export function configure(next) {
  if(!['solana:mainnet','solana:devnet'].includes(next))throw new Error('Unsupported wallet network.');
  if(chain === next && root)return;
  if(chain && chain !== next){state?.disconnect().catch(report);state=null;showModal=null;publish(null);}
  chain=next;
  if(!root){
    const old=document.getElementById('connect-wallet'),mount=document.createElement('div');
    mount.id='connect-wallet';mount.className='standard-wallet-control';old.replaceWith(mount);root=createRoot(mount);
  }
  root.render(h(WalletRoot,{key:next,intendedChain:next}));
}
export const onAccount = fn => {accountListeners.add(fn);return ()=>accountListeners.delete(fn);};
export const onError = fn => {errorListeners.add(fn);return ()=>errorListeners.delete(fn);};
export const getAddress = () => currentAddress;
export function openModal(){if(!root)configure('solana:mainnet');if(!showModal){openWhenReady=true;return;}showModal();}
export async function disconnect(){await state?.disconnect();}
export async function sign(wire, owner, intendedChain) {
  if(chain !== intendedChain)throw new Error('The transaction network changed. Prepare a fresh review.');
  const selected=state;
  if(!selected?.connected || selected.publicKey?.toBase58() !== owner || !selected.signTransaction)throw new Error('Connect the signing wallet that prepared this transaction.');
  const transaction=Transaction.from(Buffer.from(wire,'base64'));
  const original=transaction.serializeMessage();
  const signed=await selected.signTransaction(transaction);
  if(!Buffer.from(signed.serializeMessage()).equals(original))throw new Error('Wallet changed the reviewed transaction. Submission stopped.');
  if(chain !== intendedChain || state?.publicKey?.toBase58() !== owner)throw new Error('Wallet or network changed while signing. Prepare a fresh review.');
  // Sign only: the existing validated server submission path broadcasts the result.
  return Buffer.from(signed.serialize()).toString('base64');
}
