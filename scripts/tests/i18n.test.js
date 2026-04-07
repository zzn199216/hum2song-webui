#!/usr/bin/env node
/* PR-G1a/G1b/G1c: i18n Core - minimal tests for register, t, setLang, fallback, persistence, loadManifest, zh-covers-en. */
'use strict';

const fs = require('fs');
const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// PR-G1c: zh.json must have all keys from en.json
var enPath = path.join(__dirname, '../../static/i18n/locales/en.json');
var zhPath = path.join(__dirname, '../../static/i18n/locales/zh.json');
if (fs.existsSync(enPath) && fs.existsSync(zhPath)){
  var en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  var zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  var enKeys = Object.keys(en);
  for (var i = 0; i < enKeys.length; i++){
    assert(zh[enKeys[i]] != null, 'zh.json missing key: ' + enKeys[i]);
  }
}

// Studio index: beginner hint bar (first-open guidance)
var indexHtmlPath = path.join(__dirname, '../../static/pianoroll/index.html');
if (fs.existsSync(indexHtmlPath)) {
  var indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  assert(indexHtml.indexOf('id="beginnerHintBar"') !== -1, 'index.html must include beginnerHintBar');
  assert(indexHtml.indexOf('data-copy-cmd') !== -1, 'index.html must include copy-cmd buttons for beginner hint');
  assert(indexHtml.indexOf('data-i18n="beginnerHint.title"') !== -1, 'index.html beginner hint must use i18n keys');
  assert(indexHtml.indexOf('data-i18n-aria-label') !== -1, 'index.html beginner hint must support aria i18n');
  assert(indexHtml.indexOf('id="beginnerHintHelpPanel"') !== -1, 'index.html must include beginner help panel');
  assert(indexHtml.indexOf('id="btnBeginnerHintMoreHelp"') !== -1, 'index.html must include More help button');
  assert(indexHtml.indexOf('id="btnBeginnerHelpEntry"') !== -1, 'index.html must include persistent beginner help entry');
  assert(indexHtml.indexOf('id="btnBeginnerHintRestore"') !== -1, 'index.html must include restore hint strip control');
  assert(indexHtml.indexOf('python scripts/beginner_preflight.py') !== -1, 'index.html must include preflight command');
  assert(indexHtml.indexOf('python scripts/beginner_launch.py') !== -1, 'index.html must include launch command');
  assert(indexHtml.indexOf('id="studioLastOptimizeRow"') !== -1, 'index.html must include last optimize summary row');
  assert(indexHtml.indexOf('data-i18n="lastOpt.label"') !== -1, 'index.html last optimize row must use i18n label');
}

const I18N = require('../../static/i18n/i18n.js');

I18N.register('en', { common: { ok: 'OK', cancel: 'Cancel', missing_in_zh: 'From English' } });
I18N.register('zh', { common: { ok: '好的', cancel: '取消' } });

I18N.setLang('zh');
assert(I18N.t('common.ok') === '好的', 'zh: common.ok');
assert(I18N.t('nonexistent.key') === 'nonexistent.key', 'missing key returns key');

I18N.setLang('en');
assert(I18N.t('common.ok') === 'OK', 'en: common.ok');

I18N.setLang('zh');
assert(I18N.t('common.missing_in_zh') === 'From English', 'zh fallback to en when key missing in zh');

var storage = I18N._storage();
I18N.setLang('zh');
assert(storage.getItem('hum2song_studio_lang') === 'zh', 'setLang persists to localStorage/hum2song_studio_lang');

assert(I18N.getLang() === 'zh', 'getLang returns current');
assert(I18N.availableLanguages().length >= 2, 'availableLanguages returns at least en, zh');

I18N.init();
assert(typeof I18N.getLang() === 'string', 'init sets lang');

// PR-G1b: loadManifest with injectable fetchFn
if (I18N.loadManifest){
  const mockManifest = [{ code: 'xx', label: 'TestLang' }];
  const mockFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(mockManifest) });
  I18N.loadManifest({ fetchFn: mockFetch }).then(function(){
    try {
      const list = I18N.availableLanguages();
      assert(Array.isArray(list) && list.length >= 1 && list[0].code === 'xx', 'loadManifest updates availableLanguages');
      console.log('PASS i18n register, t, setLang, fallback, persistence, loadManifest');
    } catch (e) { console.error(e); process.exit(1); }
  }).catch(function(e){ console.error(e); process.exit(1); });
} else {
  console.log('PASS i18n register, t, setLang, fallback, persistence');
}
