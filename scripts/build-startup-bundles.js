'use strict';
// Package classic scripts in their existing execution order. Inline configuration,
// stylesheet boundaries and the independent startup watchdog remain in place.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
function build(root, output) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const digest = content => crypto.createHash('sha256').update(content).digest('hex');
  const input = read('static/pianoroll/index.html');
  const groups = [];
  const separator = '(?:\\s|<!--[\\s\\S]*?-->)*';
  const tag = '<script src="(/static/[^"?]+)(?:\\?[^"<>]*)?"></script>';
  const block = new RegExp('(?:' + tag + separator + '){2,}', 'g');
  const html = input.replace(block, original => {
    const sources = Array.from(original.matchAll(new RegExp(tag, 'g')), m => m[1]);
    if (sources.some(s => !s.endsWith('.js') || s.includes('..'))) throw new Error('Invalid script path');
    const sourceHashes = Object.fromEntries(sources.map(s => [s, digest(read(s.slice(1)))]));
    const content = sources.map(s => '\n;\n/* ' + s + ' */\n' + read(s.slice(1)) + '\n').join('');
    new vm.Script(content); // Reject invalid combined lexical scope before release.
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const file = 'static/pianoroll/startup-' + hash + '.js';
    fs.mkdirSync(path.join(output, 'static/pianoroll'), {recursive:true});
    fs.writeFileSync(path.join(output, file), content);
    groups.push({file, sources, sourceHashes, sha256:digest(content), bytes:Buffer.byteLength(content)});
    return '<script src="/' + file + '"></script>\n';
  });
  if (!groups.length) throw new Error('No startup script groups found');
  fs.writeFileSync(path.join(output, 'static/pianoroll/index.html'), html);
  fs.writeFileSync(path.join(output, 'static/pianoroll/index.source.html'), input);
  fs.writeFileSync(path.join(output, 'STARTUP_BUNDLES.json'), JSON.stringify({htmlSha256:digest(html),groups}, null, 2));
  return {scriptsBefore:groups.reduce((n,g)=>n+g.sources.length,0), scriptsAfter:groups.length, groups};
}
module.exports = {build};
if (require.main === module) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/build-startup-bundles.js <artifact-root>');
  const result = build(path.resolve(__dirname, '..'), path.resolve(output));
  console.log('Startup scripts: ' + result.scriptsBefore + ' -> ' + result.scriptsAfter);
}
