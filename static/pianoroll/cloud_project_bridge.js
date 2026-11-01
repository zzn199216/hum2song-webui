/**
 * Cloud embed postMessage bridge (dev v0).
 * Loaded after app.js so H2SApp / APP is available.
 */
(function () {
  'use strict';

  var LOCAL_CLOUD_PARENT_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3010',
    'http://127.0.0.1:3010',
    'http://localhost:3012',
    'http://127.0.0.1:3012',
  ];
  var PRODUCTION_CLOUD_PARENT_ORIGINS = [
    'https://hum2song.cn',
    'https://www.hum2song.cn',
    'https://hum2song.com',
    'https://www.hum2song.com',
  ];

  function _normalizeStudioLocale(locale) {
    var raw = String(locale || '').trim().toLowerCase().replace(/_/g, '-');
    if (!raw) return null;
    if (raw === 'zh' || raw.indexOf('zh-') === 0) return 'zh';
    if (raw === 'ja' || raw === 'ja-jp' || raw.indexOf('ja-') === 0) return 'ja';
    if (raw === 'en' || raw.indexOf('en-') === 0) return 'en';
    return null;
  }

  function isProductionStudioHost() {
    return window.location && window.location.hostname === 'studio.hum2song.cn';
  }

  function parseCloudParentOrigins(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    return value.split(',');
  }

  function isExactHttpOrigin(origin) {
    var trimmed = typeof origin === 'string' ? origin.trim() : '';
    if (!trimmed || trimmed.indexOf('*') >= 0) return false;
    try {
      var parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return parsed.origin === trimmed;
    } catch (_err) {
      return false;
    }
  }

  function configuredCloudOrigins() {
    var origins = LOCAL_CLOUD_PARENT_ORIGINS.slice();
    parseCloudParentOrigins(window.H2S_CLOUD_PARENT_ORIGINS).forEach(function (origin) {
      var trimmed = typeof origin === 'string' ? origin.trim() : '';
      if (isExactHttpOrigin(trimmed)) origins.push(trimmed);
    });
    if (isProductionStudioHost()) {
      PRODUCTION_CLOUD_PARENT_ORIGINS.forEach(function (origin) {
        origins.push(origin);
      });
    }
    return new Set(origins);
  }

  function allowedOrigin(origin) {
    return typeof origin === 'string' && configuredCloudOrigins().has(origin);
  }

  function getApp() {
    return window.H2SApp || window.APP || window.app || null;
  }

  function deepClone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function postBack(origin, payload) {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage(payload, origin);
  }

  function isCloudModeRequested() {
    try {
      if (window.H2S_CLOUD_MODE === true) return true;
      var params = new URLSearchParams(window.location.search || '');
      if (params.get('cloudMode') === '1') return true;
      if (window.parent && window.parent !== window) {
        var ref = document.referrer || '';
        if (ref && allowedOrigin(new URL(ref).origin)) return true;
      }
    } catch (_err) {}
    return false;
  }

  function rerenderAiSettingsDrawerIfOpen() {
    var app = getApp();
    if (!app || !app.state || !app.state.aiSettingsOpen) return;
    if (typeof app.render === 'function') app.render();
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }

  function renderCloudAiStatus() {
    var local = document.getElementById('editorLocalLlmSettings');
    var panel = document.getElementById('editorCloudAiPanel');
    if (!panel || !local || !window.H2S_CLOUD_MODE) return;
    local.style.display = 'none';
    panel.style.display = 'block';

    var status = window.H2S_CLOUD_AI_STATUS;
    if (!status) {
      setText('editorCloudAiStatus', '');
      setText('editorCloudAiQuota', '');
      setText('editorCloudAiPresets', '');
      return;
    }
    if (status.loading) {
      setText('editorCloudAiStatus', '正在加载云端 AI 能力...');
      setText('editorCloudAiQuota', '');
      setText('editorCloudAiPresets', '');
      return;
    }
    if (!status.ok) {
      setText('editorCloudAiStatus', '云端 AI 暂不可用，请稍后再试。');
      setText('editorCloudAiQuota', '');
      setText('editorCloudAiPresets', '');
      return;
    }
    var quota = status.quota || {};
    var presetsBody = status.presets || {};
    var presets = Array.isArray(presetsBody.presets) ? presetsBody.presets : [];
    setText('editorCloudAiStatus', '当前套餐：' + (quota.planCode || presetsBody.planCode || 'free'));
    setText(
      'editorCloudAiQuota',
      '额度：' + (quota.remaining != null ? quota.remaining : '-') + '/' + (quota.limit != null ? quota.limit : '-') + ' · ' + (quota.period || '-')
    );
    setText('editorCloudAiPresets', presets.length ? ('可用预设：' + presets.map(function (p) { return p.name || p.id; }).join(' / ')) : '暂无可用云端 AI 预设。');
  }

  var _cloudAiStatusRequested = false;

  function clearCloudRuntimeState() {
    _cloudAiStatusRequested = false;
    window.H2S_CLOUD_AI_STATUS = null;
    window.H2S_CLOUD_AI_STATUS_REQUEST_ID = '';
    window.H2S_CLOUD_AI_CHAT_RESULT = null;
    window.H2S_CLOUD_AI_CHAT_REQUEST_ID = '';
    window.H2S_CLOUD_MATERIALS_LIST_RESULT = null;
    window.H2S_CLOUD_MATERIALS_LIST_REQUEST_ID = '';
    window.H2S_CLOUD_MATERIAL_CONTENT_RESULT = null;
    window.H2S_CLOUD_MATERIAL_CONTENT_REQUEST_ID = '';
    window.H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE_RESULT = null;
    window.H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS_RESULT = null;
    renderCloudAiStatus();
  }

  function requestCloudAiStatus() {
    if (!window.H2S_CLOUD_MODE || !window.parent || window.parent === window) return;
    if (_cloudAiStatusRequested && window.H2S_CLOUD_AI_STATUS && !window.H2S_CLOUD_AI_STATUS.loading) return;
    _cloudAiStatusRequested = true;
    var requestId = 'cloud-ai-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    window.H2S_CLOUD_AI_STATUS_REQUEST_ID = requestId;
    window.H2S_CLOUD_AI_STATUS = { loading: true };
    renderCloudAiStatus();
    window.parent.postMessage({
      type: 'H2S_CLOUD_AI_STATUS_REQUEST',
      requestId: requestId,
    }, '*');
  }

  function scheduleCloudAiStatusRequest() {
    if (!window.H2S_CLOUD_MODE) return;
    if (_cloudAiStatusRequested) return;
    requestCloudAiStatus();
  }

  window.H2S_REQUEST_CLOUD_AI_STATUS = requestCloudAiStatus;
  window.H2S_SCHEDULE_CLOUD_AI_STATUS = scheduleCloudAiStatusRequest;

  function postToCloudHost(payload) {
    if (!window.parent || window.parent === window) return false;
    window.parent.postMessage(payload, '*');
    return true;
  }

  function newCloudRequestId(prefix) {
    return (prefix || 'cloud') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function availableCloudAiPresets() {
    var status = window.H2S_CLOUD_AI_STATUS;
    var raw = status && status.presets;
    var presets = raw && Array.isArray(raw.modelProfiles) ? raw.modelProfiles : (Array.isArray(raw) ? raw : (raw && Array.isArray(raw.presets) ? raw.presets : []));
    return presets.filter(function (p) {
      return p && typeof p === 'object' && p.id && p.available !== false && p.enabled !== false;
    });
  }

  function selectedCloudAiPresetId(cfg) {
    var presets = availableCloudAiPresets();
    var configured = '';
    if (cfg && typeof cfg.modelProfileId === 'string' && cfg.modelProfileId.trim()) configured = cfg.modelProfileId.trim();
    else if (cfg && typeof cfg.presetId === 'string' && cfg.presetId.trim()) configured = cfg.presetId.trim();
    if (configured && presets.some(function (p) { return p.id === configured; })) return configured;
    var stored = '';
    try { stored = String(localStorage.getItem('h2s_cloud_ai_selected_model_profile_id') || localStorage.getItem('h2s_cloud_ai_selected_preset_id') || '').trim(); } catch (_e) {}
    if (stored && presets.some(function (p) { return p.id === stored; })) return stored;
    var preferred = presets.find(function (p) { return p.id === 'auto'; }) || presets.find(function (p) { return p.id === 'qwen36_flash' || p.id === 'free_basic' || p.id === 'preview_standard'; });
    return (preferred || presets[0] || {}).id || '';
  }

  function chatMessageStats(messages) {
    var arr = Array.isArray(messages) ? messages : [];
    var totalChars = 0;
    var maxMessageChars = 0;
    var assistantMessages = 0;
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i] || {};
      var len = typeof m.content === 'string' ? m.content.length : 0;
      totalChars += len;
      if (len > maxMessageChars) maxMessageChars = len;
      if (m.role === 'assistant') assistantMessages += 1;
    }
    return {
      messagesCount: arr.length,
      totalChars: totalChars,
      maxMessageChars: maxMessageChars,
      historyIncluded: assistantMessages > 0 || arr.length > 2,
    };
  }

  function positiveIntOrNull(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 1) return null;
    return Math.floor(n);
  }

  function friendlyCloudAiError(error) {
    var msg = typeof error === 'string' ? error : '';
    if (/request input is too large|request is too large|413/i.test(msg)) {
      return 'AI arrangement request is too large for the current plan limit. Try a shorter clip.';
    }
    return msg || 'cloud_ai_request_failed';
  }

  function callCloudChatCompletions(cfg, messages, opts) {
    if (!window.H2S_CLOUD_MODE && !isCloudModeRequested()) {
      return Promise.reject(new Error('cloud_ai_bridge_unavailable'));
    }
    if (!window.parent || window.parent === window) {
      return Promise.reject(new Error('cloud_ai_parent_unavailable'));
    }
    var modelProfileId = selectedCloudAiPresetId(cfg);
    if (!modelProfileId) return Promise.reject(new Error('cloud_ai_model_profile_missing'));
    var requestedMaxOutputTokens = positiveIntOrNull(opts && (opts.requestedMaxOutputTokens != null ? opts.requestedMaxOutputTokens : opts.maxOutputTokens));
    var noteCount = positiveIntOrNull(opts && opts.noteCount);
    var task = opts && opts.task === 'studio_ai_optimize' ? 'studio_ai_optimize' : '';
    var presetId = 'free_basic';
    var safeMessages = Array.isArray(messages) ? messages.map(function (m) {
      if (!m || typeof m !== 'object') return null;
      var role = m.role === 'system' || m.role === 'user' || m.role === 'assistant' ? m.role : null;
      var content = typeof m.content === 'string' ? m.content : '';
      return role && content ? { role: role, content: content } : null;
    }).filter(Boolean) : [];
    if (!safeMessages.length) return Promise.reject(new Error('cloud_ai_messages_missing'));
    var diagnostics = chatMessageStats(safeMessages);

    return new Promise(function (resolve, reject) {
      var requestId = newCloudRequestId('cloud-ai-llm');
      var timeoutMs = opts && typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : 600000;
      var done = false;
      var timer = null;
      function cleanup() {
        if (timer) clearTimeout(timer);
        window.removeEventListener('h2s-cloud-ai-chat-response', onResponse);
      }
      function finish(fn, value) {
        if (done) return;
        done = true;
        cleanup();
        fn(value);
      }
      function onResponse(ev) {
        var detail = ev && ev.detail ? ev.detail : null;
        if (!detail || detail.requestId !== requestId) return;
        if (detail.ok === true) {
          finish(resolve, {
            text: typeof detail.text === 'string' ? detail.text : '',
            raw: {
              usage: detail.usage || null,
              finish_reason: detail.finishReason || '',
              requestId: detail.requestId,
              providerId: typeof detail.providerId === 'string' ? detail.providerId : '',
              modelTier: typeof detail.modelTier === 'string' ? detail.modelTier : '',
              modelProfileId: typeof detail.modelProfileId === 'string' ? detail.modelProfileId : '',
              resolvedModelProfileId: typeof detail.resolvedModelProfileId === 'string' ? detail.resolvedModelProfileId : '',
              requestedMaxOutputTokens: typeof detail.requestedMaxOutputTokens === 'number' ? detail.requestedMaxOutputTokens : undefined,
              effectiveMaxOutputTokens: typeof detail.effectiveMaxOutputTokens === 'number' ? detail.effectiveMaxOutputTokens : undefined,
              providerMaxOutputTokens: typeof detail.providerMaxOutputTokens === 'number' ? detail.providerMaxOutputTokens : undefined,
              outputTokenLimitReason: typeof detail.outputTokenLimitReason === 'string' ? detail.outputTokenLimitReason : '',
            },
          });
          return;
        }
        finish(reject, new Error(friendlyCloudAiError(detail.error || 'cloud_ai_request_failed')));
      }
      timer = setTimeout(function () {
        finish(reject, new Error('cloud_ai_request_timeout'));
      }, timeoutMs);
      window.addEventListener('h2s-cloud-ai-chat-response', onResponse);
      window.H2S_CLOUD_MODE = true;
      window.H2S_CLOUD_AI_CHAT_REQUEST_ID = requestId;
      window.H2S_CLOUD_AI_CHAT_RESULT = { loading: true, requestId: requestId };
      if (typeof console !== 'undefined' && console && typeof console.info === 'function') {
        console.info('[h2s-cloud-ai] chat request', {
          requestId: requestId,
          presetId: presetId,
          modelProfileId: modelProfileId,
          requestedMaxOutputTokens: requestedMaxOutputTokens,
          noteCount: noteCount,
          task: task,
          messagesCount: diagnostics.messagesCount,
          totalChars: diagnostics.totalChars,
          maxMessageChars: diagnostics.maxMessageChars,
          historyIncluded: diagnostics.historyIncluded,
        });
      }
      window.parent.postMessage({
        type: 'H2S_CLOUD_AI_CHAT_REQUEST',
        requestId: requestId,
        presetId: presetId,
        modelProfileId: modelProfileId,
        requestedMaxOutputTokens: requestedMaxOutputTokens,
        noteCount: noteCount,
        task: task,
        messages: safeMessages,
        diagnostics: diagnostics,
      }, '*');
    });
  }

  function stripThinkBlocks(text) {
    var s = typeof text === 'string' ? text : '';
    if (!s) return '';
    return s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').replace(/<think\b[^>]*>[\s\S]*$/i, '').trim();
  }

  function extractCloudJsonObject(text) {
    if (text == null || typeof text !== 'string') return null;
    var s = stripThinkBlocks(text);
    if (!s) return null;
    try {
      var parsed = JSON.parse(s);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_e1) {}
    try {
      var match = s.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match && match[1]) {
        var block = match[1].trim();
        var p = JSON.parse(block);
        if (p !== null && typeof p === 'object' && !Array.isArray(p)) return p;
      }
    } catch (_e2) {}
    try {
      var first = s.indexOf('{');
      if (first < 0) return null;
      var depth = 0;
      var end = -1;
      for (var i = first; i < s.length; i++) {
        var ch = s[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end >= first) {
        var slice = s.slice(first, end + 1);
        var obj = JSON.parse(slice);
        if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      }
    } catch (_e3) {}
    return null;
  }

  window.H2S_CLOUD_LLM_CLIENT = {
    callCloudChatCompletions: callCloudChatCompletions,
    callChatCompletions: callCloudChatCompletions,
    extractJsonObject: extractCloudJsonObject,
  };

  function requestCloudMaterialsList() {
    if (!window.H2S_CLOUD_MODE && !isCloudModeRequested()) return false;
    window.H2S_CLOUD_MODE = true;
    var requestId = newCloudRequestId('cloud-materials-list');
    window.H2S_CLOUD_MATERIALS_LIST_REQUEST_ID = requestId;
    window.H2S_CLOUD_MATERIALS_LIST_RESULT = { loading: true, requestId: requestId };
    return postToCloudHost({ type: 'H2S_CLOUD_MATERIALS_LIST_REQUEST', requestId: requestId });
  }

  function requestCloudMaterialContent(assetId, title) {
    if (!window.H2S_CLOUD_MODE && !isCloudModeRequested()) return false;
    var id = typeof assetId === 'string' ? assetId.trim() : '';
    if (!id) return false;
    window.H2S_CLOUD_MODE = true;
    var requestId = newCloudRequestId('cloud-material-content');
    window.H2S_CLOUD_MATERIAL_CONTENT_REQUEST_ID = requestId;
    window.H2S_CLOUD_MATERIAL_CONTENT_RESULT = { loading: true, requestId: requestId, id: id };
    return postToCloudHost({
      type: 'H2S_CLOUD_MATERIAL_CONTENT_REQUEST',
      requestId: requestId,
      assetId: id,
      title: typeof title === 'string' ? title : '',
    });
  }

  window.H2S_REQUEST_CLOUD_MATERIALS_LIST = requestCloudMaterialsList;
  window.H2S_REQUEST_CLOUD_MATERIAL_CONTENT = requestCloudMaterialContent;

  function isProjectDocLikely(projectDoc) {
    if (!projectDoc || typeof projectDoc !== 'object' || Array.isArray(projectDoc)) return false;
    if (projectDoc.version === 2) return true;
    if (projectDoc.timebase === 'beat') return true;
    return false;
  }

  window.addEventListener('message', async function (event) {
    if (!allowedOrigin(event.origin)) return;

    var data = event.data;
    if (!data || typeof data !== 'object') return;

    var type = data.type;
    if (typeof type !== 'string') return;

    switch (type) {
      case 'H2S_CLOUD_IMPORT_MATERIAL': {
        if (event.source !== window.parent || !window.H2S_CLOUD_AUTHENTICATED || typeof data.requestId !== 'string') return;
        if (typeof window.H2S_IMPORT_CLOUD_MATERIAL !== 'function') {
          postBack(event.origin,{type:'H2S_CLOUD_IMPORT_MATERIAL_RESULT',requestId:data.requestId,ok:false,error:'not_ready'});return;
        }
        Promise.resolve(window.H2S_IMPORT_CLOUD_MATERIAL(data.assetId,data.title,null,{deduplicate:true}))
          .then(function(result){postBack(event.origin,{type:'H2S_CLOUD_IMPORT_MATERIAL_RESULT',requestId:data.requestId,
            ok:!!(result && result.ok),alreadyImported:!!(result && result.alreadyImported),error:result && result.error});})
          .catch(function(){postBack(event.origin,{type:'H2S_CLOUD_IMPORT_MATERIAL_RESULT',requestId:data.requestId,ok:false,error:'import_failed'});});
        return;
      }
      case 'H2S_HOST_BIND_STUDIO_SESSION': {
        if (event.source !== window.parent || data.version !== 1) return;
        if (window.H2SCloudBoot) window.H2SCloudBoot.bind(data.hostSessionKey);
        return;
      }
      case 'H2S_CLOUD_PING':
        if (window.H2SStudioUi) window.H2SStudioUi.notify();
        postBack(event.origin, {
          type: 'H2S_CLOUD_PONG',
          requestId: data.requestId,
          ok: true,
        });
        return;

      case 'H2S_HOST_RESET_STUDIO_STATE': {
        if (data.version !== 1) return;
        clearCloudRuntimeState();
        var resetApp = getApp();
        var hostSessionKey = typeof data.hostSessionKey === 'string' ? data.hostSessionKey : '';
        if (resetApp && typeof resetApp.resetForCloudHostSessionChange === 'function') {
          resetApp.resetForCloudHostSessionChange(hostSessionKey);
        }
        postBack(event.origin, {
          type: 'H2S_HOST_RESET_STUDIO_STATE_RESULT',
          requestId: data.requestId,
          ok: true,
        });
        return;
      }

      case 'H2S_CLOUD_AI_STATUS_RESPONSE': {
        if (!window.H2S_CLOUD_AI_STATUS_REQUEST_ID || data.requestId !== window.H2S_CLOUD_AI_STATUS_REQUEST_ID) return;
        window.H2S_CLOUD_MODE = true;
        window.H2S_CLOUD_AI_STATUS = {
          loading: false,
          ok: data.ok === true,
          presets: data.presets,
          quota: data.quota,
          error: typeof data.error === 'string' ? data.error : null,
        };
        renderCloudAiStatus();
        window.dispatchEvent(new CustomEvent('h2s-cloud-ai-status', { detail: window.H2S_CLOUD_AI_STATUS }));
        rerenderAiSettingsDrawerIfOpen();
        return;
      }

      case 'H2S_CLOUD_AI_CHAT_RESPONSE': {
        if (typeof data.requestId !== 'string' || !data.requestId) return;
        window.H2S_CLOUD_MODE = true;
        window.H2S_CLOUD_AI_CHAT_RESULT = {
          loading: false,
          requestId: data.requestId,
          ok: data.ok === true,
          text: typeof data.text === 'string' ? data.text : '',
          usage: data.usage && typeof data.usage === 'object' ? data.usage : null,
          finishReason: typeof data.finishReason === 'string' ? data.finishReason : '',
          providerId: typeof data.providerId === 'string' ? data.providerId : '',
          modelTier: typeof data.modelTier === 'string' ? data.modelTier : '',
          modelProfileId: typeof data.modelProfileId === 'string' ? data.modelProfileId : '',
          resolvedModelProfileId: typeof data.resolvedModelProfileId === 'string' ? data.resolvedModelProfileId : '',
          requestedMaxOutputTokens: typeof data.requestedMaxOutputTokens === 'number' ? data.requestedMaxOutputTokens : undefined,
          effectiveMaxOutputTokens: typeof data.effectiveMaxOutputTokens === 'number' ? data.effectiveMaxOutputTokens : undefined,
          providerMaxOutputTokens: typeof data.providerMaxOutputTokens === 'number' ? data.providerMaxOutputTokens : undefined,
          outputTokenLimitReason: typeof data.outputTokenLimitReason === 'string' ? data.outputTokenLimitReason : '',
          status: typeof data.status === 'number' ? data.status : null,
          error: typeof data.error === 'string' ? data.error : null,
        };
        window.dispatchEvent(new CustomEvent('h2s-cloud-ai-chat-response', { detail: window.H2S_CLOUD_AI_CHAT_RESULT }));
        rerenderAiSettingsDrawerIfOpen();
        return;
      }

      case 'H2S_CLOUD_REQUEST_PROJECT': {
        var app = getApp();
        if (!app || typeof app.getProjectV2 !== 'function') {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: 'studio_app_or_getProjectV2_unavailable',
          });
          return;
        }
        var raw;
        try {
          raw = app.getProjectV2();
        } catch (err) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: (err && (err.message || String(err))) || 'getProjectV2_failed',
          });
          return;
        }
        if (!raw || typeof raw !== 'object') {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: 'no_project',
          });
          return;
        }
        try {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: true,
            projectDoc: deepClone(raw),
          });
        } catch (err2) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_PROJECT_SNAPSHOT',
            requestId: data.requestId,
            ok: false,
            error: (err2 && (err2.message || String(err2))) || 'clone_failed',
          });
        }
        return;
      }

      case 'H2S_HOST_SET_LOCALE': {
        if (data.version !== 1) return;
        var loc = _normalizeStudioLocale(data.locale);
        if (!loc) return;
        try{
          var _h = typeof location !== 'undefined' ? String(location.hostname || '') : '';
          if (_h === 'localhost' || _h === '127.0.0.1'){
            console.debug('[h2s-oss] H2S_HOST_SET_LOCALE apply', loc);
          }
        }catch(e){}
        var MAX_DEFER = 50;
        var langSupported = function (I18N, code) {
          var list = typeof I18N.availableLanguages === 'function' ? I18N.availableLanguages() : [];
          for (var li = 0; li < list.length; li++) {
            var it = list[li];
            var c = typeof it === 'string' ? it : (it && it.code);
            if (c === code) return true;
          }
          return false;
        };
        var tryApply = function (n) {
          var app = getApp();
          var I18N = typeof window !== 'undefined' ? window.I18N : null;
          if (!I18N || typeof I18N.availableLanguages !== 'function') {
            if (n >= MAX_DEFER) {
              console.warn('[cloud_project_bridge] H2S_HOST_SET_LOCALE: I18N not ready');
              return;
            }
            setTimeout(function () {
              tryApply(n + 1);
            }, 60);
            return;
          }
          if (!langSupported(I18N, loc)) {
            console.warn('[cloud_project_bridge] H2S_HOST_SET_LOCALE unsupported locale', loc);
            return;
          }
          if (app && typeof app.applyStudioLanguage === 'function') {
            app.applyStudioLanguage(loc, { persist: false, source: 'host' }).catch(function (e) {
              console.warn('[cloud_project_bridge] H2S_HOST_SET_LOCALE apply failed', e);
            });
            return;
          }
          if (n >= MAX_DEFER) {
            console.warn('[cloud_project_bridge] H2S_HOST_SET_LOCALE: applyStudioLanguage not available');
            return;
          }
          setTimeout(function () {
            tryApply(n + 1);
          }, 60);
        };
        tryApply(0);
        return;
      }

      case 'H2S_CLOUD_MATERIALS_LIST_RESPONSE': {
        if (!data.requestId || data.requestId !== window.H2S_CLOUD_MATERIALS_LIST_REQUEST_ID) return;
        window.H2S_CLOUD_MODE = true;
        window.H2S_CLOUD_MATERIALS_LIST_RESULT = {
          loading: false,
          requestId: data.requestId,
          ok: data.ok === true,
          materials: Array.isArray(data.materials) ? data.materials : [],
          error: typeof data.error === 'string' ? data.error : null,
        };
        window.dispatchEvent(new CustomEvent('h2s-cloud-materials-list', { detail: window.H2S_CLOUD_MATERIALS_LIST_RESULT }));
        return;
      }

      case 'H2S_CLOUD_MATERIAL_CONTENT_RESPONSE': {
        if (!data.requestId || data.requestId !== window.H2S_CLOUD_MATERIAL_CONTENT_REQUEST_ID) return;
        window.H2S_CLOUD_MODE = true;
        window.H2S_CLOUD_MATERIAL_CONTENT_RESULT = {
          loading: false,
          requestId: data.requestId,
          ok: data.ok === true,
          id: typeof data.id === 'string' ? data.id : '',
          title: typeof data.title === 'string' ? data.title : '',
          mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'application/octet-stream',
          audioBuffer: data.audioBuffer instanceof ArrayBuffer ? data.audioBuffer : null,
          error: typeof data.error === 'string' ? data.error : null,
        };
        window.dispatchEvent(new CustomEvent('h2s-cloud-material-content', { detail: window.H2S_CLOUD_MATERIAL_CONTENT_RESULT }));
        return;
      }

      case 'H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE_RESPONSE': {
        if (typeof data.requestId !== 'string' || !data.requestId) return;
        window.H2S_CLOUD_MODE = true;
        window.H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE_RESULT = {
          loading: false,
          requestId: data.requestId,
          ok: data.ok === true,
          status: typeof data.status === 'number' ? data.status : null,
          job: data.job && typeof data.job === 'object' ? data.job : null,
          error: typeof data.error === 'string' ? data.error : null,
        };
        window.dispatchEvent(new CustomEvent('h2s-cloud-humming-music-job-create', { detail: window.H2S_CLOUD_HUMMING_MUSIC_JOB_CREATE_RESULT }));
        return;
      }

      case 'H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS_RESPONSE': {
        if (typeof data.requestId !== 'string' || !data.requestId) return;
        window.H2S_CLOUD_MODE = true;
        window.H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS_RESULT = {
          loading: false,
          requestId: data.requestId,
          ok: data.ok === true,
          status: typeof data.status === 'number' ? data.status : null,
          job: data.job && typeof data.job === 'object' ? data.job : null,
          error: typeof data.error === 'string' ? data.error : null,
        };
        window.dispatchEvent(new CustomEvent('h2s-cloud-humming-music-job-status', { detail: window.H2S_CLOUD_HUMMING_MUSIC_JOB_STATUS_RESULT }));
        return;
      }

      case 'H2S_CLOUD_LOAD_PROJECT': {
        var appLoad = getApp();
        if (!appLoad || typeof appLoad.setProjectFromV2 !== 'function') {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: 'studio_app_or_setProjectFromV2_unavailable',
          });
          return;
        }
        var pd = data.projectDoc;
        if (!pd || typeof pd !== 'object' || Array.isArray(pd)) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: 'projectDoc_must_be_object',
          });
          return;
        }
        if (!isProjectDocLikely(pd)) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: 'projectDoc_must_be_version_2_or_beat_timebase',
          });
          return;
        }
        try {
          if (window.H2SStartupPerf && typeof window.H2SStartupPerf.mark === 'function') {
            window.H2SStartupPerf.mark('studio_project_load_start');
          }
          var loadEpoch = appLoad._nativeAudioImportEpoch || 0;
          if (typeof window.H2S_RESTORE_CLOUD_AUDIO_REFERENCES === 'function') pd = await window.H2S_RESTORE_CLOUD_AUDIO_REFERENCES(pd);
          if ((appLoad._nativeAudioImportEpoch || 0) !== loadEpoch) throw Error('session_changed');
          var res = appLoad.setProjectFromV2(pd);
          if (window.H2SStartupPerf && typeof window.H2SStartupPerf.mark === 'function') {
            window.H2SStartupPerf.mark('studio_project_load_done');
          }
          if (res && res.ok === false) {
            postBack(event.origin, {
              type: 'H2S_CLOUD_LOAD_RESULT',
              requestId: data.requestId,
              ok: false,
              error: (res.error && String(res.error)) || 'setProjectFromV2_rejected',
            });
            return;
          }
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: true,
          });
        } catch (errL) {
          postBack(event.origin, {
            type: 'H2S_CLOUD_LOAD_RESULT',
            requestId: data.requestId,
            ok: false,
            error: (errL && (errL.message || String(errL))) || 'setProjectFromV2_exception',
          });
        }
        return;
      }

      default:
        return;
    }
  });

  if (isCloudModeRequested()) {
    window.H2S_CLOUD_MODE = true;
    window.H2S_CLOUD_AI_STATUS = null;
    var onCloudBoot = function () {
      renderCloudAiStatus();
      rerenderAiSettingsDrawerIfOpen();
      var app = getApp();
      if (app && app.state && app.state.aiSettingsOpen && typeof window.H2S_REQUEST_CLOUD_AI_STATUS === 'function') {
        window.H2S_REQUEST_CLOUD_AI_STATUS();
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onCloudBoot, { once: true });
    } else {
      onCloudBoot();
    }
    if (window.H2SStartupPerf && typeof window.H2SStartupPerf.onFirstInteractive === 'function') {
      window.H2SStartupPerf.onFirstInteractive(function () {
        if (typeof window.H2S_SCHEDULE_CLOUD_AI_STATUS === 'function') {
          window.H2S_SCHEDULE_CLOUD_AI_STATUS();
        }
      });
    }
  }

  if (window.parent && window.parent !== window) {
    if (window.H2SStartupPerf && typeof window.H2SStartupPerf.mark === 'function') {
      window.H2SStartupPerf.mark('studio_bridge_ready');
    }
    window.parent.postMessage({ type: 'H2S_STUDIO_BRIDGE_READY', version: 1 }, '*');
  }
})();
