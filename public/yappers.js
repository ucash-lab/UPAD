// Public analytics UI only. X authentication and search stay on the server.
export function renderYapperReport(target, mint, data) {
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  target.replaceChildren();
  const identity = el('div', '', 'yapper-identity');
  identity.append(el('small', 'TRACKED CONTRACT ADDRESS'), el('code', mint));
  const search = el('a', 'View this CA on X ↗', 'button subtle');
  search.href = 'https://x.com/search?q=' + encodeURIComponent('"' + mint + '"') + '&f=live';
  search.target = '_blank'; search.rel = 'noopener noreferrer';
  identity.append(search); target.append(identity);
  if (!data.sync) {
    target.append(el('h3', 'Waiting for the first saved scan.'), el('p', 'An operator must approve a small scan before counts appear. Refresh does not search X. Missing data is not a zero count.', 'notice'));
    return;
  }
  const stats = el('div', '', 'yapper-stats');
  const partial=data.coverage?.complete===false;
  if(partial)target.append(el('p','Partial coverage · These counts include only saved posts, not a complete ranking or reward allocation. The next approved scan resumes the same search; progress is not discarded.','notice'));
  for (const [label, value] of [['Counted mentions', data.summary?.uniqueMentions], ['Yappers found', data.summary?.authors], ['Reward payouts', 'Not enabled']]) {
    const card = el('div', '', 'yapper-stat'); card.append(el('strong', value == null ? 'Unavailable' : String(value)), el('small', label)); stats.append(card);
  }
  target.append(stats);
  const end = data.window?.end ?? data.sync.start + 86400000;
  const stale = Date.now() - data.sync.synced > 3600000;
  target.append(el('p', `Search window: ${new Date(data.sync.start).toLocaleString()} → ${new Date(end).toLocaleString()}`, 'muted'));
  target.append(el('p', `${stale ? 'Update needed · ' : ''}Last saved scan: ${new Date(data.sync.synced).toLocaleString()}. Refresh reloads saved counts; it does not run a paid X search.`, stale ? 'notice' : 'muted'));
  if (!data.rows.length) { target.append(el('p', partial?'No eligible matches in the pages saved so far. Coverage is incomplete.':'No matching posts in this completed window.')); return; }
  const wrap = el('div', '', 'table-wrap'), table = document.createElement('table'), head = document.createElement('thead'), header = document.createElement('tr');
  table.append(el('caption', `${partial?'Partial ranking':'Ranking'} of saved exact-CA mentions. Counts are not reward entitlements.`));
  for (const text of ['Rank', 'Yapper', 'Unique mentions']) { const th = el('th', text); th.scope = 'col'; header.append(th); }
  head.append(header); table.append(head); const body = document.createElement('tbody');
  data.rows.forEach((row, index) => {
    const tr = document.createElement('tr'), who = document.createElement('td');
    if (/^[A-Za-z0-9_]{1,15}$/.test(row.username || '')) { const a = el('a', '@' + row.username); a.href = 'https://x.com/' + row.username; a.target = '_blank'; a.rel = 'noopener noreferrer'; who.append(a); }
    else who.append(el('span', 'X author ' + row.authorId));
    tr.append(el('td', String(index + 1)), who, el('td', String(row.count))); body.append(tr);
  });
  table.append(body); wrap.append(table); target.append(wrap);
}
