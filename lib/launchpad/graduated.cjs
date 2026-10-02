'use strict';
const { PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, NATIVE_MINT } = require('@solana/spl-token');
const { CpAmm, getUnClaimLpFee } = require('@meteora-ag/cp-amm-sdk');
const { deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } = require('@meteora-ag/dynamic-bonding-curve-sdk');
const BN = require('bn.js');
const { AppError, address } = require('./policy.cjs');

// Only derive the canonical migration pool. Never accept a caller-supplied pool or vault.
class GraduatedPools {
  constructor(connection) { this.connection = connection; this.client = new CpAmm(connection); }
  async resolve(launch, config) {
    if (config.migrationOption !== 1 || config.migrationFeeOption !== 6) throw new AppError('Unsupported migration configuration.',409);
    const pool = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[6],new PublicKey(launch.mint),NATIVE_MINT);
    const state = await this.client.fetchPoolState(pool);
    if (!state || !state.tokenAMint.equals(new PublicKey(launch.mint)) || !state.tokenBMint.equals(NATIVE_MINT) || state.tokenAFlag !== 0 || state.tokenBFlag !== 0 || state.collectFeeMode !== 1) throw new AppError('Graduated pool identity or SOL fee mode could not be verified.',409);
    return { pool, state };
  }
  accounts(pool,state) {
    return { pool,tokenAMint:state.tokenAMint,tokenBMint:state.tokenBMint,tokenAVault:state.tokenAVault,tokenBVault:state.tokenBVault,tokenAProgram:TOKEN_PROGRAM_ID,tokenBProgram:TOKEN_PROGRAM_ID };
  }
  async ownedPositions(pool,owner) {
    const rows = await this.client.getUserPositionByPool(pool,new PublicKey(owner));
    return rows.filter(p=>p.positionState.pool.equals(pool));
  }
  async market(launch, config, owner) {
    const { pool,state } = await this.resolve(launch,config);
    const rows = owner ? await this.ownedPositions(pool,owner) : [];
    return { pool:pool.toBase58(),positions:rows.map(p=>{
      const fees=getUnClaimLpFee(state,p.positionState);
      return { address:p.position.toBase58(),quoteClaimable:fees.feeTokenB.toString(),baseClaimable:fees.feeTokenA.toString(),permanentLockedLiquidity:p.positionState.permanentLockedLiquidity.toString() };
    }) };
  }
  async trade(launch,config,input) {
    const {pool,state}=await this.resolve(launch,config);
    const currentSlot=await this.connection.getSlot('confirmed'),currentTime=await this.connection.getBlockTime(currentSlot);
    if(currentTime===null)throw new AppError('Unable to read chain time. Retry shortly.',503);
    const buy=input.side==='buy',inputTokenMint=buy?state.tokenBMint:state.tokenAMint,outputTokenMint=buy?state.tokenAMint:state.tokenBMint;
    const amountIn=new BN(input.amount.toString());
    const q=this.client.getQuote({inAmount:amountIn,inputTokenMint,slippage:input.slippageBps/100,poolState:state,currentTime,currentSlot,tokenADecimal:6,tokenBDecimal:9,hasReferral:false});
    if(q.minSwapOutAmount.isZero())throw new AppError('Trade is too small.');
    const tx=await this.client.swap({...this.accounts(pool,state),payer:new PublicKey(input.owner),inputTokenMint,outputTokenMint,amountIn,minimumAmountOut:q.minSwapOutAmount,poolState:state});
    return {tx,quote:{amountIn:amountIn.toString(),expectedAmountOut:q.swapOutAmount.toString(),minimumAmountOut:q.minSwapOutAmount.toString(),tradingPool:pool.toBase58()}};
  }
  async claim(launch,config,owner,position) {
    address(position);
    const {pool,state}=await this.resolve(launch,config);
    const owned=(await this.ownedPositions(pool,owner)).find(p=>p.position.toBase58()===position);
    if(!owned)throw new AppError('The connected wallet does not own this fee position.',403);
    return this.client.claimPositionFee2({...this.accounts(pool,state),owner:new PublicKey(owner),receiver:new PublicKey(owner),feePayer:new PublicKey(owner),position:owned.position,positionNftAccount:owned.positionNftAccount});
  }
}
module.exports={GraduatedPools};
