#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const root = path.resolve(__dirname, '../..');
const index = fs.readFileSync(path.join(root, 'static/pianoroll/index.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'static/pianoroll/cloud_project_bridge.js'), 'utf8');
const version = fs.readFileSync(path.join(root, 'static/pianoroll/studio_asset_version.js'), 'utf8');

const verMatch = version.match(/H2S_STUDIO_ASSET_VERSION\s*=\s*'([^']+)'/);
assert(verMatch, 'studio_asset_version.js should define H2S_STUDIO_ASSET_VERSION');
const ver = verMatch[1];

function scriptVersion(src) {
  const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = index.match(new RegExp('<script\\s+src="/static/pianoroll/' + escaped + '\\?v=([^"]+)"'));
  return m ? m[1] : '';
}

const requiredVersionedScripts = [
  'studio_asset_version.js',
  'h2s_startup_perf.js',
  'app.js',
  'cloud_project_bridge.js',
  'cloud_materials_panel.js',
  'ui/library_view.js',
  'controllers/library_controller.js',
  'ui/selection_view.js',
  'controllers/selection_controller.js',
];

for (const src of requiredVersionedScripts) {
  const assetVersion = scriptVersion(src);
  assert(assetVersion, src + ' should be present with a non-empty cache-bust version');
  assert(!/[\\/?#]/.test(assetVersion), src + ' cache-bust version should be a plain marker');
}

assert(ver === 'suno-stem-label-v1', 'studio_asset_version.js should use the current Studio release marker');
assert(scriptVersion('studio_asset_version.js') === ver, 'index.html should load studio_asset_version.js with the studio asset version marker');
assert(scriptVersion('h2s_startup_perf.js') === ver, 'index.html should load startup perf with the studio asset version marker');
assert(scriptVersion('app.js') === ver, 'index.html should load app.js with the studio asset version marker');
assert(scriptVersion('cloud_project_bridge.js') === ver, 'index.html should load cloud_project_bridge.js with the studio asset version marker');
assert(scriptVersion('cloud_materials_panel.js') === ver, 'index.html should load cloud materials panel with the studio asset version marker');
assert(scriptVersion('ui/library_view.js') === ver, 'index.html should load library view with the studio asset version marker');
assert(scriptVersion('controllers/library_controller.js') === ver, 'index.html should load library controller with the studio asset version marker');
assert(scriptVersion('ui/selection_view.js') === ver, 'index.html should load selection view with the studio asset version marker');
assert(scriptVersion('controllers/selection_controller.js') === ver, 'index.html should load selection controller with the studio asset version marker');

assert(index.indexOf('studio_asset_version.js') < index.indexOf('i18n.js'), 'asset version should load before i18n.js');
assert(index.indexOf('studio_asset_version.js') < index.indexOf('app.js?v=' + scriptVersion('app.js')), 'asset version should load before app.js');
assert(index.includes('/static/pianoroll/core/accompaniment_draft_v1.js?v=draft-v1'), 'index.html should load AccompanimentDraft v1 browser core');
assert(index.indexOf('core/accompaniment_draft_v1.js') > index.indexOf('core/arrangement_quality_v0.js'), 'AccompanimentDraft v1 should load after arrangement quality helpers');
assert(index.indexOf('core/accompaniment_draft_v1.js') < index.indexOf('controllers/arrangement_controller.js'), 'AccompanimentDraft v1 should load before arrangement controller');
assert(index.includes('params.get(\'cloudMode\') === \'1\''), 'index.html should bootstrap cloudMode before app.js');
assert(index.includes('hum2song.cn'), 'index.html bootstrap should detect Hum2Song Cloud embed referrer');

assert(bridge.includes('function isCloudModeRequested'), 'bridge should centralize cloud mode detection');
assert(bridge.includes('document.referrer'), 'bridge should detect Cloud embed via referrer');
assert(bridge.includes('rerenderAiSettingsDrawerIfOpen'), 'bridge should refresh open AI Settings drawer on cloud boot');
assert(bridge.includes('H2S_SCHEDULE_CLOUD_AI_STATUS'), 'bridge should defer cloud AI status until interactive or drawer');
assert(bridge.includes('presets.some(function (p) { return p.id === configured; })'), 'bridge should ignore retired or stale cloud AI model profile ids');
assert(bridge.includes('h2s_startup_perf.js') === false, 'bridge file should not embed perf script');
assert(index.includes('h2s_startup_perf.js?v=' + scriptVersion('h2s_startup_perf.js')), 'index should load startup perf helper');

console.log('studio_cloud_ai_runtime.test.js ok');
