/* Hum2Song Studio - i18n Core (PR-G1a)
   Plugin-friendly i18n. Add locale JSON + manifest entry to add a language.
   UMD: works in browser (globalThis.I18N) and Node (module.exports) for tests.
*/
(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.I18N = factory();
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  var G = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
  const LS_KEY = 'hum2song_studio_lang';
  const DEFAULT_LIST = [{ code: 'en', label: 'English' }, { code: 'zh', label: '中文' }];

  var _lang = 'en';
  var _dicts = {};
  var _manifest = null;

  function _storage(){
    try{
      if (typeof G.localStorage !== 'undefined' && G.localStorage) return G.localStorage;
    }catch(e){}
    if (!_storage._fallback) _storage._fallback = {};
    return { getItem: function(k){ return _storage._fallback[k] || null; }, setItem: function(k,v){ _storage._fallback[k] = String(v); } };
  }

  function getLang(){
    return _lang || 'en';
  }

  function setLang(lang){
    if (!lang || typeof lang !== 'string') return;
    _lang = String(lang).trim().toLowerCase().slice(0, 8) || 'en';
    try{ _storage().setItem(LS_KEY, _lang); }catch(e){}
  }

  function _getVal(dict, key){
    if (!dict || typeof dict !== 'object') return undefined;
    var k = String(key).trim();
    if (dict[k] != null && typeof dict[k] === 'string') return dict[k];
    var parts = k.split('.');
    var o = dict;
    for (var i = 0; i < parts.length && o != null; i++) o = o[parts[i]];
    return (o != null && typeof o === 'string') ? o : undefined;
  }

  function t(key, params){
    try{
      if (!key || typeof key !== 'string') return String(key || '');
      var k = key.trim();
      if (!k) return '';
      var val = _getVal(_dicts[_lang], k) || _getVal(_dicts.en, k);
      if (val == null) return k;
      var s = String(val);
      if (params && typeof params === 'object') for (var p in params) if (params.hasOwnProperty(p)) s = s.replace(new RegExp('\\{\\{' + p + '\\}\\}', 'g'), String(params[p]));
      return s;
    }catch(e){ return String(key || ''); }
  }

  function register(lang, dict, meta){
    if (!lang || typeof lang !== 'string') return;
    var code = String(lang).trim().toLowerCase().slice(0, 8);
    _dicts[code] = (dict && typeof dict === 'object') ? dict : {};
  }

  function load(lang, opts){
    opts = opts || {};
    var fetchFn = opts.fetchFn || (typeof G.fetch === 'function' ? G.fetch : null);
    if (!fetchFn) throw new Error('i18n.load: fetch unavailable and opts.fetchFn not provided');
    var base = (opts.baseUrl != null) ? opts.baseUrl : '/static/i18n/locales';
    var url = base.replace(/\/+$/, '') + '/' + String(lang).trim().toLowerCase().slice(0, 8) + '.json';
    return fetchFn(url).then(function(r){ if (!r.ok) throw new Error('i18n.load: ' + r.status); return r.json(); }).then(function(d){ register(lang, d); return d; });
  }

  function loadManifest(opts){
    opts = opts || {};
    var fetchFn = opts.fetchFn || (typeof G.fetch === 'function' ? G.fetch : null);
    if (!fetchFn) return Promise.reject(new Error('i18n.loadManifest: fetch unavailable and opts.fetchFn not provided'));
    var base = (opts.baseUrl != null) ? opts.baseUrl : '/static/i18n';
    var url = base.replace(/\/+$/, '') + '/manifest.json';
    return fetchFn(url).then(function(r){ if (!r.ok) throw new Error('i18n.loadManifest: ' + r.status); return r.json(); }).then(function(arr){
      _manifest = Array.isArray(arr) ? arr : DEFAULT_LIST;
      return _manifest;
    });
  }

  function availableLanguages(){
    if (_manifest && Array.isArray(_manifest)) return _manifest;
    return DEFAULT_LIST;
  }

  function setManifest(arr){
    _manifest = Array.isArray(arr) ? arr : DEFAULT_LIST;
  }

  function init(opts){
    opts = opts || {};
    var stored = null;
    try{ stored = _storage().getItem(LS_KEY); }catch(e){}
    if (stored && typeof stored === 'string' && stored.trim()){ setLang(stored); return getLang(); }
    var nav = (typeof G.navigator !== 'undefined' && G.navigator && G.navigator.language) ? G.navigator.language : '';
    if (nav && String(nav).toLowerCase().indexOf('zh') === 0){ setLang('zh'); } else { setLang('en'); }
    return getLang();
  }

  var api = {
    getLang: getLang,
    setLang: setLang,
    t: t,
    register: register,
    load: load,
    loadManifest: loadManifest,
    availableLanguages: availableLanguages,
    init: init,
    _setManifest: setManifest,
    _storage: _storage,
    _dicts: function(){ return _dicts; }
  };

  return api;
});
