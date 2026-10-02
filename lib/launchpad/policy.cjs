'use strict';
const { PublicKey } = require('@solana/web3.js');
const PLATFORM = 'C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function address(value) {
  try { if (typeof value !== 'string') throw 0; return new PublicKey(value).toBase58(); }
  catch { throw new AppError('Enter a valid Solana address.'); }
}
function ownerAddress(value) { const a = address(value); if (!PublicKey.isOnCurve(new PublicKey(a).toBytes())) throw new AppError('A signing wallet is required.'); return a; }
function httpsUrl(value, max = 200) {
  try {
    if (typeof value !== 'string' || value.length > max) throw 0;
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) throw 0;
    return u.href;
  } catch { throw new AppError('Use a public HTTPS metadata URL of at most 200 characters.'); }
}
function validateLaunch(input, network = 'devnet') {
  if (!input || typeof input !== 'object') throw new AppError('Launch details are required.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
  if (Buffer.byteLength(name) < 2 || Buffer.byteLength(name) > 32 || /[\x00-\x1f]/.test(name)) throw new AppError('Token name must use 2–32 UTF-8 bytes.');
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new AppError('Ticker must contain 2–10 letters or numbers.');
  if (!Number.isInteger(input.feeBps) || input.feeBps < 25 || input.feeBps > 1000) throw new AppError('Trading fee must be 0.25–10%.');
  if (![30, 60, 360, 1440].includes(input.cadenceMinutes)) throw new AppError('Choose a supported reward interval.');
  if (input.strategy !== 'creator') throw new AppError('Only creator-fee launches are enabled. Yapper payouts and other strategies are not active.', 409);
  if (input.network !== network || input.acceptNetwork !== true || input.acceptFees !== true) throw new AppError('Review and accept the selected network, permanent launch settings and fee split.');
  if (network === 'mainnet-beta' && input.acceptRealFunds !== true) throw new AppError('Mainnet spends real SOL. Explicit real-funds acknowledgement is required.');
  return { name, symbol, uri: httpsUrl(input.uri), owner: ownerAddress(input.owner), feeBps: input.feeBps, cadenceMinutes: input.cadenceMinutes, strategy: 'creator', network };
}
function units(value, decimals) {
  if (typeof value !== 'string' || !new RegExp(`^\\d{1,12}(?:\\.\\d{1,${decimals}})?$`).test(value)) throw new AppError('Enter a positive amount without exponent notation.');
  const [a,b=''] = value.split('.'); const result = BigInt(a) * 10n ** BigInt(decimals) + BigInt(b.padEnd(decimals,'0'));
  if (result <= 0n || result > 18446744073709551615n) throw new AppError('Amount is outside the supported range.');
  return result;
}
module.exports = { PLATFORM, DEVNET_GENESIS, AppError, address, ownerAddress, httpsUrl, validateLaunch, units };
