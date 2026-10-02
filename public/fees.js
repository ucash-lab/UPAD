(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UCashFees = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PLATFORM_SHARE_BPS = 2000;
  const PLATFORM_RECIPIENT = 'C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT';
  const KEYS = ['holders', 'creator', 'burn', 'liquidity'];
  function percentToBps(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('Use a percentage with at most two decimal places.');
    const [whole, fraction = ''] = String(value).split('.');
    const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(bps) || bps > 10000) throw new Error('Percentage must be between 0 and 100.');
    return bps;
  }
  function validateAllocation(allocation) {
    if (!allocation || KEYS.some(key => !Number.isInteger(allocation[key]) || allocation[key] < 0 || allocation[key] > 10000)) throw new Error('Each allocation must be a valid percentage.');
    if (KEYS.reduce((sum, key) => sum + allocation[key], 0) !== 10000) throw new Error('The creator-controlled allocation must total 100%.');
  }
  // Integer accounting only. Remainders go to the largest fractional claims;
  // ties follow KEYS order, so retrying a calculation always gives the same result.
  function distribute(amount, allocation) {
    validateAllocation(allocation);
    const rows = KEYS.map(key => ({ key, amount: amount * BigInt(allocation[key]) / 10000n, remainder: amount * BigInt(allocation[key]) % 10000n }));
    let dust = amount - rows.reduce((sum, row) => sum + row.amount, 0n);
    const ranked = rows.slice().sort((a, b) => a.remainder === b.remainder ? KEYS.indexOf(a.key) - KEYS.indexOf(b.key) : a.remainder > b.remainder ? -1 : 1);
    for (let i = 0; dust > 0n; i++, dust--) ranked[i].amount++;
    return Object.fromEntries(rows.map(row => [row.key, row.amount]));
  }
  function calculate({ tradeUnits, taxBps, protocolShareBps, allocation }) {
    if (typeof tradeUnits !== 'bigint' || tradeUnits < 0n) throw new Error('Trade amount must be a non-negative integer.');
    for (const rate of [taxBps, protocolShareBps]) if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw new Error('Invalid fee rate.');
    validateAllocation(allocation);
    const tax = tradeUnits * BigInt(taxBps) / 10000n;
    const protocol = tax * BigInt(protocolShareBps) / 10000n;
    const distributable = tax - protocol;
    const platform = distributable * BigInt(PLATFORM_SHARE_BPS) / 10000n;
    const creatorBudget = distributable - platform;
    return { tax, protocol, distributable, platform, creatorBudget, recipients: distribute(creatorBudget, allocation) };
  }
  return Object.freeze({ PLATFORM_SHARE_BPS, PLATFORM_RECIPIENT, KEYS, percentToBps, validateAllocation, calculate });
});
