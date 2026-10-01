/* Hum2Song Studio - audio_waveform_editor.js
 * Waveform segment editor modal for original audio clips (v0).
 */
(function () {
  'use strict';

  var MIN_SELECT_SEC = 2;
  var MAX_SELECT_SEC = 3600;
  var DEFAULT_PEAKS = 900;

  function uvr5EnsembleUiEnabled() {
    try {
      return new URLSearchParams(window.location.search || '').get('uvr5Ensemble') === '1';
    } catch (_err) {
      return false;
    }
  }

  function _num(x, fb) {
    var n = Number(x);
    return Number.isFinite(n) ? n : fb;
  }

  function clampSelection(audioDur, startSec, endSec) {
    var total = Math.max(0, _num(audioDur, 0));
    var start = Math.max(0, _num(startSec, 0));
    var end = _num(endSec, start + MIN_SELECT_SEC);
    if (total > 0) {
      start = Math.min(start, Math.max(0, total - MIN_SELECT_SEC));
      end = Math.min(Math.max(end, start + MIN_SELECT_SEC), total);
    } else {
      end = Math.max(end, start + MIN_SELECT_SEC);
    }
    var dur = end - start;
    if (dur < MIN_SELECT_SEC) {
      end = start + MIN_SELECT_SEC;
      dur = MIN_SELECT_SEC;
    }
    var maxSec = total > 0 ? total : MAX_SELECT_SEC;
    if (dur > maxSec) {
      end = start + maxSec;
      dur = maxSec;
      if (total > 0 && end > total) {
        end = total;
        start = Math.max(0, end - maxSec);
        dur = end - start;
      }
    }
    return { startSec: start, durationSec: dur, endSec: start + dur };
  }

  function computePeaksFromChannel(channel, numPeaks) {
    var data = channel;
    var len = data.length;
    var peaks = new Array(numPeaks);
    if (!len || numPeaks < 1) {
      for (var i = 0; i < numPeaks; i++) peaks[i] = 0;
      return peaks;
    }
    var block = len / numPeaks;
    for (var p = 0; p < numPeaks; p++) {
      var from = Math.floor(p * block);
      var to = Math.min(len, Math.floor((p + 1) * block));
      var max = 0;
      for (var s = from; s < to; s++) {
        var v = Math.abs(data[s]);
        if (v > max) max = v;
      }
      peaks[p] = max;
    }
    return peaks;
  }

  function computePeaksFromBuffer(audioBuffer, numPeaks) {
    numPeaks = numPeaks || DEFAULT_PEAKS;
    if (!audioBuffer || !audioBuffer.numberOfChannels) return [];
    var ch0 = audioBuffer.getChannelData(0);
    var peaks = computePeaksFromChannel(ch0, numPeaks);
    if (audioBuffer.numberOfChannels > 1) {
      var ch1 = audioBuffer.getChannelData(1);
      var p1 = computePeaksFromChannel(ch1, numPeaks);
      for (var i = 0; i < numPeaks; i++) peaks[i] = Math.max(peaks[i], p1[i]);
    }
    var maxPeak = 0;
    for (var j = 0; j < peaks.length; j++) if (peaks[j] > maxPeak) maxPeak = peaks[j];
    if (maxPeak > 0) {
      for (var k = 0; k < peaks.length; k++) peaks[k] = peaks[k] / maxPeak;
    }
    return peaks;
  }

  function encodeWavFromAudioBuffer(buffer, startSec, endSec) {
    if (!buffer) return null;
    var sampleRate = buffer.sampleRate;
    var startSample = Math.max(0, Math.floor(_num(startSec, 0) * sampleRate));
    var endSample = Math.min(buffer.length, Math.ceil(_num(endSec, buffer.duration) * sampleRate));
    if (endSample <= startSample) endSample = Math.min(buffer.length, startSample + Math.floor(MIN_SELECT_SEC * sampleRate));
    var numChannels = buffer.numberOfChannels;
    var frameCount = endSample - startSample;
    var bytesPerSample = 2;
    var blockAlign = numChannels * bytesPerSample;
    var byteRate = sampleRate * blockAlign;
    var dataSize = frameCount * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    function wstr(off, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    }
    wstr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    wstr(8, 'WAVE');
    wstr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    wstr(36, 'data');
    view.setUint32(40, dataSize, true);
    var offset = 44;
    for (var f = 0; f < frameCount; f++) {
      for (var c = 0; c < numChannels; c++) {
        var sample = buffer.getChannelData(c)[startSample + f] || 0;
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function segmentFromHandles(audioDur, selStart, selEnd) {
    return clampSelection(audioDur, selStart, selEnd);
  }

  function drawWaveformCanvas(ctx, width, height, peaks, selStartRatio, selEndRatio) {
    if (!ctx || width < 2 || height < 2) return;
    ctx.clearRect(0, 0, width, height);
    var mid = height / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, width, height);
    if (!peaks || !peaks.length) return;
    var n = peaks.length;
    var barW = Math.max(1, width / n);
    ctx.fillStyle = 'rgba(120,180,255,0.55)';
    for (var i = 0; i < n; i++) {
      var h = Math.max(1, peaks[i] * (height * 0.42));
      var x = i * barW;
      ctx.fillRect(x, mid - h, Math.max(1, barW - 0.25), h * 2);
    }
    var x0 = Math.max(0, Math.min(1, selStartRatio)) * width;
    var x1 = Math.max(0, Math.min(1, selEndRatio)) * width;
    ctx.fillStyle = 'rgba(80,160,255,0.22)';
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
    ctx.strokeStyle = 'rgba(120,200,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, height);
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, height);
    ctx.stroke();
  }

  function createController(hooks) {
    hooks = hooks || {};
    var overlay = null;
    var panel = null;
    var canvas = null;
    var ctx2d = null;
    var fallbackEl = null;
    var statusEl = null;
    var openCtx = null;
    var audioBuffer = null;
    var peaks = [];
    var selStart = 0;
    var selEnd = 30;
    var audioDur = 0;
    var previewAudio = null;
    var previewUrl = null;
    var previewActive = false;
    var dragMode = null;
    var objectUrl = null;
    var convertPhase = 'idle';
    var convertErrorBucket = null;
    var convertTaskId = null;
    var separationBusy = false;
    var silenceSplitBusy = false;

    function t(key, fb) {
      return (typeof hooks.t === 'function') ? hooks.t(key, fb) : (fb != null ? fb : key);
    }
    function fmtSec(x) {
      return (typeof hooks.fmtSec === 'function') ? hooks.fmtSec(x) : String(x);
    }
    function escapeHtml(s) {
      return (typeof hooks.escapeHtml === 'function') ? hooks.escapeHtml(s) : String(s);
    }

    function stopPreview() {
      previewActive = false;
      if (previewAudio) {
        try {
          previewAudio.pause();
          previewAudio.currentTime = 0;
        } catch (e) {}
      }
      updatePreviewButton();
    }

    function updatePreviewButton() {
      if (!panel) return;
      var btn = panel.querySelector('[data-act="wavePreview"]');
      if (!btn) return;
      btn.textContent = previewActive
        ? t('audio.waveform.previewStop', 'Stop preview')
        : t('audio.waveform.preview', 'Preview selection');
    }

    function syncLabels() {
      if (!panel) return;
      var seg = clampSelection(audioDur, selStart, selEnd);
      selStart = seg.startSec;
      selEnd = seg.endSec;
      var set = function (role, text) {
        var el = panel.querySelector('[data-role="' + role + '"]');
        if (el) el.textContent = text;
      };
      set('wfSelStart', fmtSec(seg.startSec));
      set('wfSelEnd', fmtSec(seg.endSec));
      set('wfSelDur', fmtSec(seg.durationSec));
      if (typeof hooks.setSegment === 'function') {
        hooks.setSegment(openCtx.clipId, { startSec: seg.startSec, durationSec: seg.durationSec });
      }
      redrawCanvas();
    }

    function redrawCanvas() {
      if (!canvas || !ctx2d) return;
      var w = canvas.clientWidth || 640;
      var h = canvas.clientHeight || 96;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      var ratio0 = audioDur > 0 ? selStart / audioDur : 0;
      var ratio1 = audioDur > 0 ? selEnd / audioDur : 1;
      drawWaveformCanvas(ctx2d, w, h, peaks, ratio0, ratio1);
    }

    function applySegmentFromHooks() {
      if (!openCtx || typeof hooks.getSegment !== 'function') return;
      var seg = hooks.getSegment(openCtx.clipId, openCtx.instanceId);
      if (seg) {
        selStart = _num(seg.startSec, 0);
        selEnd = _num(seg.endSec, selStart + 30);
      }
      syncLabels();
    }

    function hitHandle(clientX) {
      if (!canvas) return null;
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var w = rect.width || 1;
      var ratio = x / w;
      var r0 = audioDur > 0 ? selStart / audioDur : 0;
      var r1 = audioDur > 0 ? selEnd / audioDur : 1;
      var tol = 10 / w;
      if (Math.abs(ratio - r0) < tol) return 'start';
      if (Math.abs(ratio - r1) < tol) return 'end';
      if (ratio > r0 && ratio < r1) return 'move';
      return null;
    }

    function onCanvasPointerDown(ev) {
      dragMode = hitHandle(ev.clientX);
      if (!dragMode) return;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }

    function onCanvasPointerMove(ev) {
      if (!dragMode || !canvas) return;
      var rect = canvas.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / (rect.width || 1)));
      var tsec = audioDur > 0 ? ratio * audioDur : ratio * 120;
      if (dragMode === 'start') {
        selStart = Math.min(tsec, selEnd - MIN_SELECT_SEC);
      } else if (dragMode === 'end') {
        selEnd = Math.max(tsec, selStart + MIN_SELECT_SEC);
      } else if (dragMode === 'move') {
        var dur = selEnd - selStart;
        selStart = Math.max(0, tsec - dur / 2);
        selEnd = selStart + dur;
      }
      var seg = clampSelection(audioDur, selStart, selEnd);
      selStart = seg.startSec;
      selEnd = seg.endSec;
      syncLabels();
    }

    function onCanvasPointerUp() {
      dragMode = null;
    }

    async function startPreview() {
      if (previewActive) {
        stopPreview();
        return;
      }
      if (!objectUrl) return;
      stopPreview();
      previewAudio = new Audio(objectUrl);
      previewAudio.currentTime = selStart;
      previewActive = true;
      updatePreviewButton();
      previewAudio.addEventListener('timeupdate', function () {
        if (!previewActive || !previewAudio) return;
        if (previewAudio.currentTime >= selEnd - 0.02) {
          stopPreview();
        }
      });
      previewAudio.addEventListener('ended', function () { stopPreview(); });
      try {
        await previewAudio.play();
      } catch (e) {
        stopPreview();
      }
    }

    function ensureDom() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.className = 'h2s-audio-waveform-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="h2s-audio-waveform-backdrop" data-act="waveClose"></div>' +
        '<div class="h2s-audio-waveform-panel">' +
          '<div class="h2s-audio-waveform-header">' +
            '<h3 data-role="wfTitle"></h3>' +
            '<button type="button" class="btn mini ghost" data-act="waveClose" aria-label="Close">×</button>' +
          '</div>' +
          '<div class="h2s-audio-waveform-meta">' +
            '<div class="kv"><b data-i18n-role="wfClipLabel"></b><span data-role="wfClipName"></span></div>' +
            '<div class="kv"><b data-i18n-role="wfTotalLabel"></b><span data-role="wfTotalDur"></span></div>' +
            '<div class="kv"><b data-i18n-role="wfStartLabel"></b><span data-role="wfSelStart"></span></div>' +
            '<div class="kv"><b data-i18n-role="wfEndLabel"></b><span data-role="wfSelEnd"></span></div>' +
            '<div class="kv"><b data-i18n-role="wfDurLabel"></b><span data-role="wfSelDur"></span></div>' +
          '</div>' +
          '<canvas class="h2s-audio-waveform-canvas" width="640" height="96"></canvas>' +
          '<div class="h2s-audio-waveform-fallback" data-role="wfFallback" hidden></div>' +
          '<div class="row h2s-audio-waveform-presets" style="flex-wrap:wrap;gap:4px;margin-top:8px;">' +
            '<button type="button" class="btn mini" data-act="waveAtPlayhead"></button>' +
            '<button type="button" class="btn mini" data-act="waveLen15" data-len="15"></button>' +
            '<button type="button" class="btn mini" data-act="waveLen30" data-len="30"></button>' +
            '<button type="button" class="btn mini" data-act="waveLen60" data-len="60"></button>' +
          '</div>' +
          '<div class="row h2s-audio-waveform-actions" style="flex-wrap:wrap;gap:6px;margin-top:10px;">' +
            '<button type="button" class="btn mini" data-act="wavePreview"></button>' +
            '<label class="h2s-audio-waveform-separation-toggle">' +
              '<input type="checkbox" data-role="wfSeparateBeforeConvert">' +
              '<span data-i18n-role="wfSeparateBeforeConvertLabel"></span>' +
            '</label>' +
            '<button type="button" class="btn mini primary" data-act="waveConvert"></button>' +
            '<button type="button" class="btn mini" data-act="waveRetry" hidden></button>' +
            '<button type="button" class="btn mini" data-act="waveExtract"></button>' +
            '<button type="button" class="btn mini" data-act="waveSplitSilence"></button>' +
            '<button type="button" class="btn mini ghost" data-act="waveCloseBtn"></button>' +
            '<button type="button" class="btn mini h2s-audio-waveform-download-icon" data-act="waveDownloadOriginal" aria-label="Download audio">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>' +
              '</svg>' +
            '</button>' +
          '</div>' +
          '<div class="h2s-audio-waveform-status" data-role="wfStatus" role="status" aria-live="polite" aria-atomic="true"></div>' +
          '<div class="row h2s-audio-waveform-separation-actions">' +
            '<label class="h2s-audio-waveform-separation-toggle">' +
              '<input type="checkbox" data-role="wfSeparationSettingsToggle">' +
              '<span data-i18n-role="wfSeparationSettingsLabel"></span>' +
            '</label>' +
            '<button type="button" class="btn mini primary" data-act="waveSeparate"></button>' +
          '</div>' +
          '<div class="h2s-audio-waveform-separation-controls" data-role="wfSeparationSettings" hidden>' +
            '<div class="h2s-audio-waveform-separation-field">' +
              '<span data-i18n-role="wfSeparatorOptionLabel"></span>' +
              '<div class="h2s-audio-waveform-choice-group" data-role="wfSeparatorOptionChoices" role="radiogroup">' +
                '<button type="button" class="h2s-audio-waveform-choice is-selected" data-separator-option-value="demucs" role="radio" aria-checked="true"></button>' +
                '<button type="button" class="h2s-audio-waveform-choice" data-separator-option-value="uvr5_ensemble_vocal_full" role="radio" aria-checked="false" hidden disabled></button>' +
                '<button type="button" class="h2s-audio-waveform-choice h2s-audio-waveform-choice-advanced" data-separator-option-value="advanced_stems" role="radio" aria-checked="false"></button>' +
              '</div>' +
              '<select data-role="wfSeparatorOption" hidden aria-hidden="true" tabindex="-1">' +
                '<option value="demucs" selected></option>' +
                '<option value="uvr5_ensemble_vocal_full" data-uvr5-option hidden disabled></option>' +
                '<option value="advanced_stems" data-advanced-option></option>' +
              '</select>' +
            '</div>' +
            '<label>' +
              '<span data-i18n-role="wfSeparationPresetLabel"></span>' +
              '<select data-role="wfSeparationPreset">' +
                '<option value="vocals_instrumental"></option>' +
                '<option value="four_stem" selected></option>' +
                '<option value="instruments_only"></option>' +
                '<option value="vocals_bass_drums"></option>' +
              '</select>' +
            '</label>' +
            '<div class="h2s-audio-waveform-separation-field">' +
              '<span data-i18n-role="wfSeparationModeLabel"></span>' +
              '<div class="h2s-audio-waveform-choice-group" data-role="wfSeparationModeChoices" role="radiogroup">' +
                '<button type="button" class="h2s-audio-waveform-choice is-selected" data-separation-mode-value="separate_only" role="radio" aria-checked="true"></button>' +
                '<button type="button" class="h2s-audio-waveform-choice" data-separation-mode-value="separate_and_transcribe" role="radio" aria-checked="false"></button>' +
              '</div>' +
              '<select data-role="wfSeparationMode" hidden aria-hidden="true" tabindex="-1">' +
                '<option value="separate_only" selected></option>' +
                '<option value="separate_and_transcribe"></option>' +
              '</select>' +
            '</div>' +
            '<div class="muted" data-role="wfSeparatorOptionHint"></div>' +
            '<div class="muted" data-role="wfSeparationCost"></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      panel = overlay.querySelector('.h2s-audio-waveform-panel');
      canvas = overlay.querySelector('canvas');
      ctx2d = canvas.getContext('2d');
      fallbackEl = overlay.querySelector('[data-role="wfFallback"]');
      statusEl = overlay.querySelector('[data-role="wfStatus"]');
      canvas.addEventListener('pointerdown', onCanvasPointerDown);
      canvas.addEventListener('pointermove', onCanvasPointerMove);
      canvas.addEventListener('pointerup', onCanvasPointerUp);
      canvas.addEventListener('pointercancel', onCanvasPointerUp);
      overlay.addEventListener('click', function (ev) {
        var act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (!act) return;
        if (act === 'waveClose' || act === 'waveCloseBtn') close();
        if (act === 'waveAtPlayhead' && typeof hooks.setSegmentAtPlayhead === 'function') {
          hooks.setSegmentAtPlayhead(openCtx.clipId, openCtx.instanceId);
          applySegmentFromHooks();
        }
        if (act === 'waveLen15' || act === 'waveLen30' || act === 'waveLen60') {
          var len = Number(ev.target.getAttribute('data-len') || 30);
          if (typeof hooks.setSegmentLength === 'function') hooks.setSegmentLength(openCtx.clipId, len);
          applySegmentFromHooks();
        }
        if (act === 'wavePreview') startPreview();
        if (act === 'waveDownloadOriginal' && typeof hooks.downloadOriginal === 'function') {
          var downloadBtn = panel.querySelector('[data-act="waveDownloadOriginal"]');
          if (downloadBtn) downloadBtn.disabled = true;
          Promise.resolve().then(function () {
            return hooks.downloadOriginal(openCtx.clipId);
          }).then(function () {
            if (downloadBtn) downloadBtn.disabled = false;
          }, function () {
            if (downloadBtn) downloadBtn.disabled = false;
          });
        }
        if (act === 'waveSeparate') startSeparation();
        if (act === 'waveSplitSilence') startSilenceSplit();
        if (act === 'waveConvert' && typeof hooks.convertToEditable === 'function') {
          var separateBeforeConvert = panel.querySelector('[data-role="wfSeparateBeforeConvert"]');
          var separationPreset = panel.querySelector('[data-role="wfSeparationPreset"]');
          hooks.convertToEditable(openCtx.clipId, openCtx.instanceId, {
            separateFirst: !!(separateBeforeConvert && separateBeforeConvert.checked),
            separationPreset: separationPreset ? separationPreset.value : 'four_stem',
          });
        }
        if (act === 'waveRetry' && typeof hooks.retryConvert === 'function') {
          var retrySeparateBeforeConvert = panel.querySelector('[data-role="wfSeparateBeforeConvert"]');
          var retrySeparationPreset = panel.querySelector('[data-role="wfSeparationPreset"]');
          hooks.retryConvert(openCtx.clipId, openCtx.instanceId, {
            separateFirst: !!(retrySeparateBeforeConvert && retrySeparateBeforeConvert.checked),
            separationPreset: retrySeparationPreset ? retrySeparationPreset.value : 'four_stem',
          });
        }
        if (act === 'waveExtract' && typeof hooks.extractSegment === 'function') {
          var seg = clampSelection(audioDur, selStart, selEnd);
          hooks.extractSegment(openCtx.clipId, openCtx.instanceId, seg);
        }
      });
      window.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && overlay && !overlay.hidden) close();
      });
      window.addEventListener('resize', function () {
        if (overlay && !overlay.hidden) redrawCanvas();
      });
      var separationMode = panel.querySelector('[data-role="wfSeparationMode"]');
      if (separationMode) separationMode.addEventListener('change', function () {
        updateSeparationCost();
        syncSeparatorAvailability();
      });
      var separatorOption = panel.querySelector('[data-role="wfSeparatorOption"]');
      if (separatorOption) separatorOption.addEventListener('change', syncSeparatorAvailability);
      Array.prototype.forEach.call(panel.querySelectorAll('[data-separator-option-value]'), function (button) {
        button.addEventListener('click', function () {
          if (!separatorOption || button.disabled) return;
          separatorOption.value = button.getAttribute('data-separator-option-value') || 'demucs';
          syncSeparatorAvailability();
        });
      });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-separation-mode-value]'), function (button) {
        button.addEventListener('click', function () {
          if (!separationMode || button.disabled) return;
          separationMode.value = button.getAttribute('data-separation-mode-value') || 'separate_only';
          updateSeparationCost();
          syncSeparatorAvailability();
        });
      });
      var separateBeforeConvertInput = panel.querySelector('[data-role="wfSeparateBeforeConvert"]');
      if (separateBeforeConvertInput) separateBeforeConvertInput.addEventListener('change', syncSeparatorAvailability);
      var separationSettingsToggle = panel.querySelector('[data-role="wfSeparationSettingsToggle"]');
      if (separationSettingsToggle) separationSettingsToggle.addEventListener('change', syncSeparationSettingsVisibility);
    }

    function syncSeparationSettingsVisibility() {
      if (!panel) return;
      var toggle = panel.querySelector('[data-role="wfSeparationSettingsToggle"]');
      var settings = panel.querySelector('[data-role="wfSeparationSettings"]');
      if (settings) settings.hidden = !(toggle && toggle.checked);
    }

    function updateSeparationCost() {
      if (!panel) return;
      var mode = panel.querySelector('[data-role="wfSeparationMode"]');
      var separator = panel.querySelector('[data-role="wfSeparatorOption"]');
      var cost = panel.querySelector('[data-role="wfSeparationCost"]');
      if (!cost) return;
      cost.textContent = separator && separator.value === 'advanced_stems'
        ? t('audio.waveform.advancedCost', 'Each advanced stem-separation task uses 30 regular transcription credits. Credits are charged only when the task starts.')
        : mode && mode.value === 'separate_and_transcribe'
        ? t('audio.waveform.separationCostTwo', 'Creating audio stems and editable notes uses 2 AI transcription credits.')
        : t('audio.waveform.separationCostOne', 'Creating audio stems uses 1 AI transcription credit.');
    }

    async function startSilenceSplit() {
      if (silenceSplitBusy || separationBusy || _isConvertBusy() || !openCtx || typeof hooks.splitAudioAtSilence !== 'function') return;
      var target = openCtx;
      silenceSplitBusy = true;
      stopPreview();
      updateConvertButtons();
      if (statusEl) {
        statusEl.classList.remove('is-error');
        statusEl.setAttribute('role', 'status');
        statusEl.textContent = t('audio.waveform.splitSilenceRunning', 'Splitting at silent gaps…');
      }
      try {
        var result = await hooks.splitAudioAtSilence(target.clipId, target.instanceId);
        if (openCtx !== target) return;
        if (result && result.ok) {
          if (result.changed) close();
          else if (statusEl) statusEl.textContent = t('audio.waveform.splitSilenceNoChange', 'No long silent gaps found. The audio was kept unchanged.');
        } else {
          var key = result && result.reason === 'source_instance_required' ? 'audio.waveform.splitSilenceNeedInstance'
            : result && result.reason === 'source_changed' ? 'audio.waveform.splitSilenceSourceChanged'
            : 'audio.waveform.splitSilenceFailed';
          if (statusEl) {
            statusEl.classList.add('is-error');
            statusEl.setAttribute('role', 'alert');
            statusEl.textContent = t(key, 'Could not split this audio. The original clip was kept.');
          }
        }
      } catch (_splitError) {
        if (openCtx === target && statusEl) {
          statusEl.classList.add('is-error');
          statusEl.setAttribute('role', 'alert');
          statusEl.textContent = t('audio.waveform.splitSilenceFailed', 'Could not split this audio. The original clip was kept.');
        }
      } finally {
        silenceSplitBusy = false;
        updateConvertButtons();
      }
    }

    async function startAdvancedStemSeparation() {
      if (separationBusy || silenceSplitBusy || _isConvertBusy() || !openCtx || typeof hooks.runAdvancedStemSeparation !== 'function') return;
      separationBusy = true;
      updateConvertButtons();
      try {
        if (typeof hooks.checkAdvancedStemAvailability === 'function') {
          var availability = await hooks.checkAdvancedStemAvailability();
          if (!availability || availability.available !== true) {
            var remaining = availability && availability.remaining != null ? availability.remaining : 0;
            var insufficientMessage = t(
              'audio.waveform.advancedInsufficient',
              'Insufficient balance. Advanced stem separation is a paid feature and requires 30 regular transcription credits per run. Current remaining: {n}. Please purchase credits before using it.'
            ).replace('{n}', String(remaining));
            if (statusEl) statusEl.textContent = insufficientMessage;
            if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(insufficientMessage);
            return;
          }
        }
        var message = t('audio.waveform.advancedConfirm', 'Advanced stem separation uses a high-cost model to split more independent instrument stems. Each new task uses 30 regular transcription credits. Credits are used only when the task starts. Continue?');
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(message)) return;
        if (statusEl) {
          statusEl.classList.remove('is-error');
          statusEl.setAttribute('role', 'status');
          statusEl.setAttribute('aria-live', 'polite');
        }
        if (statusEl) statusEl.textContent = t('audio.waveform.advancedRunning', 'Advanced stem separation is running…');
        var result = await hooks.runAdvancedStemSeparation(openCtx.clipId, openCtx.instanceId, {
          startSec: selStart,
          durationSec: Math.max(0, selEnd - selStart),
          onStatus: function (text) { if (statusEl && text) statusEl.textContent = String(text); },
        });
        if (!result || !result.ok) throw new Error((result && result.reason) || 'worker_failed');
        if (statusEl) {
          statusEl.textContent = result.failures && result.failures.length
            ? t('audio.waveform.advancedPartial', 'Suno separation completed, but {n} stems could not be imported.').replace('{n}', String(result.failures.length))
            : t('audio.waveform.advancedDone', 'Advanced stem separation is complete. Audio stems were preserved.');
          if (result.failures && result.failures.length) {
            statusEl.classList.add('is-error');
            statusEl.setAttribute('role', 'alert');
            statusEl.setAttribute('aria-live', 'assertive');
          }
          if (typeof statusEl.scrollIntoView === 'function') statusEl.scrollIntoView({ block: 'nearest' });
        }
      } catch (err) {
        var errorMessage = err && err.message ? String(err.message) : 'worker_failed';
        if (statusEl && errorMessage.indexOf('advanced_source_too_large') >= 0) {
          statusEl.textContent = t('audio.waveform.advancedUploadTooLarge', 'Suno separation supports source audio up to 20 MB. Please use a smaller audio file.');
        } else if (statusEl && errorMessage.indexOf('advanced_separation_provider_source_required') >= 0) {
          statusEl.textContent = t('audio.waveform.advancedProviderSourceRequired', 'Advanced stem separation currently supports complete music generated through Hum2Song Cloud only.');
        } else if (statusEl && errorMessage.indexOf('advanced_separation_range_unavailable') >= 0) {
          statusEl.textContent = t('audio.waveform.advancedFullSourceRequired', 'Advanced stem separation currently supports the complete source audio only.');
        } else if (statusEl) {
          statusEl.textContent = t('audio.waveform.advancedFailed', 'Advanced stem separation failed. Please try again.') + ' (' + errorMessage + ')';
        }
        if (statusEl) {
          statusEl.classList.add('is-error');
          statusEl.setAttribute('role', 'alert');
          statusEl.setAttribute('aria-live', 'assertive');
          if (typeof statusEl.scrollIntoView === 'function') statusEl.scrollIntoView({ block: 'nearest' });
        }
      } finally {
        separationBusy = false;
        updateConvertButtons();
      }
    }

    function syncTwoChoiceButtons(selectRole, groupRole, valueAttribute) {
      if (!panel) return;
      var select = panel.querySelector('[data-role="' + selectRole + '"]');
      var group = panel.querySelector('[data-role="' + groupRole + '"]');
      if (!select || !group) return;
      Array.prototype.forEach.call(group.querySelectorAll('[' + valueAttribute + ']'), function (button) {
        var value = button.getAttribute(valueAttribute) || '';
        var option = null;
        Array.prototype.forEach.call(select.options, function (candidate) {
          if (candidate.value === value) option = candidate;
        });
        var selected = select.value === value;
        button.textContent = option ? option.textContent : value;
        button.hidden = !!(option && option.hidden);
        button.disabled = !!select.disabled || !!(option && option.disabled);
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
      });
    }

    function syncSeparationChoiceButtons() {
      syncTwoChoiceButtons('wfSeparatorOption', 'wfSeparatorOptionChoices', 'data-separator-option-value');
      syncTwoChoiceButtons('wfSeparationMode', 'wfSeparationModeChoices', 'data-separation-mode-value');
    }

    function syncSeparatorAvailability() {
      if (!panel) return;
      var separator = panel.querySelector('[data-role="wfSeparatorOption"]');
      var uvrOption = separator && separator.querySelector('[data-uvr5-option]');
      var advancedOption = separator && separator.querySelector('[data-advanced-option]');
      var mode = panel.querySelector('[data-role="wfSeparationMode"]');
      var transcribeOption = mode && mode.querySelector('option[value="separate_and_transcribe"]');
      var preset = panel.querySelector('[data-role="wfSeparationPreset"]');
      var separateBeforeConvert = panel.querySelector('[data-role="wfSeparateBeforeConvert"]');
      var midiEnabled = !!((mode && mode.value === 'separate_and_transcribe') || (separateBeforeConvert && separateBeforeConvert.checked));
      if (uvrOption) {
        uvrOption.hidden = !uvr5EnsembleUiEnabled();
        uvrOption.disabled = !uvr5EnsembleUiEnabled() || midiEnabled;
      }
      if (advancedOption) advancedOption.disabled = midiEnabled;
      if (separator && (separator.value === 'uvr5_ensemble_vocal_full' || separator.value === 'advanced_stems') && midiEnabled) separator.value = 'demucs';
      var uvrSelected = !!(separator && separator.value === 'uvr5_ensemble_vocal_full');
      var advancedSelected = !!(separator && separator.value === 'advanced_stems');
      if (uvrSelected) {
        if (preset) preset.value = 'vocals_instrumental';
        if (mode) mode.value = 'separate_only';
      }
      if (advancedSelected && mode) mode.value = 'separate_only';
      if (transcribeOption) transcribeOption.disabled = uvrSelected || advancedSelected;
      if (preset) preset.disabled = uvrSelected || advancedSelected || separationBusy || silenceSplitBusy || _isConvertBusy();
      var hint = panel.querySelector('[data-role="wfSeparatorOptionHint"]');
      if (hint) hint.textContent = advancedSelected
        ? t('audio.waveform.advancedHint', 'High-cost fine separation creates more independent instrument stems and audio tracks only.')
        : uvrSelected
          ? t('audio.waveform.uvr5Hint', 'Vocal enhancement is still experimental and slower; it outputs only vocal and accompaniment stems.')
          : midiEnabled
            ? t('audio.waveform.uvr5DisabledForMidi', 'Creating editable notes requires Stable separation.')
            : '';
      var separateBtn = panel.querySelector('[data-act="waveSeparate"]');
      if (separateBtn) separateBtn.textContent = advancedSelected
        ? t('audio.waveform.advancedRun', 'Advanced stems · 30 credits')
        : t('audio.waveform.separate', 'AI stem separation');
      updateSeparationCost();
      syncSeparationChoiceButtons();
    }

    async function startSeparation() {
      if (separationBusy || silenceSplitBusy || _isConvertBusy() || !openCtx) return;
      var preset = panel.querySelector('[data-role="wfSeparationPreset"]');
      var mode = panel.querySelector('[data-role="wfSeparationMode"]');
      var separator = panel.querySelector('[data-role="wfSeparatorOption"]');
      var requestedSeparator = separator ? separator.value : 'demucs';
      if (requestedSeparator === 'advanced_stems') {
        await startAdvancedStemSeparation();
        return;
      }
      if (typeof hooks.runSeparation !== 'function') return;
      separationBusy = true;
      updateConvertButtons();
      if (statusEl) statusEl.textContent = t('audio.waveform.separationRunning', 'AI stem separation is running. You can keep this window open to see progress.');
      try {
        var result = await hooks.runSeparation(openCtx.clipId, openCtx.instanceId, {
          separationPreset: preset ? preset.value : 'four_stem',
          mode: mode ? mode.value : 'separate_only',
          separatorOption: requestedSeparator,
          onStatus: function (text) {
            if (statusEl && text) statusEl.textContent = String(text);
          },
        });
        if (!result || !result.ok) throw new Error((result && result.reason) || 'worker_failed');
        if (statusEl && (!result.failures || !result.failures.length)) {
          statusEl.textContent = t('audio.waveform.separationDone', 'AI stem separation is complete. The original audio was preserved.');
        }
      } catch (err) {
        if (statusEl) {
          var message = err && err.message ? String(err.message) : 'worker_failed';
          statusEl.textContent = message === 'payload_too_large'
            ? t('audio.waveform.separationTooLarge', 'This audio is too large to upload for stem separation. Shorten the selected segment and try again.')
            : requestedSeparator === 'uvr5_ensemble_vocal_full'
              ? t('audio.waveform.uvr5FailedRefunded', 'Enhanced vocal separation failed. This attempt was not charged.')
              : t('audio.waveform.separationFailed', 'AI stem separation failed. Please try again.') + ' (' + message + ')';
        }
      } finally {
        separationBusy = false;
        updateConvertButtons();
      }
    }

    function setFallbackVisible(show, msg) {
      if (!fallbackEl || !canvas) return;
      fallbackEl.hidden = !show;
      canvas.style.display = show ? 'none' : 'block';
      if (show) fallbackEl.textContent = msg || '';
    }

    function applyI18nLabels() {
      if (!panel) return;
      var titleEl = panel.querySelector('[data-role="wfTitle"]');
      if (titleEl) titleEl.textContent = t('audio.waveform.title', 'Audio segment editor');
      var map = [
        ['wfClipLabel', 'audio.waveform.clip', 'Clip'],
        ['wfTotalLabel', 'audio.waveform.totalDuration', 'Total duration'],
        ['wfStartLabel', 'convert.segmentStart', 'Segment start'],
        ['wfEndLabel', 'convert.segmentEnd', 'Segment end'],
        ['wfDurLabel', 'audio.waveform.selectedDuration', 'Selected duration'],
      ];
      map.forEach(function (row) {
        var el = panel.querySelector('[data-i18n-role="' + row[0] + '"]');
        if (el) el.textContent = t(row[1], row[2]);
      });
      var settingsLabel = panel.querySelector('[data-i18n-role="wfSeparationSettingsLabel"]');
      if (settingsLabel) settingsLabel.textContent = t('audio.waveform.separationSettings', 'Stem separation settings');
      var separateBeforeConvertLabel = panel.querySelector('[data-i18n-role="wfSeparateBeforeConvertLabel"]');
      if (separateBeforeConvertLabel) separateBeforeConvertLabel.textContent = t('audio.waveform.separateBeforeConvert', 'AI stem separation before MIDI conversion (2 credits)');
      var presetLabel = panel.querySelector('[data-i18n-role="wfSeparationPresetLabel"]');
      if (presetLabel) presetLabel.textContent = t('transcription.separationPreset', 'Stem separation target');
      var modeLabel = panel.querySelector('[data-i18n-role="wfSeparationModeLabel"]');
      if (modeLabel) modeLabel.textContent = t('audio.waveform.separationMode', 'Processing mode');
      var separatorLabel = panel.querySelector('[data-i18n-role="wfSeparatorOptionLabel"]');
      if (separatorLabel) separatorLabel.textContent = t('audio.waveform.separatorOption', 'Stem separation mode');
      var separator = panel.querySelector('[data-role="wfSeparatorOption"]');
      if (separator) {
        Array.prototype.forEach.call(separator.options, function (option) {
          option.textContent = option.value === 'uvr5_ensemble_vocal_full'
            ? t('audio.waveform.separatorOption.uvr5', 'Vocal enhancement (experimental)')
            : option.value === 'advanced_stems'
              ? t('audio.waveform.separatorOption.advanced', 'Advanced stems (30 credits)')
              : t('audio.waveform.separatorOption.demucs', 'Stable separation (recommended)');
        });
      }
      var preset = panel.querySelector('[data-role="wfSeparationPreset"]');
      if (preset) {
        var presetLabels = {
          vocals_instrumental: t('transcription.separationPreset.vocalsInstrumental', 'Vocals / instrumental'),
          four_stem: t('transcription.separationPreset.fourStem', 'Four stems'),
          instruments_only: t('transcription.separationPreset.instrumentsOnly', 'Instrument stems'),
          vocals_bass_drums: t('transcription.separationPreset.vocalsBassDrums', 'Vocals + bass + drums'),
        };
        Array.prototype.forEach.call(preset.options, function (option) {
          option.textContent = presetLabels[option.value] || option.value;
        });
      }
      var mode = panel.querySelector('[data-role="wfSeparationMode"]');
      if (mode) {
        Array.prototype.forEach.call(mode.options, function (option) {
          option.textContent = option.value === 'separate_and_transcribe'
            ? t('audio.waveform.separationMode.transcribe', 'Create stems and editable notes (uses 2 credits)')
            : t('audio.waveform.separationMode.only', 'Create stems (uses 1 credit)');
        });
      }
      var separatorChoices = panel.querySelector('[data-role="wfSeparatorOptionChoices"]');
      if (separatorChoices && separatorLabel) separatorChoices.setAttribute('aria-label', separatorLabel.textContent || '');
      var modeChoices = panel.querySelector('[data-role="wfSeparationModeChoices"]');
      if (modeChoices && modeLabel) modeChoices.setAttribute('aria-label', modeLabel.textContent || '');
      syncSeparationChoiceButtons();
      var btnMap = [
        ['waveAtPlayhead', 'convert.atPlayhead', 'Start at playhead'],
        ['waveLen15', 'convert.preset15', '15s'],
        ['waveLen30', 'convert.preset30', '30s'],
        ['waveLen60', 'convert.preset60', '60s'],
        ['wavePreview', 'audio.waveform.preview', 'Preview selection'],
        ['waveSeparate', 'audio.waveform.separate', 'AI stem separation'],
        ['waveConvert', 'audio.waveform.convert', 'Convert to editable notes'],
        ['waveRetry', 'audio.waveform.retry', 'Retry conversion'],
        ['waveExtract', 'audio.waveform.extract', 'Extract as new audio clip'],
        ['waveSplitSilence', 'audio.waveform.splitSilence', 'Split audio', 'audio.waveform.splitSilenceTitle'],
        ['waveCloseBtn', 'common.cancel', 'Cancel'],
      ];
      btnMap.forEach(function (row) {
        var btn = panel.querySelector('[data-act="' + row[0] + '"]');
        if (btn) {
          btn.textContent = t(row[1], row[2]);
          if (row[3]) btn.title = t(row[3], row[2]);
        }
      });
      var downloadBtn = panel.querySelector('[data-act="waveDownloadOriginal"]');
      if (downloadBtn) {
        var downloadLabel = t('audio.waveform.download', 'Download audio');
        var downloadTitle = t('audio.waveform.downloadTitle', downloadLabel);
        downloadBtn.setAttribute('aria-label', downloadLabel);
        downloadBtn.title = downloadTitle;
      }
      updatePreviewButton();
      updateSeparationCost();
      syncSeparatorAvailability();
      updateConvertButtons();
    }

    function _isConvertBusy() {
      return convertPhase === 'queued' || convertPhase === 'uploading' || convertPhase === 'processing';
    }

    function updateConvertButtons() {
      if (!panel) return;
      var convertBtn = panel.querySelector('[data-act="waveConvert"]');
      var retryBtn = panel.querySelector('[data-act="waveRetry"]');
      var separateBtn = panel.querySelector('[data-act="waveSeparate"]');
      var separateBeforeConvert = panel.querySelector('[data-role="wfSeparateBeforeConvert"]');
      var separationSettingsToggle = panel.querySelector('[data-role="wfSeparationSettingsToggle"]');
      var separationPreset = panel.querySelector('[data-role="wfSeparationPreset"]');
      var separationMode = panel.querySelector('[data-role="wfSeparationMode"]');
      var separatorOption = panel.querySelector('[data-role="wfSeparatorOption"]');
      var splitBtn = panel.querySelector('[data-act="waveSplitSilence"]');
      var extractBtn = panel.querySelector('[data-act="waveExtract"]');
      var busy = _isConvertBusy();
      if (splitBtn) splitBtn.disabled = busy || separationBusy || silenceSplitBusy || typeof hooks.splitAudioAtSilence !== 'function';
      if (extractBtn) extractBtn.disabled = silenceSplitBusy;
      if (convertBtn) convertBtn.disabled = busy || separationBusy || silenceSplitBusy;
      if (separateBtn) separateBtn.disabled = busy || separationBusy || silenceSplitBusy;
      if (separateBeforeConvert) separateBeforeConvert.disabled = busy || separationBusy || silenceSplitBusy;
      if (separationSettingsToggle) separationSettingsToggle.disabled = busy || separationBusy || silenceSplitBusy;
      if (separationPreset) separationPreset.disabled = busy || separationBusy || silenceSplitBusy;
      if (separationMode) separationMode.disabled = busy || separationBusy || silenceSplitBusy;
      if (separatorOption) separatorOption.disabled = busy || separationBusy || silenceSplitBusy;
      syncSeparatorAvailability();
      if (retryBtn) {
        var showRetry = convertPhase === 'failed' || convertPhase === 'timed_out';
        retryBtn.hidden = !showRetry;
        retryBtn.disabled = busy || separationBusy || silenceSplitBusy;
      }
    }

    function setConvertStatus(st) {
      st = st || {};
      convertPhase = st.phase || 'idle';
      convertErrorBucket = st.errorBucket || null;
      convertTaskId = st.taskId ? String(st.taskId) : null;
      if (!statusEl) return;
      var txt = st.statusText || '';
      if (!txt && convertPhase === 'idle') {
        statusEl.textContent = '';
        updateConvertButtons();
        return;
      }
      if (!txt) {
        if (convertPhase === 'queued') txt = t('convert.phase.queued', 'Queued for conversion…');
        else if (convertPhase === 'uploading') txt = t('convert.phase.uploading', 'Uploading audio for conversion…');
        else if (convertPhase === 'processing') txt = t('convert.phase.processing', 'Converting selected segment…');
        else if (convertPhase === 'completed') txt = t('convert.phase.completed', 'Conversion complete.');
        else if (convertPhase === 'timed_out') txt = t('convert.phase.timedOut', 'Conversion timed out. Try again.');
        else if (convertPhase === 'failed') txt = t('convert.fail.generic', 'Conversion failed. Try again.');
      }
      if (convertTaskId && convertTaskId.length >= 8) {
        txt += ' (' + t('convert.taskShort', 'task') + ': ' + convertTaskId.slice(0, 8) + '…)';
      }
      statusEl.textContent = txt;
      updateConvertButtons();
    }

    async function open(ctx) {
      ctx = ctx || {};
      ensureDom();
      openCtx = { clipId: String(ctx.clipId || ''), instanceId: ctx.instanceId || null };
      var transcriptionControls = (typeof hooks.getTranscriptionControls === 'function')
        ? hooks.getTranscriptionControls(openCtx.clipId)
        : null;
      var separateBeforeConvert = panel.querySelector('[data-role="wfSeparateBeforeConvert"]');
      if (separateBeforeConvert) separateBeforeConvert.checked = !!(transcriptionControls && transcriptionControls.separateFirst === true);
      var separatorOption = panel.querySelector('[data-role="wfSeparatorOption"]');
      if (separatorOption) separatorOption.value = 'demucs';
      var separationPreset = panel.querySelector('[data-role="wfSeparationPreset"]');
      if (separationPreset && transcriptionControls && transcriptionControls.separationPreset) {
        var requestedPreset = String(transcriptionControls.separationPreset);
        var matchingPreset = Array.prototype.some.call(separationPreset.options, function (option) {
          return option.value === requestedPreset;
        });
        if (matchingPreset) separationPreset.value = requestedPreset;
      }
      var separationSettingsToggle = panel.querySelector('[data-role="wfSeparationSettingsToggle"]');
      if (separationSettingsToggle) separationSettingsToggle.checked = false;
      syncSeparationSettingsVisibility();
      applyI18nLabels();
      syncSeparatorAvailability();
      stopPreview();
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        objectUrl = null;
      }
      audioBuffer = null;
      peaks = [];
      setFallbackVisible(false, '');
      convertPhase = 'idle';
      convertErrorBucket = null;
      convertTaskId = null;
      if (statusEl) statusEl.textContent = t('common.loading', 'Loading...');
      updateConvertButtons();

      var clipMeta = (typeof hooks.getClipMeta === 'function')
        ? hooks.getClipMeta(openCtx.clipId)
        : null;
      if (!clipMeta) {
        try { alert(t('audio.waveform.missingFile', 'This audio material cannot be opened right now. Please re-import it and try again.')); } catch (e) {}
        return { ok: false, reason: 'no_clip' };
      }

      audioDur = _num(clipMeta.durationSec, 0);
      panel.querySelector('[data-role="wfClipName"]').textContent = escapeHtml(clipMeta.name || openCtx.clipId);
      panel.querySelector('[data-role="wfTotalDur"]').textContent = fmtSec(audioDur);

      applySegmentFromHooks();
      overlay.hidden = false;

      var file = null;
      if (typeof hooks.resolveAudioFile === 'function') {
        file = await hooks.resolveAudioFile(openCtx.clipId);
      }
      if (!file) {
        overlay.hidden = true;
        try { alert(t('audio.waveform.missingFile', 'This audio material cannot be opened right now. Please re-import it and try again.')); } catch (e) {}
        return { ok: false, reason: 'missing_file' };
      }

      try {
        objectUrl = URL.createObjectURL(file);
      } catch (e) {
        objectUrl = null;
      }

      try {
        var decoder = (typeof window !== 'undefined') ? window.H2SAudioDecode : null;
        if (!decoder || typeof decoder.decodeAudioFile !== 'function') throw new Error('audio_decode_unavailable');
        audioBuffer = await decoder.decodeAudioFile(file);
        if (audioDur <= 0 && audioBuffer) audioDur = audioBuffer.duration;
        peaks = computePeaksFromBuffer(audioBuffer, DEFAULT_PEAKS);
        setFallbackVisible(false, '');
        if (statusEl) statusEl.textContent = '';
        if (openCtx && typeof hooks.getConvertState === 'function') {
          var cs = hooks.getConvertState(openCtx.clipId);
          if (cs) setConvertStatus(cs);
        }
        redrawCanvas();
      } catch (decErr) {
        setFallbackVisible(true, t('audio.waveform.decodeFailed', 'Waveform preview unavailable. Use the numeric controls below.'));
        if (statusEl) statusEl.textContent = '';
      }

      return { ok: true };
    }

    function close() {
      stopPreview();
      if (overlay) overlay.hidden = true;
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
        objectUrl = null;
      }
      openCtx = null;
      if (typeof hooks.onClosed === 'function') hooks.onClosed();
    }

    function getState() {
      return {
        clipId: openCtx && openCtx.clipId,
        selStart: selStart,
        selEnd: selEnd,
        previewActive: previewActive,
        audioDur: audioDur,
      };
    }

    return {
      open: open,
      close: close,
      getState: getState,
      stopPreview: stopPreview,
      setConvertStatus: setConvertStatus,
    };
  }

  var api = {
    MIN_SELECT_SEC: MIN_SELECT_SEC,
    MAX_SELECT_SEC: MAX_SELECT_SEC,
    clampSelection: clampSelection,
    computePeaksFromChannel: computePeaksFromChannel,
    computePeaksFromBuffer: computePeaksFromBuffer,
    encodeWavFromAudioBuffer: encodeWavFromAudioBuffer,
    drawWaveformCanvas: drawWaveformCanvas,
    segmentFromHandles: segmentFromHandles,
    createController: createController,
  };

  if (typeof window !== 'undefined') {
    window.H2SAudioWaveformEditor = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
