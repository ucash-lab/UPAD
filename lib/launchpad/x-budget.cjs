'use strict';
const {AppError}=require('./policy.cjs');
const X_BUDGET=Object.freeze({postsPerRequest:10,maxRequestsPer24Hours:5,maxPostSlotsPer24Hours:50,minIntervalMinutes:60,automaticSearches:false});
function reservationPlan(timestamps,now=Date.now()){
  if(!Array.isArray(timestamps)||timestamps.some(t=>!Number.isSafeInteger(t)))throw new AppError('X budget record is unavailable. No request is allowed.',503);
  const recent=timestamps.filter(t=>t>now-86400000).sort((a,b)=>a-b);
  if(recent.length&&now-recent[recent.length-1]<3600000)return {allowed:false,reason:'hour'};
  if(recent.length>=5)return {allowed:false,reason:'day'};
  return {allowed:true,timestamps:[...recent,now]};
}
async function reserveXRequest(store,input,{probe=false,legacyHttp=null}={}) {
  if(input.approveMaxPosts!==10)throw new AppError('Paid search requires explicit approval for one request of at most 10 posts.',400);
  const last=await store.xStatus();
  const http=last?.http??legacyHttp;
  if(((http && http!==200)||last?.searchAccessVerified===false) && !(probe&&input.resumePaidSearch===true))throw new AppError('Paid X searches are paused after an API failure. Review billing/access, then explicitly approve one access recheck.',409);
  // Reservations happen before contacting X, and are never refunded after a timeout/error.
  // Atomic database limits are shared by all markets, visitors, diagnostics and server instances.
  const reservation=await store.reserveXBudget();
  if(!reservation.allowed)throw new AppError(reservation.reason==='hour'?'Hourly X request limit reached. Saved counts are still available.':'24-hour X budget reached (5 requests / at most 50 post slots).',429);
  // If the process dies after spending credits but before saving a result, do not retry silently.
  await store.saveXStatus({http:202,searchAccessVerified:false,checkedAt:Date.now()});
}
module.exports={X_BUDGET,reserveXRequest,reservationPlan};
