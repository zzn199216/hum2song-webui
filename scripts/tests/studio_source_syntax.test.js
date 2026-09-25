#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '../..');
const files = [
  'static/pianoroll/app.js',
  'static/pianoroll/project.js',
  'static/pianoroll/core/notation.js',
  'static/pianoroll/ui/notation_view.js',
  'static/pianoroll/ui/editor_audition.js',
  'static/pianoroll/controllers/notation_controller.js',
];

for (const relativePath of files) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  new vm.Script(source, { filename: relativePath });
}

console.log('PASS Studio app/project source syntax');
