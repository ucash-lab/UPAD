// Consistent, local stroke icons. No emoji font or third-party icon requests.
const paths={
  '↗':'M7 17 17 7M7 7h10v10','→':'M4 12h16m-6-6 6 6-6 6','←':'M20 12H4m6-6-6 6 6 6',
  '↻':'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
  '＋':'M12 5v14M5 12h14','×':'M6 6l12 12M18 6 6 18',
  '⌕':'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  '◉':'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  '✦':'M14 4c3-2 6-2 6-2s0 3-2 6l-6 6-6-6zM6 8l-3 1-1 5 5-1M12 14l-1 5 5-1 1-3M5 17l-3 5 5-3',
  '◌':'M21 11a8 8 0 0 1-8 8H7l-5 3 1-7a8 8 0 0 1-1-4 9 9 0 0 1 19 0M7 10h10M7 14h6',
  '▣':'M3 5h18v16H3zM3 9h18M7 13h5M7 17h8',
  '⚙':'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  '●':'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16','○':'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16',
  'upload':'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6'};
export function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'icon'}))svg.setAttribute(k,v);const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths['✦']);svg.append(p);return svg;}
export function installIcons(){
  const update=()=>{document.querySelectorAll('[data-icon]').forEach(e=>{e.replaceChildren(icon(e.dataset.icon));e.removeAttribute('data-icon');});
    document.querySelectorAll('a,button,.search>span,.empty-orb,.legend>span,.bubble-two').forEach(e=>{
      const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())if(/[↗→←↻＋×⌕◉✦◌▣⚙●○]/.test(walker.currentNode.data))nodes.push(walker.currentNode);
      for(const n of nodes){const parts=n.data.split(/([↗→←↻＋×⌕◉✦◌▣⚙●○])/);n.replaceWith(...parts.filter(Boolean).map(s=>paths[s]?icon(s):document.createTextNode(s)));}
    });};
  update();new MutationObserver(update).observe(document.body,{childList:true,subtree:true,characterData:true});
}
