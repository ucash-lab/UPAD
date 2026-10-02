const { test } = require('node:test');
const assert = require('node:assert/strict');
const fees = require('../public/fees.js');
const holders = { holders: 10000, creator: 0, burn: 0, liquidity: 0 };
test('platform share and destination are fixed in the preview fee model', () => {
  assert.equal(fees.PLATFORM_SHARE_BPS, 2000);
  assert.equal(fees.PLATFORM_RECIPIENT, 'C1rdVXhfUe3RDNxMFrGYSHN6MpkhjTLhVaBk3ZpMJWnT');
});
test('20/80 allocation applies after protocol costs, not to trade amount', () => {
  const result = fees.calculate({ tradeUnits: 1000000000n, taxBps: 100, protocolShareBps: 2000, allocation: holders });
  assert.equal(result.tax, 10000000n);
  assert.equal(result.protocol, 2000000n);
  assert.equal(result.platform, 1600000n);
  assert.equal(result.creatorBudget, 6400000n);
  assert.equal(result.recipients.holders, 6400000n);
});
test('custom allocation divides only the creator-controlled budget', () => {
  const result = fees.calculate({ tradeUnits: 1000000000n, taxBps: 200, protocolShareBps: 2000, allocation: { holders: 5000, creator: 2500, burn: 2500, liquidity: 0 } });
  assert.equal(result.platform, 3200000n);
  assert.deepEqual(result.recipients, { holders: 6400000n, creator: 3200000n, burn: 3200000n, liquidity: 0n });
});
test('integer distribution conserves every unit including rounding dust', () => {
  const allocations = [holders, { holders: 3333, creator: 3333, burn: 3334, liquidity: 0 }, { holders: 0, creator: 0, burn: 0, liquidity: 10000 }];
  for (let i = 0; i < 250; i++) for (const allocation of allocations) {
    const result = fees.calculate({ tradeUnits: BigInt(i * 13), taxBps: 725, protocolShareBps: 2000, allocation });
    assert.equal(result.protocol + result.platform + Object.values(result.recipients).reduce((a, b) => a + b, 0n), result.tax);
    for (const key of fees.KEYS) if (allocation[key] === 0) assert.equal(result.recipients[key], 0n);
  }
});
test('invalid allocations, negative values and imprecise percentages fail closed', () => {
  for (const allocation of [{ holders: 9000, creator: 0, burn: 0, liquidity: 0 }, { holders: 10001, creator: -1, burn: 0, liquidity: 0 }, { holders: '10000', creator: 0, burn: 0, liquidity: 0 }, null]) assert.throws(() => fees.validateAllocation(allocation));
  for (const value of ['', '-1', '1.001', 'NaN', '1e2', '101', '0x10']) assert.throws(() => fees.percentToBps(value));
  assert.equal(fees.percentToBps('1.25'), 125);
  assert.equal(fees.percentToBps('100'), 10000);
  assert.throws(() => fees.calculate({ tradeUnits: -1n, taxBps: 100, protocolShareBps: 2000, allocation: holders }));
});
