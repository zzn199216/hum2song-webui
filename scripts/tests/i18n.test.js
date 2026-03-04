#!/usr/bin/env node
/* PR-G1a: i18n Core - minimal tests for register, t, setLang, fallback, persistence. */
'use strict';

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'Assertion failed');
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

console.log('PASS i18n register, t, setLang, fallback, persistence');
