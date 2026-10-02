'use strict';
const { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, ComputeBudgetProgram } = require('@solana/web3.js');
const { NATIVE_MINT, getMint, getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const { DynamicBondingCurveClient, buildCurve, deriveDbcPoolAddress, DYNAMIC_BONDING_CURVE_PROGRAM_ID } = require('@meteora-ag/dynamic-bonding-curve-sdk');
const BN = require('bn.js');
const crypto = require('node:crypto');
const { PLATFORM, AppError, ownerAddress, units } = require('./policy.cjs');
const { getNetwork, assertNetwork } = require('./network.cjs');
const { GraduatedPools } = require('./graduated.cjs');

function curveConfig(feeBps) {
  return buildCurve({
    token: { tokenType: 0, tokenBaseDecimal: 6, tokenQuoteDecimal: 9, tokenAuthorityOption: 1, totalTokenSupply: 1_000_000_000, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: 0, feeSchedulerParam: { startingFeeBps: feeBps, endingFeeBps: feeBps, numberOfPeriod: 0, totalDuration: 0 } }, dynamicFeeEnabled: false, collectFeeMode: 0, creatorTradingFeePercentage: 80, poolCreationFee: 0, enableFirstSwapWithMinFee: false },
    migration: { migrationOption: 1, migrationFeeOption: 6, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 }, migratedPoolFee: { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: feeBps, compoundingFeeBps: 0 } },
    liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 20, creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 80 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: 1, percentageSupplyOnMigration: 20, migrationQuoteThreshold: 10,
  });
}
function messageHash(tx) { return crypto.createHash('sha256').update(tx.serializeMessage()).digest('hex'); }
function toWire(tx) { return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'); }
function verifySigned(wire, intent) {
  if (typeof wire !== 'string' || wire.length > 1800 || !/^[A-Za-z0-9+/]+=*$/.test(wire)) throw new AppError('Invalid signed transaction.');
  let tx; try { tx = Transaction.from(Buffer.from(wire, 'base64')); } catch { throw new AppError('Invalid signed transaction.'); }
  if (messageHash(tx) !== intent.messageHash || tx.feePayer?.toBase58() !== intent.owner || !tx.verifySignatures()) throw new AppError('Transaction or wallet signature does not match the reviewed action.', 403);
  return tx;
}
class Chain {
  constructor(endpoint, network = process.env.SOLANA_NETWORK || 'mainnet-beta') {
    this.networkInfo = getNetwork(network); this.networkName = network;
    endpoint = endpoint || process.env.SOLANA_RPC_URL || this.networkInfo.endpoint;
    const rpcUrl = new URL(endpoint);
    if (rpcUrl.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(rpcUrl.hostname)) throw new AppError('A remote RPC must use HTTPS.',503);
    this.privateRpcConfigured = !['api.mainnet-beta.solana.com','api.mainnet.solana.com','api.devnet.solana.com'].includes(rpcUrl.hostname);
    this.connection = new Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(18000) }) });
    this.client = new DynamicBondingCurveClient(this.connection, 'confirmed');
    this.graduated = new GraduatedPools(this.connection);
  }
  async network() {
    if (this.verifiedAt && Date.now()-this.verifiedAt<10000) return this.verifiedNetwork;
    assertNetwork(await this.connection.getGenesisHash(), this.networkName);
    const program = await this.connection.getAccountInfo(DYNAMIC_BONDING_CURVE_PROGRAM_ID);
    if (!program?.executable) throw new AppError('Meteora DBC is unavailable on the selected network.', 503);
    this.verifiedAt=Date.now();
    this.verifiedNetwork={ network: this.networkName, program: DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58() };
    return this.verifiedNetwork;
  }
  async finalize(tx, owner, signers = []) {
    const latest = await this.connection.getLatestBlockhash('confirmed');
    tx.feePayer = new PublicKey(owner); tx.recentBlockhash = latest.blockhash;
    // Explicit capped priority fee: 6,000 lamports on mainnet, zero on devnet.
    tx.instructions = tx.instructions.filter(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }));
    if (this.networkName === 'mainnet-beta') tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));
    if (signers.length) tx.partialSign(...signers);
    let wire;
    try { wire = toWire(tx); } catch (e) {
      if (/too large|overrun/i.test(e.message)) throw new AppError('The launch packet is too large. Use a shorter metadata URL (100 characters or fewer recommended). No transaction was sent.');
      throw e;
    }
    return { transaction: wire, messageHash: messageHash(tx), owner, network: this.networkName, walletChain: this.networkInfo.walletChain, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, expiresAt: Date.now() + 90000, bytes: Buffer.from(wire,'base64').length, priorityFeeLamports: this.networkName === 'mainnet-beta' ? 6000 : 0 };
  }
  async simulate(prepared, action) {
    const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
    const result = await this.connection.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64')), { sigVerify: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [prepared.owner] } });
    if (result.value.err) {
      const shortage=(result.value.logs||[]).join('\n').match(/insufficient lamports (\d+), need (\d+)/i);
      if(shortage)throw new AppError(`Not enough SOL for ${action.toLowerCase()}. This account-creation or transfer step needs ${(Number(shortage[2])/1e9).toFixed(9)} SOL; ${(Number(shortage[1])/1e9).toFixed(9)} SOL remains at that step. Other account rent and network fees may also apply. Fund the signing wallet and review again. No transaction was sent.`,409);
      throw new AppError(`${action} simulation failed (${JSON.stringify(result.value.err).slice(0,180)}). Check wallet SOL, token balance and current pool state. No transaction was sent.`, 409);
    }
    const fee = await this.connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
    if (fee.value === null) throw new AppError('Transaction expired during fee estimation. Prepare it again.',409);
    const after = result.value.accounts?.[0]?.lamports;
    const before = typeof after === 'number' ? await this.connection.getBalance(new PublicKey(prepared.owner), 'confirmed') : null;
    return { ...prepared, estimatedNetworkFeeLamports: fee.value, estimatedWalletDebitLamports: before === null ? null : Math.max(0, before - after), simulated: true };
  }
  async prepareLaunch(data) {
    await this.network();
    if (data.network !== this.networkName) throw new AppError('Launch network no longer matches the server.',409);
    const config = Keypair.generate(), mint = Keypair.generate(), owner = new PublicKey(data.owner);
    const tx = await this.client.partner.createConfigAndPool({ ...curveConfig(data.feeBps), payer: owner, config: config.publicKey, feeClaimer: new PublicKey(PLATFORM), leftoverReceiver: owner, quoteMint: NATIVE_MINT, preCreatePoolParam: { name: data.name, symbol: data.symbol, uri: data.uri, poolCreator: owner, baseMint: mint.publicKey } });
    const prepared = await this.finalize(tx, data.owner, [config, mint]);
    return { ...await this.simulate(prepared,'Launch'), mint: mint.publicKey.toBase58(), config: config.publicKey.toBase58(), pool: deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, config.publicKey).toBase58() };
  }
  async validatePool(launch) {
    if (launch.network !== this.networkName) throw new AppError('This market belongs to a different Solana network.',409);
    const pool = await this.client.state.getPool(launch.pool);
    const state = pool?.poolState;
    if (!state || state.baseMint.toBase58() !== launch.mint || state.config.toBase58() !== launch.config || state.creator.toBase58() !== launch.owner) throw new AppError('Pool identity could not be verified.', 409);
    const config = await this.client.state.getPoolConfig(launch.config);
    if (!config || config.feeClaimer.toBase58() !== PLATFORM || config.creatorTradingFeePercentage !== 80 || config.quoteMint.toBase58() !== NATIVE_MINT.toBase58()) throw new AppError('Pool fee routing does not match UCash.', 409);
    return { state, config };
  }
  async confirmLaunch(launch) {
    await this.network(); await this.validatePool(launch);
    const mint = await getMint(this.connection, new PublicKey(launch.mint));
    if (mint.mintAuthority !== null || mint.freezeAuthority !== null || mint.decimals !== 6) throw new AppError('Mint authority checks failed.', 409);
    return true;
  }
  async market(launch, wallet) {
    await this.network();
    const { state, config } = await this.validatePool(launch);
    const fees = await this.client.state.getPoolFeeMetrics(launch.pool);
    let tokenBalance = null;
    if (wallet) {
      const ata = await getAssociatedTokenAddress(new PublicKey(launch.mint), new PublicKey(ownerAddress(wallet)));
      try { tokenBalance = (await getAccount(this.connection, ata)).amount.toString(); } catch (e) { if (e.name === 'TokenAccountNotFoundError') tokenBalance = '0'; else throw e; }
    }
    const migrated = Number(state.isMigrated) !== 0;
    const graduated = migrated ? await this.graduated.market(launch, config, wallet) : null;
    return { pool: launch.pool, mint: launch.mint, migrated, graduationPending: !migrated && state.quoteReserve.gte(config.migrationQuoteThreshold), quoteReserve: state.quoteReserve.toString(), platformClaimable: fees.current.partnerQuoteFee.toString(), creatorClaimable: fees.current.creatorQuoteFee.toString(), tokenBalance, graduated };
  }
  async prepareTrade(launch, input) {
    await this.network(); const owner = ownerAddress(input.owner);
    const { state, config } = await this.validatePool(launch);
    if (!['buy','sell'].includes(input.side)) throw new AppError('Choose buy or sell.');
    if (!Number.isInteger(input.slippageBps) || input.slippageBps < 10 || input.slippageBps > 300) throw new AppError('Slippage must be 0.1–3%.');
    const amount = units(input.amount, input.side === 'buy' ? 9 : 6);
    if (Number(state.isMigrated) !== 0) {
      const result = await this.graduated.trade(launch, config, { ...input, owner, amount });
      return { ...await this.simulate(await this.finalize(result.tx, owner),'Trade'), ...result.quote, side: input.side, venue: 'damm-v2' };
    }
    if (state.quoteReserve?.gte(config.migrationQuoteThreshold)) throw new AppError('This token has reached graduation. Wait for Meteora migration before trading.',409);
    const slot = await this.connection.getSlot('confirmed'); const blockTime = await this.connection.getBlockTime(slot);
    if (blockTime === null) throw new AppError('Unable to read chain time. Retry shortly.', 503);
    const quote = this.client.pool.swapQuote({ virtualPool: state, config, swapBaseForQuote: input.side === 'sell', amountIn: new BN(amount.toString()), slippageBps: input.slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(config.activationType === 0 ? slot : blockTime) });
    if (quote.minimumAmountOut.isZero()) throw new AppError('Trade is too small.');
    const tx = await this.client.pool.swap({ owner: new PublicKey(owner), pool: new PublicKey(launch.pool), amountIn: new BN(amount.toString()), minimumAmountOut: quote.minimumAmountOut, swapBaseForQuote: input.side === 'sell', referralTokenAccount: null });
    return { ...await this.simulate(await this.finalize(tx, owner),'Trade'), amountIn: amount.toString(), minimumAmountOut: quote.minimumAmountOut.toString(), expectedAmountOut: quote.outputAmount.toString(), side: input.side, venue: 'dbc' };
  }
  async prepareClaim(launch, wallet, role, position) {
    await this.network(); const owner = ownerAddress(wallet); const { state, config } = await this.validatePool(launch);
    if (position) {
      if (Number(state.isMigrated) === 0) throw new AppError('This pool has not graduated.',409);
      const tx = await this.graduated.claim(launch, config, owner, position);
      return { ...await this.simulate(await this.finalize(tx,owner),'Claim'), role: 'position-owner', position, venue: 'damm-v2' };
    }
    role = role || (owner === launch.owner ? 'creator' : 'platform');
    if (!['creator','platform'].includes(role) || (role === 'creator' ? owner !== launch.owner : owner !== PLATFORM)) throw new AppError('Only the creator or platform recipient can claim their own fees.', 403);
    const common = { payer: new PublicKey(owner), pool: new PublicKey(launch.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN('18446744073709551615'), receiver: new PublicKey(owner) };
    const tx = role === 'platform' ? await this.client.partner.claimPartnerTradingFee({ ...common, feeClaimer: new PublicKey(owner) }) : await this.client.creator.claimCreatorTradingFee({ ...common, creator: new PublicKey(owner) });
    return { ...await this.simulate(await this.finalize(tx, owner),'Claim'), role, venue: 'dbc' };
  }
  async broadcast(wire, intent) {
    await this.network();
    if (intent.network !== this.networkName) throw new AppError('Transaction network mismatch.',409);
    const tx = verifySigned(wire, intent);
    return this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  }
  async status(signature, intent) {
    await this.network();
    if (intent && intent.network !== this.networkName) throw new AppError('Receipt network mismatch.',409);
    const result = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const value = result.value[0];
    if (!value) {
      // Do not rebroadcast or re-create an ambiguous transaction automatically.
      if (intent && await this.connection.getBlockHeight('finalized') > intent.lastValidBlockHeight) return 'expired';
      return 'pending';
    }
    if (value.err) return 'failed';
    return ['confirmed','finalized'].includes(value.confirmationStatus) ? 'confirmed' : 'pending';
  }
}
module.exports = { Chain, curveConfig, messageHash, toWire, verifySigned };
