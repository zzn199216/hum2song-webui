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
  const DEFAULT_LIST = [{ code: 'en', label: 'English' }, { code: 'zh', label: '中文' }, { code: 'ja', label: '日本語' }];

  var _lang = 'en';
  var _dicts = {};
  var _manifest = null;
  var _loadPromises = {};

  function normalizeLang(lang){
    var raw = String(lang || '').trim().toLowerCase().replace(/_/g, '-');
    if (!raw) return 'en';
    if (raw === 'zh' || raw.indexOf('zh-') === 0) return 'zh';
    if (raw === 'ja' || raw === 'ja-jp' || raw.indexOf('ja-') === 0) return 'ja';
    if (raw === 'en' || raw.indexOf('en-') === 0) return 'en';
    return raw.slice(0, 8) || 'en';
  }

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

  function setLang(lang, opts){
    if (!lang || typeof lang !== 'string') return;
    _lang = normalizeLang(lang);
    var persist = !(opts && typeof opts === 'object' && opts.persist === false);
    if (persist){
      try{ _storage().setItem(LS_KEY, _lang); }catch(e){}
    }
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
    var code = normalizeLang(lang);
    _dicts[code] = (dict && typeof dict === 'object') ? dict : {};
  }

  function load(lang, opts){
    opts = opts || {};
    var fetchFn = opts.fetchFn || (typeof G.fetch === 'function' ? G.fetch : null);
    if (!fetchFn) throw new Error('i18n.load: fetch unavailable and opts.fetchFn not provided');
    var code = normalizeLang(lang);
    if (_dicts[code]) return Promise.resolve(_dicts[code]);
    var base = (opts.baseUrl != null) ? opts.baseUrl : '/static/i18n/locales';
    var url = base.replace(/\/+$/, '') + '/' + code + '.json';
    if (G.H2S_STUDIO_ASSET_VERSION) url += '?v=' + encodeURIComponent(String(G.H2S_STUDIO_ASSET_VERSION));
    var cacheKey = code + '|' + url;
    if (_loadPromises[cacheKey]) return _loadPromises[cacheKey];
    function fetchLocale(attempt) {
      return Promise.resolve().then(function(){ return fetchFn(url); }).then(function(r){
        if (!r.ok) { var error = new Error('i18n.load: ' + r.status); error.status = r.status; throw error; }
        return r.json();
      }).catch(function(error){
        var status = error && error.status;
        if (attempt >= 2 || error instanceof SyntaxError || (status >= 400 && status < 500 && status !== 408 && status !== 429)) throw error;
        return new Promise(function(resolve){ setTimeout(resolve, opts.retryDelayMs == null ? 250 * (attempt + 1) : opts.retryDelayMs); }).then(function(){ return fetchLocale(attempt + 1); });
      });
    }
    var loadPromise = fetchLocale(0).then(function(d){ register(code, d); return d; });
    _loadPromises[cacheKey] = loadPromise;
    loadPromise.then(function(){ delete _loadPromises[cacheKey]; }, function(){ delete _loadPromises[cacheKey]; });
    return loadPromise;
  }

  function loadManifest(opts){
    opts = opts || {};
    var fetchFn = opts.fetchFn || (typeof G.fetch === 'function' ? G.fetch : null);
    if (!fetchFn) return Promise.reject(new Error('i18n.loadManifest: fetch unavailable and opts.fetchFn not provided'));
    var base = (opts.baseUrl != null) ? opts.baseUrl : '/static/i18n';
    var url = base.replace(/\/+$/, '') + '/manifest.json';
    if (G.H2S_STUDIO_ASSET_VERSION) url += '?v=' + encodeURIComponent(String(G.H2S_STUDIO_ASSET_VERSION));
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
    var useStorage = opts.fromStorage !== false;
    if (useStorage){
      var stored = null;
      try{ stored = _storage().getItem(LS_KEY); }catch(e){}
      if (stored && typeof stored === 'string' && stored.trim()){ setLang(stored); return getLang(); }
    }
    if (opts.useNavigator === false){
      return getLang();
    }
    var nav = (typeof G.navigator !== 'undefined' && G.navigator && G.navigator.language) ? G.navigator.language : '';
    var navLocale = String(nav || '').toLowerCase();
    if (navLocale.indexOf('zh') === 0){ setLang('zh'); }
    else if (navLocale.indexOf('ja') === 0){ setLang('ja'); }
    else { setLang('en'); }
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
