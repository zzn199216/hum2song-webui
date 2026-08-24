/**
 * Cloud Materials picker (Studio Cloud embed v0).
 * Loaded after cloud_project_bridge.js; uses parent postMessage for list/content.
 */
(function () {
  'use strict';

  function t(key, fallback) {
    try {
      if (window.I18N && typeof window.I18N.t === 'function') return window.I18N.t(key) || fallback || key;
    } catch (_e) {}
    return fallback || key;
  }

  function isCloudEmbed() {
    if (window.H2S_CLOUD_MODE === true) return true;
    try {
      var params = new URLSearchParams(window.location.search || '');
      if (params.get('cloudMode') === '1') return true;
      if (window.parent && window.parent !== window) {
        var ref = document.referrer || '';
        if (/https:\/\/hum2song\.cn\//i.test(ref)) return true;
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(ref)) return true;
      }
    } catch (_e2) {}
    return false;
  }

  function getApp() {
    return window.H2SApp || window.APP || window.app || null;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    var totalSec = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m > 0 ? m + ':' + String(s).padStart(2, '0') : totalSec + 's';
  }

  function formatCreatedAt(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return '';
      return d.toLocaleString();
    } catch (_e) {
      return '';
    }
  }

  function kindLabel(kind) {
    var map = {
      generated_music: t('cloudMaterials.kindGenerated', 'Generated music'),
      uploaded_audio: t('cloudMaterials.kindUploaded', 'Uploaded audio'),
      recording: t('cloudMaterials.kindRecording', 'Recording'),
      exported_audio: t('cloudMaterials.kindExported', 'Exported audio'),
    };
    return map[kind] || kind || t('cloudMaterials.kindOther', 'Audio');
  }

  function sourceLabel(channel) {
    var map = {
      linggan_go: t('cloudMaterials.sourceLinggan', 'Linggan Go'),
      hum2song_web: t('cloudMaterials.sourceWeb', 'Hum2Song Web'),
      hum2song_studio: t('cloudMaterials.sourceStudio', 'Hum2Song Studio'),
      hum2song: t('cloudMaterials.sourceHum2song', 'Hum2Song'),
    };
    return map[channel] || t('cloudMaterials.sourceUnknown', 'Unknown');
  }

  function setStatus(text, isError) {
    var el = document.getElementById('cloudMaterialsStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#fca5a5' : '';
  }

  function getModal() {
    return document.getElementById('cloudMaterialsModal');
  }

  var listLoading = false;
  var importingAssetId = null;

  function openModal() {
    var modal = getModal();
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    void refreshList();
  }

  function closeModal() {
    var modal = getModal();
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function renderList(materials) {
    var list = document.getElementById('cloudMaterialsList');
    if (!list) return;
    list.innerHTML = '';
    if (!materials || !materials.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.style.cssText = 'grid-column:1/-1;font-size:13px;margin:0;';
      empty.textContent = t('cloudMaterials.empty', 'No cloud audio materials yet.');
      list.appendChild(empty);
      return;
    }
    materials.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'cloudMaterialsCard';
      var title = escapeHtml(item.title || item.id);
      var metaParts = [
        kindLabel(item.materialKind),
        formatDurationMs(item.durationMs),
        sourceLabel(item.sourceChannel),
      ];
      var created = formatCreatedAt(item.createdAt || item.created_at);
      if (created) metaParts.push(created);
      var meta = escapeHtml(metaParts.join(' · '));
      var prompt =
        item.promptText && String(item.promptText).trim()
          ? '<div class="cloudMaterialsCardPrompt">' + escapeHtml(item.promptText) + '</div>'
          : '';
      var importDisabled = !item.playable;
      card.innerHTML =
        '<div class="cloudMaterialsCardTitle">' +
        title +
        '</div>' +
        '<div class="cloudMaterialsCardMeta">' +
        meta +
        '</div>' +
        prompt +
        '<div class="cloudMaterialsCardActions">' +
        '<button type="button" class="btn mini cloudMaterialsImportBtn" data-asset-id="' +
        escapeHtml(item.id) +
        '" data-title="' +
        escapeHtml(item.title || item.id) +
        '"' +
        (importDisabled ? ' disabled' : '') +
        '>' +
        escapeHtml(t('cloudMaterials.importToTimeline', 'Import to timeline')) +
        '</button>' +
        (importDisabled
          ? '<span class="muted" style="font-size:11px;">' +
            escapeHtml(t('cloudMaterials.notPlayable', 'Not playable')) +
            '</span>'
          : '') +
        '</div>';
      list.appendChild(card);
    });
    list.querySelectorAll('.cloudMaterialsImportBtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var assetId = btn.getAttribute('data-asset-id');
        var title = btn.getAttribute('data-title') || assetId;
        void importMaterial(assetId, title, btn);
      });
    });
  }

  async function importMaterial(assetId, title, btn) {
    if (!assetId) return;
    if (importingAssetId === assetId) return;
    if (typeof window.H2S_REQUEST_CLOUD_MATERIAL_CONTENT !== 'function') {
      setStatus(t('cloudMaterials.bridgeMissing', 'Cloud bridge unavailable.'), true);
      return;
    }
    importingAssetId = assetId;
    if (btn) btn.disabled = true;
    document.querySelectorAll('.cloudMaterialsImportBtn').forEach(function (b) {
      if (b.getAttribute('data-asset-id') === assetId) b.disabled = true;
    });
    setStatus(t('cloudMaterials.importing', 'Importing…'), false);
    window.H2S_REQUEST_CLOUD_MATERIAL_CONTENT(assetId, title);
    var detail = await waitForContentResponse();
    importingAssetId = null;
    if (btn) btn.disabled = false;
    document.querySelectorAll('.cloudMaterialsImportBtn').forEach(function (b) {
      if (b.getAttribute('data-asset-id') === assetId) b.disabled = false;
    });
    if (!detail || !detail.ok || !(detail.audioBuffer instanceof ArrayBuffer)) {
      setStatus(mapContentError(detail && detail.error), true);
      return;
    }
    var app = getApp();
    if (!app || typeof app._commitNativeAudioFile !== 'function') {
      setStatus(t('cloudMaterials.importUnavailable', 'Audio import is unavailable in Studio.'), true);
      return;
    }
    var mime = detail.mimeType || 'audio/mpeg';
    var blob = new Blob([detail.audioBuffer], { type: mime });
    var ext =
      mime.indexOf('wav') >= 0 ? '.wav' : mime.indexOf('ogg') >= 0 ? '.ogg' : mime.indexOf('mpeg') >= 0 || mime.indexOf('mp3') >= 0 ? '.mp3' : '.audio';
    try {
      var file = new File([blob], (detail.title || title || 'cloud-material') + ext, { type: mime });
      var res = await app._commitNativeAudioFile(file, {
        baseName: detail.title || title || 'Cloud material',
        statusDoneKey: 'cloudMaterials.importDone',
        sourceMetadata: { cloudSourceAssetId: assetId },
      });
      if (!res || res.ok !== true) {
        setStatus(t('cloudMaterials.importFailed', 'Import failed.'), true);
        return;
      }
      setStatus(t('cloudMaterials.importDone', 'Imported to clip library.'), false);
    } catch (e) {
      console.warn('[cloud_materials_panel] import failed', e);
      setStatus(t('cloudMaterials.importFailed', 'Import failed.'), true);
    }
  }

  function mapContentError(code) {
    var key = typeof code === 'string' ? code : '';
    if (key === 'auth_required' || key === 'materials_inspiration_login_required')
      return t('cloudMaterials.authRequired', 'Sign in to Hum2Song Cloud to import materials.');
    if (key === 'materials_no_playable_audio') return t('cloudMaterials.noPlayable', 'This material has no playable audio.');
    if (key === 'materials_audio_load_failed') return t('cloudMaterials.loadFailed', 'Could not load material audio.');
    if (key === 'bad_request') return t('cloudMaterials.badRequest', 'Invalid material request.');
    return t('cloudMaterials.importFailed', 'Import failed.');
  }

  function mapListError(code) {
    var key = typeof code === 'string' ? code : '';
    if (key === 'auth_required') return t('cloudMaterials.authRequired', 'Sign in to Hum2Song Cloud to import materials.');
    if (key === 'list_failed') return t('cloudMaterials.listFailed', 'Could not load cloud materials.');
    return t('cloudMaterials.listFailed', 'Could not load cloud materials.');
  }

  function waitForListResponse() {
    return new Promise(function (resolve) {
      var done = false;
      var onEvt = function (ev) {
        if (done) return;
        done = true;
        window.removeEventListener('h2s-cloud-materials-list', onEvt);
        resolve(ev && ev.detail ? ev.detail : null);
      };
      window.addEventListener('h2s-cloud-materials-list', onEvt);
      setTimeout(function () {
        if (done) return;
        done = true;
        window.removeEventListener('h2s-cloud-materials-list', onEvt);
        resolve({ ok: false, error: 'timeout' });
      }, 30000);
    });
  }

  function waitForContentResponse() {
    return new Promise(function (resolve) {
      var done = false;
      var onEvt = function (ev) {
        if (done) return;
        done = true;
        window.removeEventListener('h2s-cloud-material-content', onEvt);
        resolve(ev && ev.detail ? ev.detail : null);
      };
      window.addEventListener('h2s-cloud-material-content', onEvt);
      setTimeout(function () {
        if (done) return;
        done = true;
        window.removeEventListener('h2s-cloud-material-content', onEvt);
        resolve({ ok: false, error: 'timeout' });
      }, 60000);
    });
  }

  function setRefreshDisabled(disabled) {
    var refresh = document.getElementById('btnCloudMaterialsRefresh');
    if (refresh) refresh.disabled = !!disabled;
  }

  async function refreshList() {
    if (listLoading) return;
    if (typeof window.H2S_REQUEST_CLOUD_MATERIALS_LIST !== 'function') {
      setStatus(t('cloudMaterials.bridgeMissing', 'Cloud bridge unavailable.'), true);
      return;
    }
    listLoading = true;
    setRefreshDisabled(true);
    setStatus(t('cloudMaterials.loading', 'Loading cloud materials…'), false);
    var list = document.getElementById('cloudMaterialsList');
    if (list) list.setAttribute('aria-busy', 'true');
    try {
      window.H2S_REQUEST_CLOUD_MATERIALS_LIST();
      var detail = await waitForListResponse();
      if (!detail || detail.ok !== true) {
        setStatus(mapListError(detail && detail.error), true);
        renderList([]);
        return;
      }
      setStatus('', false);
      renderList(detail.materials || []);
      try {
        if (window.H2SStartupPerf && typeof window.H2SStartupPerf.mark === 'function') {
          window.H2SStartupPerf.mark('studio_cloud_materials_ready');
        }
      } catch (_perf) {}
    } finally {
      listLoading = false;
      setRefreshDisabled(false);
      if (list) list.removeAttribute('aria-busy');
    }
  }

  function applyCloudModeUi() {
    var section = document.getElementById('cloudMaterialsSection');
    var standalone = document.getElementById('cloudMaterialsStandalone');
    var toggle = document.getElementById('btnCloudMaterials');
    var refresh = document.getElementById('btnCloudMaterialsRefresh');
    if (!section) return;
    if (isCloudEmbed()) {
      window.H2S_CLOUD_MODE = true;
      section.style.display = 'block';
      if (standalone) standalone.style.display = 'none';
      if (toggle) {
        toggle.disabled = false;
        toggle.title = '';
      }
      if (refresh) refresh.style.display = 'inline-block';
    } else {
      section.style.display = 'block';
      if (standalone) standalone.style.display = 'block';
      if (toggle) {
        toggle.disabled = true;
        toggle.title = t('cloudMaterials.standaloneHint', 'Cloud materials are available when opened from Hum2Song Cloud.');
      }
      if (refresh) refresh.style.display = 'none';
    }
  }

  function bindUi() {
    var toggle = document.getElementById('btnCloudMaterials');
    var closeBtn = document.getElementById('btnCloudMaterialsModalClose');
    var refresh = document.getElementById('btnCloudMaterialsRefresh');
    var modal = getModal();
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (!isCloudEmbed()) return;
        openModal();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (refresh) refresh.addEventListener('click', function () { void refreshList(); });
    if (modal) {
      var backdrop = modal.querySelector('[data-act="closeCloudMaterials"]');
      if (backdrop) backdrop.addEventListener('click', closeModal);
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var m = getModal();
      if (m && !m.hidden) closeModal();
    });
  }

  function boot() {
    applyCloudModeUi();
    bindUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
