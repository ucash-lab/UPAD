'use strict';
const path=require('node:path');
const fs=require('node:fs'),crypto=require('node:crypto');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
async function buildWallet(){
  const result=await esbuild.build({absWorkingDir:root,entryPoints:['client/wallet.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,metafile:true,inject:['client/wallet-polyfills.js'],define:{'process.env.NODE_ENV':'"production"',global:'globalThis'},outfile:'public/wallet.js',legalComments:'eof'});
  // Fail the build if context-bearing libraries get duplicated or externalized again.
  for(const name of ['react','react-dom','@solana/wallet-adapter-react']){
    const roots=new Set(Object.keys(result.metafile.inputs).filter(p=>p.includes('node_modules/'+name+'/')).map(p=>p.slice(0,p.indexOf('node_modules/'+name+'/')+('node_modules/'+name).length)));
    if(roots.size!==1)throw new Error('Expected one bundled instance of '+name);
  }
  for(const output of Object.values(result.metafile.outputs))if(output.imports.some(i=>i.external&&i.kind!=='import-rule'))throw new Error('Wallet JavaScript must not use external runtime imports.');
  const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'public/wallet.js'))).update(fs.readFileSync(path.join(root,'public/wallet.css'))).digest('hex').slice(0,12);
  const appPath=path.join(root,'public/app.js'),htmlPath=path.join(root,'public/index.html');
  const app=fs.readFileSync(appPath,'utf8').replace(/from '\.\/wallet\.js(?:\?[^']*)?'/,"from './wallet.js?v="+version+"'");
  const html=fs.readFileSync(htmlPath,'utf8').replace(/src="\.\/app\.js(?:\?[^"]*)?"/,'src="./app.js?v='+version+'"').replace(/href="\.\/wallet\.css(?:\?[^"]*)?"/,'href="./wallet.css?v='+version+'"');
  fs.writeFileSync(appPath,app);fs.writeFileSync(htmlPath,html);
  console.log('Built self-hosted wallet.js and wallet.css with one shared wallet context.');
}
if(require.main===module)buildWallet().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={buildWallet};
