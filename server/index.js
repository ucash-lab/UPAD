'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public');
const files=new Set(['index.html','styles.css','app.js','wallet.js','wallet.css','yappers.js','fees.js','icons.js','artwork.js','favicon.ico','assets/logo.png','assets/ucash-ninja.png']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  const fail=status=>{res.writeHead(status,{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'});res.end(status===404?'Not found':'Method not allowed');};
  if(!['GET','HEAD'].includes(req.method))return fail(405);
  let name;try{const url=new URL(req.url,'http://localhost');name=decodeURIComponent(url.pathname).slice(1)||'index.html';}catch{return fail(404);}
  if(!files.has(name))return fail(404);
  const file=path.join(root,name);if(!fs.existsSync(file))return fail(404);
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
  if(req.method==='HEAD')return res.end();fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
module.exports={server};
