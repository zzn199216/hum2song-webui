'use strict';
// Package classic scripts in their existing execution order. Inline configuration,
// stylesheet boundaries and the independent startup watchdog remain in place.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const esbuild = require('esbuild');
function build(root, output) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const digest = content => crypto.createHash('sha256').update(content).digest('hex');
  const input = read('static/pianoroll/index.html');
  const groups = [];
  const separator = '(?:\\s|<!--[\\s\\S]*?-->)*';
  const tag = '<script src="(/static/[^"?]+)(?:\\?[^"<>]*)?"></script>';
  const block = new RegExp('(?:' + tag + separator + '){2,}', 'g');
  let html = input.replace(block, original => {
    const sources = Array.from(original.matchAll(new RegExp(tag, 'g')), m => m[1]);
    if (sources.some(s => !s.endsWith('.js') || s.includes('..'))) throw new Error('Invalid script path');
    const sourceHashes = Object.fromEntries(sources.map(s => [s, digest(read(s.slice(1)))]));
    const rawContent = sources.map(s => '\n;\n/* ' + s + ' */\n' + read(s.slice(1)) + '\n').join('');
    const content = esbuild.transformSync(rawContent, {
      minify: true, keepNames: true, target: 'es2020', charset: 'utf8', legalComments: 'inline',
    }).code;
    new vm.Script(content); // Reject invalid combined lexical scope before release.
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const file = 'static/pianoroll/startup-' + hash + '.js';
    fs.mkdirSync(path.join(output, 'static/pianoroll'), {recursive:true});
    fs.writeFileSync(path.join(output, file), content);
    groups.push({file, sources, sourceHashes, sha256:digest(content), bytes:Buffer.byteLength(content), rawBytes:Buffer.byteLength(rawContent)});
    return '<script src="/' + file + '"></script>\n';
  });
  if (!groups.length) throw new Error('No startup script groups found');
  let resources = null;
  if (fs.existsSync(path.join(root, 'static/pianoroll/startup_ui.js'))) {
    const sources = {
      'startup_ui.js': 'static/pianoroll/startup_ui.js',
      'notation.css': 'static/pianoroll/ui/notation.css',
      'i18n/manifest.json': 'static/i18n/manifest.json',
      ...Object.fromEntries(['en','zh','ja'].map(lang => ['i18n/locales/'+lang+'.json', 'static/i18n/locales/'+lang+'.json'])),
    };
    const content = Object.fromEntries(Object.entries(sources).map(([name,source]) => [name,read(source)]));
    const version = digest(JSON.stringify(content)).slice(0,16);
    const prefix = 'static/startup-resources/'+version;
    const files = {};
    for (const [name,text] of Object.entries(content)) {
      const file = prefix+'/'+name;
      fs.mkdirSync(path.dirname(path.join(output,file)),{recursive:true});
      fs.writeFileSync(path.join(output,file),text);
      files[file] = {sha256:digest(text),source:sources[name]};
    }
    html = html.replace(/\/static\/pianoroll\/startup_ui\.js(?:\?[^"<>]*)?/g,'/'+prefix+'/startup_ui.js')
      .replace(/\/static\/pianoroll\/ui\/notation\.css(?:\?[^"<>]*)?/g,'/'+prefix+'/notation.css')
      .replace('<head>','<head><script>window.H2S_I18N_BASE_URL="/'+prefix+'/i18n";</script>');
    resources = {version,files};
  }
  fs.writeFileSync(path.join(output, 'static/pianoroll/index.html'), html);
  fs.writeFileSync(path.join(output, 'static/pianoroll/index.source.html'), input);
  fs.writeFileSync(path.join(output, 'STARTUP_BUNDLES.json'), JSON.stringify({htmlSha256:digest(html),groups,resources}, null, 2));
  return {scriptsBefore:groups.reduce((n,g)=>n+g.sources.length,0), scriptsAfter:groups.length, groups,resources};
}
module.exports = {build};
if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/build-startup-bundles.js <artifact-root>');
  const result = build(path.resolve(__dirname, '..'), path.resolve(output));
  console.log('Startup scripts: ' + result.scriptsBefore + ' -> ' + result.scriptsAfter);
}
