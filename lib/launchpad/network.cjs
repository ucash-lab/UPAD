'use strict';
const { AppError } = require('./policy.cjs');
const NETWORKS = Object.freeze({
  'mainnet-beta': Object.freeze({ name: 'mainnet-beta', label: 'Solana mainnet', walletChain: 'solana:mainnet', genesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', endpoint: 'https://api.mainnet-beta.solana.com' }),
  devnet: Object.freeze({ name: 'devnet', label: 'Solana devnet', walletChain: 'solana:devnet', genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', endpoint: 'https://api.devnet.solana.com' }),
});
function getNetwork(name = process.env.SOLANA_NETWORK || 'mainnet-beta') {
  if (!Object.hasOwn(NETWORKS, name)) throw new AppError('SOLANA_NETWORK must be mainnet-beta or devnet.', 503);
  return NETWORKS[name];
}
function assertNetwork(hash, name) {
  const network = getNetwork(name);
  if (hash !== network.genesis) throw new AppError(`Network mismatch: the RPC is not verified ${network.label}. Nothing was sent.`, 503);
  return network;
}
module.exports = { NETWORKS, getNetwork, assertNetwork };
