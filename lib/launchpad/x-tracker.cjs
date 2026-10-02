'use strict';
const { createHash } = require('node:crypto');
const { address, AppError } = require('./policy.cjs');
// Tracking is analytics only. No X identity is treated as a verified payout wallet.
function exactMention(text, mint) {
  address(mint);
  return new RegExp(`(^|[^A-Za-z0-9])${mint}(?=$|[^A-Za-z0-9])`).test(text);
}
function normalizePosts(posts, users, mint, start, end) {
  const handles = new Map(users.map(u => [u.id, /^[A-Za-z0-9_]{1,15}$/.test(u.username || '') ? u.username : '']));
  const seen = new Set(); const rows = [];
  for (const p of posts) {
    const id = p.edit_history_tweet_ids?.[0] || p.edit_history_post_ids?.[0] || p.id;
    const created = Date.parse(p.created_at);
    if (!/^\d{1,25}$/.test(id || '') || !/^\d{1,25}$/.test(p.author_id || '') || !Number.isFinite(created) || created < start || created >= end || seen.has(id)) continue;
    if (p.referenced_tweets?.some(r => r.type === 'retweeted') || p.referenced_posts?.some(r => r.type === 'retweeted')) continue;
    const text = p.note_tweet?.text || p.note_post?.text || p.text || '';
    if (!exactMention(text, mint)) continue; // No ticker matches, quoted-post text or substring matches.
    const normalized = text.normalize('NFKC').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().toLowerCase();
    rows.push({ id, authorId: p.author_id, username: handles.get(p.author_id) || '', fingerprint: createHash('sha256').update(p.author_id + ':' + normalized).digest('hex'), created });
    seen.add(id);
  }
  return rows;
}
function allocateByCount(amount, rows) {
  if (typeof amount !== 'bigint' || amount < 0n) throw new AppError('Invalid reward amount.');
  const authors = new Set();
  for (const r of rows) {
    if (!/^\d{1,25}$/.test(r.authorId || '') || !Number.isSafeInteger(r.count) || r.count <= 0 || authors.has(r.authorId)) throw new AppError('Invalid or duplicate author count.');
    authors.add(r.authorId);
  }
  const total = rows.reduce((sum,r)=>sum+BigInt(r.count),0n);
  if (!total) return { allocations: [], retained: amount.toString() };
  const list = rows.map(r=>({authorId:r.authorId, amount: amount*BigInt(r.count)/total, remainder:amount*BigInt(r.count)%total}));
  let dust = amount-list.reduce((sum,r)=>sum+r.amount,0n);
  list.sort((a,b)=>a.remainder===b.remainder ? (BigInt(a.authorId)<BigInt(b.authorId)?-1:1) : a.remainder>b.remainder?-1:1);
  for(let i=0;dust>0n;i++,dust--) list[i].amount++;
  return { allocations:list.map(r=>({authorId:r.authorId,units:r.amount.toString()})), retained:'0' };
}
function searchUrl(mint, start, end, maxResults, cursor) {
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.search = new URLSearchParams({ query: `${mint} -is:retweet`, max_results: String(maxResults), 'tweet.fields': 'author_id,created_at,edit_history_tweet_ids,referenced_tweets,note_tweet', expansions: 'author_id', 'user.fields': 'username', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), ...(cursor ? { next_token: cursor } : {}) }).toString();
  return url;
}
async function checkSearchAccess(mint, token, fetcher = fetch, now = Date.now()) {
  address(mint); if (!token) throw new AppError('X API credentials have not been configured.', 503);
  const end=now-30000, start=end-86400000;
  const response=await fetcher(searchUrl(mint,start,end,10), {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  // A probe is not a complete report: never persist its sampled posts as counts.
  return {http:response.status,searchAccessVerified:response.ok&&!data.errors?.length,checkedAt:Date.now(),returnedPosts:response.ok?(data.meta?.result_count||0):0};
}
async function scanPage(mint, token, previous = null, fetcher = fetch, now = Date.now()) {
  address(mint);if(!token)throw new AppError('X API credentials have not been configured.',503);
  const cutoff=now-30000;
  const pending=previous?.cursor;
  const end=pending?previous.end:cutoff;
  // Completed intervals are never searched again. Retain only the recent 24-hour ledger.
  const start=pending?previous.start:Math.max(previous?.end||cutoff-86400000,cutoff-86400000);
  if(start>=end)throw new AppError('There is no new search interval yet.',409);
  if(start<now-6*86400000)throw new AppError('Saved search window expired. Existing counts are preserved; operator review is required before restarting.',409);
  const url=searchUrl(mint,start,end,10,pending);
  url.searchParams.set('sort_order','recency');
  const response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=new AppError(`X search paused (HTTP ${response.status}). Saved counts and progress were preserved.`,503);error.xHttp=response.status;throw error;}
  const data=await response.json();
  if(data.errors?.length)throw new AppError('X returned an incomplete response. Saved progress was preserved; no automatic retry.',503);
  const posts=data.data||[];
  if(!Array.isArray(posts)||posts.length>10)throw new AppError('X returned an unexpected page size. Search paused.',503);
  const rows=normalizePosts(posts,data.includes?.users||[],mint,start,end);
  const merged=new Map((previous?.rows||[]).filter(r=>r.created>=end-86400000).map(r=>[r.id,r]));
  for(const row of rows)merged.set(row.id,row);
  const cursor=data.meta?.next_token||null;
  if(cursor && (typeof cursor!=='string'||cursor.length>4096||cursor===pending))throw new AppError('X returned a repeated or invalid cursor. Saved progress was preserved.',503);
  return {start,end,cursor,rows:[...merged.values()],complete:!cursor,updatedAt:now,coverageStart:Math.max(previous?.coverageStart||start,end-86400000),lastCompleteEnd:cursor?(previous?.lastCompleteEnd||null):end,scannedPosts:(pending?previous.scannedPosts||0:0)+posts.length};
}
function progressReport(mint, state) {
  const authors=new Map();
  for(const row of state.rows){if(!authors.has(row.authorId))authors.set(row.authorId,{authorId:row.authorId,username:row.username,prints:new Set()});authors.get(row.authorId).prints.add(row.fingerprint);}
  const rows=[...authors.values()].map(r=>({authorId:r.authorId,username:r.username,count:r.prints.size})).sort((a,b)=>b.count-a.count||a.authorId.localeCompare(b.authorId));
  return {sync:{mint,start:state.coverageStart,synced:state.updatedAt,posts:state.rows.length},window:{start:state.coverageStart,end:state.end},coverage:{complete:state.complete,lastCompleteEnd:state.lastCompleteEnd,scannedPosts:state.scannedPosts,mode:'incremental'},summary:{authors:rows.length,uniqueMentions:rows.reduce((sum,r)=>sum+r.count,0)},rows:rows.slice(0,100),paymentsEnabled:false};
}
// Compatibility helpers are now one page only. No full-scan loop remains.
async function collectRecent(mint,token,fetcher=fetch,now=Date.now()){return scanPage(mint,token,null,fetcher,now);}
const sampleRecent=collectRecent;
module.exports = { exactMention, normalizePosts, allocateByCount, collectRecent, checkSearchAccess, sampleRecent, scanPage, progressReport };
