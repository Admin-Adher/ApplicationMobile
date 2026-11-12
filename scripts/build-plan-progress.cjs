/* Deterministic, dependency-free HTML packaging for the web iframe and Expo text asset.
 * Uses the project's TypeScript compiler; no new native dependency or runtime is needed.
 * Run: node scripts/build-plan-progress.cjs [--check]
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'lib/plan-progress/editor');
const read = filename => fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');
const definitions = [];
for (const name of fs.readdirSync(source).filter(name => name.endsWith('.js')).sort()) {
  const code = ts.transpileModule(read(path.join(source,name)), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, newLine: ts.NewLineKind.LineFeed, removeComments: true } }).outputText;
  definitions.push(`M[${JSON.stringify(name)}]=function(require,exports,module){${code}\n};`);
}
const xlsx = read(require.resolve('xlsx/dist/xlsx.full.min.js'));
const css = ['styles.css','terrain.css','single-plan.css','integration.css'].map(name => read(path.join(source,name))).join('\n');
const runtime = `const M={},C={};${definitions.join('\n')}function R(n){n=n.replace(/^.\\//,'');if(!C[n]){if(!M[n])throw Error('Unknown editor module '+n);const m={exports:{}};C[n]=m;M[n](R,m.exports,m);}return C[n].exports;}R('app.js');`;
const inline = value => value.replace(/<\/script/gi, '<\\/script');
const html = read(path.join(source,'shell.html')).replace('<!-- BUILDTRACK_STYLE -->', () => `<style>${css}</style>`)
  .replace('<!-- BUILDTRACK_APP -->', () => `<script>/* BUILDTRACK_BOOT */</script><script>${inline(xlsx)}</script><script>${inline(runtime)}</script>`);
for (const name of ['assets/plan-progress/editor.html.txt','vercel-app/public/plan-progress/editor.html']) {
  const output = path.join(root,name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(output) || read(output) !== html) throw Error(name+' is stale. Run node scripts/build-plan-progress.cjs');
  } else { fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,html); }
}
console.log('Plan progress web/native assets '+(process.argv.includes('--check')?'verified':'generated')+' ('+Buffer.byteLength(html)+' bytes).');
for (const [sourceName, targetName] of [['pdf.min.mjs.txt','pdf.mjs'],['pdf.worker.min.mjs.txt','pdf.worker.mjs']]) {
  const content = fs.readFileSync(path.join(root,'assets/pdfjs',sourceName));
  const output = path.join(root,'vercel-app/public/plan-progress',targetName);
  if (process.argv.includes('--check')) { if (!fs.existsSync(output) || !fs.readFileSync(output).equals(content)) throw Error(targetName+' is stale.'); }
  else fs.writeFileSync(output,content);
}
