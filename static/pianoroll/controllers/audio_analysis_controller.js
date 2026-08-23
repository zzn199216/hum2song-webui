/* Hum2Song Studio - AudioAnalysis V0 controller.
 * Owns session cache and compact on-demand result modal; the engine stays pure.
 */
(function(root, factory){
  'use strict';
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SAudioAnalysisController = api;
})(typeof window !== 'undefined' ? window : globalThis, function(root){
  'use strict';

  function isAudioClip(clip){ return !!(clip && clip.kind === 'audio'); }

  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch];
    });
  }

  function metric(value, suffix){
    return value == null || !isFinite(Number(value)) ? '—' : Number(value).toFixed(1) + (suffix || '');
  }

  function instrumentsHTML(instruments, t){
    instruments = instruments || {};
    t = typeof t === 'function' ? t : function(_key, fallback){ return fallback; };
    if (instruments.status === 'ok' && Array.isArray(instruments.items) && instruments.items.length){
      return '<span class="h2s-audio-analysis-instruments">' + instruments.items.map(function(item){
        var confidence = item && item.confidence != null ? ' ' + Math.round(Number(item.confidence) * 100) + '%' : '';
        return '<span class="h2s-audio-analysis-instrument">' + escapeHtml(item && item.name || '') + escapeHtml(confidence) + '</span>';
      }).join('') + '</span>';
    }
    if (instruments.status === 'ok') return escapeHtml(t('audioAnalysis.noInstruments', '未识别到明确乐器'));
    if (instruments.status === 'failed') return escapeHtml(t('audioAnalysis.instrumentFailed', '乐器识别失败'));
    return escapeHtml(t('audioAnalysis.notAvailable', '暂不可用'));
  }

  function resultHTML(result, t){
    t = typeof t === 'function' ? t : function(_key, fallback){ return fallback; };
    var technical = result.technical || {};
    var rhythm = result.rhythm || {};
    var harmony = result.harmony || {};
    var instruments = result.instruments || {};
    var unavailable = t('audioAnalysis.notAvailable', '暂不可用');
    return '<div class="h2s-audio-analysis-grid">' +
      '<div><b>' + escapeHtml(t('audioAnalysis.duration', '时长')) + '</b><span>' + metric(result.source && result.source.durationSec, ' s') + '</span></div>' +
      '<div><b>' + escapeHtml(t('audioAnalysis.sampleRate', '采样率')) + '</b><span>' + metric(technical.sampleRate, ' Hz') + '</span></div>' +
      '<div><b>' + escapeHtml(t('audioAnalysis.channels', '声道')) + '</b><span>' + (technical.channels == null ? '—' : escapeHtml(String(technical.channels))) + '</span></div>' +
      '<div><b>' + escapeHtml(t('audioAnalysis.peak', '峰值')) + '</b><span>' + metric(technical.peakDb, ' dBFS') + '</span></div>' +
      '<div><b>' + escapeHtml(t('audioAnalysis.rms', '平均响度')) + '</b><span>' + metric(technical.rmsDb, ' dBFS') + '</span></div>' +
      '</div>' +
      '<div class="h2s-audio-analysis-status"><b>' + escapeHtml(t('audioAnalysis.rhythm', '节奏')) + '</b><span>' + (rhythm.bpm == null ? escapeHtml(unavailable) : escapeHtml(String(rhythm.bpm) + ' BPM')) + '</span></div>' +
      '<div class="h2s-audio-analysis-status"><b>' + escapeHtml(t('audioAnalysis.harmony', '和声')) + '</b><span>' + (harmony.key == null ? escapeHtml(unavailable) : escapeHtml(String(harmony.key))) + '</span></div>' +
      '<div class="h2s-audio-analysis-status"><b>' + escapeHtml(t('audioAnalysis.instruments', '乐器')) + '</b><span>' + instrumentsHTML(instruments, t) + '</span></div>';
  }

  function create(opts){
    opts = opts || {};
    var doc = opts.document || (root && root.document) || null;
    var modal = opts.modalEl || null;
    var cache = new Map();
    var pending = new Map();
    var activeClipId = null;
    var engine = opts.engine || (root && root.H2SAudioAnalysis);
    var decoder = opts.decoder || (root && root.H2SAudioDecode);
    var instrumentAnalyzer = opts.instrumentAnalyzer || null;
    var t = opts.t || function(_key, fallback){ return fallback; };

    function cacheKey(clip){
      var asset = clip && clip.audio && clip.audio.assetRef ? String(clip.audio.assetRef) : '';
      var id = clip && clip.id != null ? String(clip.id) : '';
      return String((engine && engine.ANALYZER_VERSION) || 'audio-analysis-v0') + ':' + (asset || id + ':' + String(clip && clip.audio && clip.audio.durationSec || ''));
    }

    function ensureDom(){
      if (modal || !doc) return modal;
      modal = doc.createElement('div');
      modal.id = 'h2sAudioAnalysisModal';
      modal.className = 'h2s-audio-analysis-modal';
      modal.hidden = true;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = '<div class="h2s-audio-analysis-backdrop" data-act="close"></div>' +
        '<div class="h2s-audio-analysis-panel" role="document">' +
          '<div class="h2s-audio-analysis-header"><h3 data-role="title"></h3><button type="button" class="btn mini" data-act="close"></button></div>' +
          '<div data-role="content" aria-live="polite"></div>' +
        '</div>';
      (doc.body || doc.documentElement).appendChild(modal);
      bindModal();
      return modal;
    }

    function bindModal(){
      if (!modal || modal.__h2sAudioAnalysisBound || typeof modal.querySelector !== 'function') return;
      modal.__h2sAudioAnalysisBound = true;
      var closeButtons = modal.querySelectorAll ? modal.querySelectorAll('[data-act="close"]') : [];
      Array.prototype.forEach.call(closeButtons || [], function(button){ button.addEventListener('click', close); });
      modal.addEventListener('click', function(ev){
        var button = ev.target && ev.target.closest ? ev.target.closest('[data-act="reanalyze"]') : null;
        if (button && activeClipId) run(activeClipId, true);
      });
      if (root && root.addEventListener) root.addEventListener('keydown', function(ev){
        if (ev.key === 'Escape' && modal && !modal.hidden) close();
      });
    }

    function contentEl(){ return modal && typeof modal.querySelector === 'function' ? modal.querySelector('[data-role="content"]') : null; }
    function setVisible(value){ if (modal) modal.hidden = !value; }
    function renderLoading(){
      var el = contentEl();
      if (el) el.innerHTML = '<div class="h2s-audio-analysis-loading" data-role="loading-text">' + escapeHtml(t('audioAnalysis.loading', '正在分析…')) + '</div>';
    }
    function renderInstrumentProgress(progress){
      var el = contentEl();
      var label = el && el.querySelector ? el.querySelector('[data-role="loading-text"]') : null;
      if (!label) return;
      var value = Math.max(0, Math.min(100, Number(progress) || 0));
      label.textContent = t('audioAnalysis.instrumentLoading', '正在识别乐器…') + ' ' + Math.round(value) + '%';
    }
    function renderError(error){
      var el = contentEl();
      if (!el) return;
      var detail = error && error.message ? String(error.message) : '';
      el.innerHTML = '<div class="h2s-audio-analysis-error">' + escapeHtml(t('audioAnalysis.failed', '音频无法分析，请确认源文件仍在本机。')) + '</div>' +
        '<button type="button" class="btn mini" data-act="reanalyze">' + escapeHtml(t('audioAnalysis.retry', '重新分析')) + '</button>';
      if (detail && opts.debug) el.setAttribute('data-error', detail.slice(0, 120));
    }
    function renderResult(result){
      var el = contentEl();
      if (!el) return;
      el.innerHTML = resultHTML(result, t) + '<div class="h2s-audio-analysis-actions"><button type="button" class="btn mini" data-act="reanalyze">' + escapeHtml(t('audioAnalysis.reanalyze', '重新分析')) + '</button></div>';
    }

    async function run(clipId, force){
      var clip = typeof opts.getClip === 'function' ? opts.getClip(clipId) : null;
      if (!isAudioClip(clip)) return { ok: false, reason: 'not_audio_clip' };
      var key = cacheKey(clip);
      activeClipId = String(clipId);
      if (!force && cache.has(key)){
        renderResult(cache.get(key));
        return { ok: true, cached: true, result: cache.get(key) };
      }
      if (!force && pending.has(key)) return pending.get(key);
      renderLoading();
      var task = (async function(){
        try{
          if (!engine || typeof engine.analyzeAudioBuffer !== 'function') throw new Error('analysis_engine_unavailable');
          if (!decoder || typeof decoder.decodeAudioFile !== 'function') throw new Error('audio_decode_unavailable');
          var file = typeof opts.resolveAudioFile === 'function' ? await opts.resolveAudioFile(clipId) : null;
          if (!file) throw new Error('audio_source_missing');
          var buffer = await decoder.decodeAudioFile(file);
          var result = engine.analyzeAudioBuffer(buffer, { source: {
            clipId: clipId,
            assetId: clip.audio && clip.audio.assetRef ? clip.audio.assetRef : null,
          }});
          if (typeof instrumentAnalyzer === 'function'){
            try{
              result.instruments = await instrumentAnalyzer(buffer, {
                clipId: clipId,
                onProgress: renderInstrumentProgress,
              });
            }catch(instrumentError){
              result.instruments = { status: 'failed', error: String(instrumentError && instrumentError.message || instrumentError || 'instrument_analysis_failed') };
            }
          }
          cache.set(key, result);
          if (activeClipId === String(clipId)) renderResult(result);
          return { ok: true, cached: false, result: result };
        }catch(error){
          if (activeClipId === String(clipId)) renderError(error);
          return { ok: false, reason: 'analysis_failed', error: error };
        }finally{
          pending.delete(key);
        }
      })();
      pending.set(key, task);
      return task;
    }

    async function open(clipId){
      var clip = typeof opts.getClip === 'function' ? opts.getClip(clipId) : null;
      if (!isAudioClip(clip)) return { ok: false, reason: 'not_audio_clip' };
      ensureDom();
      bindModal();
      activeClipId = String(clipId);
      var title = modal && modal.querySelector ? modal.querySelector('[data-role="title"]') : null;
      var closeButton = modal && modal.querySelector ? modal.querySelector('.h2s-audio-analysis-header [data-act="close"]') : null;
      if (title) title.textContent = t('audioAnalysis.title', '音频分析');
      if (closeButton) closeButton.textContent = t('common.close', '关闭');
      setVisible(true);
      return run(clipId, false);
    }

    function close(){
      setVisible(false);
      activeClipId = null;
    }

    function clearCache(){ cache.clear(); }
    return { open: open, close: close, run: run, clearCache: clearCache, getCacheSize: function(){ return cache.size; }, cacheKey: cacheKey };
  }

  return { create: create, isAudioClip: isAudioClip, resultHTML: resultHTML, cacheKeyFor: function(clip, version){
    var asset = clip && clip.audio && clip.audio.assetRef ? String(clip.audio.assetRef) : '';
    var id = clip && clip.id != null ? String(clip.id) : '';
    return String(version || 'audio-analysis-v0') + ':' + (asset || id + ':' + String(clip && clip.audio && clip.audio.durationSec || ''));
  }};
});
