/* Hum2Song Studio - ui/clip_thumbnail_view.js
 * Responsive timeline clip thumbnails:
 * - MIDI: every note contributes to a high-DPI Canvas raster.
 * - Audio: real cached min/max PCM peaks, never a fabricated waveform.
 */
(function(root, factory){
  'use strict';
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SClipThumbnailView = api;
})(typeof window !== 'undefined' ? window : null, function(root){
  'use strict';

  var MathApi = null;
  var WaveformApi = null;
  try { MathApi = require('../core/clip_thumbnail_math.js'); } catch (_e) {}
  try { WaveformApi = require('../core/waveform_peaks.js'); } catch (_e2) {}
  if (!MathApi && root) MathApi = root.H2SClipThumbnailMath;
  if (!WaveformApi && root) WaveformApi = root.H2SWaveformPeaks;

  var NOTE_FILL = 'rgba(219,238,255,0.82)';
  var AUDIO_FILL = 'rgba(167,243,208,0.78)';
  var PLACEHOLDER_STROKE = 'rgba(255,255,255,0.22)';
  var MAX_CANVAS_EDGE = 8192;
  var waveformPromiseCache = new Map();

  function clamp(n, min, max){
    return Math.min(max, Math.max(min, n));
  }

  function finiteNumber(value, fallback){
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clipCacheKey(clip){
    if (!clip || typeof clip !== 'object') return '';
    if (clip.audio && clip.audio.assetRef) return String(clip.audio.assetRef);
    return String(clip.id || '');
  }

  function setupCanvas(canvas, cssWidth, cssHeight, pixelRatio){
    var width = Math.max(1, finiteNumber(cssWidth, 80));
    var height = Math.max(1, finiteNumber(cssHeight, 60));
    var ratio = clamp(finiteNumber(pixelRatio, root && root.devicePixelRatio ? root.devicePixelRatio : 1), 1, 2);
    var backingWidth = Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(width * ratio)));
    var backingHeight = Math.max(1, Math.min(MAX_CANVAS_EDGE, Math.round(height * ratio)));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return {
      ctx: ctx,
      width: width,
      height: height,
      pixelRatio: ratio,
      columns: backingWidth,
    };
  }

  function derivePitchViewport(notes){
    var pitches = (Array.isArray(notes) ? notes : [])
      .map(function(note){ return Number(note && note.pitch); })
      .filter(function(pitch){ return isFinite(pitch); })
      .sort(function(a, b){ return a - b; });
    if (!pitches.length) return { pitchMin: 48, pitchMax: 72 };
    var lowIndex = pitches.length >= 100 ? Math.floor((pitches.length - 1) * 0.01) : 0;
    var highIndex = pitches.length >= 100 ? Math.ceil((pitches.length - 1) * 0.99) : pitches.length - 1;
    var low = pitches[lowIndex];
    var high = pitches[highIndex];
    var pitchMin = Math.floor((low - 2) / 12) * 12;
    var pitchMax = Math.ceil((high + 2) / 12) * 12;
    if (pitchMax - pitchMin < 12){
      var center = (pitchMin + pitchMax) / 2;
      pitchMin = Math.floor((center - 6) / 12) * 12;
      pitchMax = pitchMin + 12;
    }
    return { pitchMin: pitchMin, pitchMax: pitchMax };
  }

  function buildMidiDrawCommands(preview, width, height){
    var notes = preview && Array.isArray(preview.notes) ? preview.notes : [];
    var spanTime = preview && preview.spanTime > 0 ? preview.spanTime : 1;
    var viewport = derivePitchViewport(notes);
    var pitchSpan = Math.max(1, viewport.pitchMax - viewport.pitchMin);
    var contentTop = Math.min(height - 2, 18);
    var contentBottom = Math.max(contentTop + 1, height - 4);
    var contentHeight = Math.max(1, contentBottom - contentTop);
    var noteHeight = clamp((contentHeight / (pitchSpan + 1)) * 0.82, 0.8, 3.2);
    var commands = [];

    for (var i = 0; i < notes.length; i++){
      var note = notes[i] || {};
      var start = finiteNumber(note.startTime, 0);
      var duration = Math.max(0, finiteNumber(note.durationTime, 0));
      var pitch = finiteNumber(note.pitch, 60);
      var rawX = (start / spanTime) * width;
      var projectedWidth = (duration / spanTime) * width;
      if (rawX >= width || rawX + projectedWidth < 0) continue;
      var drawWidth = Math.max(0.8, projectedWidth);
      var visiblePitch = clamp(pitch, viewport.pitchMin, viewport.pitchMax);
      var y = contentTop + ((viewport.pitchMax - visiblePitch) / pitchSpan) * Math.max(0, contentHeight - noteHeight);
      var velocity = clamp(finiteNumber(note.velocity, 96), 1, 127) / 127;
      var subPixelCoverage = projectedWidth >= 0.8 ? 1 : clamp(projectedWidth / 0.8, 0.22, 1);
      commands.push({
        x: clamp(rawX, 0, width),
        y: clamp(y, contentTop, contentBottom - noteHeight),
        width: Math.min(drawWidth, Math.max(0.8, width - clamp(rawX, 0, width))),
        height: noteHeight,
        alpha: (0.38 + velocity * 0.5) * subPixelCoverage,
        outlier: pitch < viewport.pitchMin || pitch > viewport.pitchMax,
      });
    }
    return {
      commands: commands,
      pitchMin: viewport.pitchMin,
      pitchMax: viewport.pitchMax,
      contentTop: contentTop,
      contentBottom: contentBottom,
    };
  }

  function drawMidiPreview(canvas, preview, width, height, options){
    var surface = setupCanvas(canvas, width, height, options && options.pixelRatio);
    if (!surface) return false;
    var ctx = surface.ctx;
    var raster = buildMidiDrawCommands(preview, surface.width, surface.height);
    ctx.fillStyle = NOTE_FILL;
    for (var i = 0; i < raster.commands.length; i++){
      var command = raster.commands[i];
      ctx.globalAlpha = command.outlier ? command.alpha * 0.55 : command.alpha;
      ctx.fillRect(command.x, command.y, command.width, command.height);
    }
    ctx.globalAlpha = 1;
    return true;
  }

  function drawNotationPreview(canvas, preview, width, height, pref, options){
    var surface = setupCanvas(canvas, width, height, options && options.pixelRatio);
    if (!surface) return false;
    var ctx=surface.ctx, w=surface.width, h=surface.height;
    var N=root && root.H2SNotation;
    if (!N) return drawMidiPreview(canvas, preview, width, height, options);
    var baseline=Math.max(30,h*0.65), gap=Math.max(3,Math.min(5,(h-22)/7));
    ctx.strokeStyle='rgba(219,238,255,.32)';ctx.lineWidth=0.7;
    if(pref.view==='staff') for(var l=0;l<5;l++){
      ctx.beginPath();ctx.moveTo(0,baseline-l*gap);ctx.lineTo(w,baseline-l*gap);ctx.stroke();
    }
    ctx.fillStyle=NOTE_FILL;ctx.strokeStyle=NOTE_FILL;ctx.font='600 12px Arial';ctx.textAlign='center';
    (preview.notes || []).forEach(function(n){
      var x=n.startTime/Math.max(.001,preview.spanTime)*w;
      var sp=N.spelling(n.pitch,pref.key || 'C');
      if(pref.view==='jianpu'){
        ctx.fillText((sp.accidental==='b'?'♭':sp.accidental==='#'?'♯':'')+sp.degree,Math.max(5,x),baseline);
        for(var k=0;k<Math.min(3,Math.abs(sp.octave));k++){
          ctx.beginPath();ctx.arc(Math.max(5,x),sp.octave>0?baseline-14-k*3:baseline+5+k*3,1,0,Math.PI*2);ctx.fill();
        }
      }else{
        var key=sp.key.split('/'),degree='cdefgab'.indexOf(key[0])+Number(key[1])*7;
        var low=pref.clef==='bass'?18:30; // G2 / E4 at the bottom staff line.
        var y=Math.max(19,Math.min(h-4,baseline-(degree-low)*gap/2));
        ctx.beginPath();ctx.ellipse(Math.max(3,x),y,3,2,-.3,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.moveTo(Math.max(3,x)+2,y);ctx.lineTo(Math.max(3,x)+2,y-10);ctx.stroke();
      }
    });
    return true;
  }

  function drawAudioPlaceholder(canvas, width, height, failed, options){
    var surface = setupCanvas(canvas, width, height, options && options.pixelRatio);
    if (!surface) return false;
    var ctx = surface.ctx;
    var top = Math.min(surface.height - 2, 18);
    var bottom = Math.max(top + 1, surface.height - 4);
    var mid = (top + bottom) / 2;
    ctx.strokeStyle = failed ? 'rgba(248,113,113,0.42)' : PLACEHOLDER_STROKE;
    ctx.lineWidth = 1;
    if (failed && ctx.setLineDash) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(surface.width, mid + 0.5);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    return true;
  }

  function drawAudioWaveform(canvas, waveform, width, height, options){
    var surface = setupCanvas(canvas, width, height, options && options.pixelRatio);
    if (!surface || !WaveformApi) return false;
    var normalized = WaveformApi.normalizePeakPyramid(waveform);
    if (!normalized) return drawAudioPlaceholder(canvas, width, height, true, options);
    var level = WaveformApi.selectLevelForWidth(normalized, surface.columns);
    if (!level) return drawAudioPlaceholder(canvas, width, height, true, options);

    var ctx = surface.ctx;
    var top = Math.min(surface.height - 2, 18);
    var bottom = Math.max(top + 1, surface.height - 4);
    var mid = (top + bottom) / 2;
    var half = Math.max(1, (bottom - top) / 2 - 1);
    var columns = Math.max(1, Math.min(surface.columns, level.length));
    var lows = new Float32Array(columns);
    var xStep = surface.width / columns;

    ctx.strokeStyle = 'rgba(167,243,208,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(surface.width, mid + 0.5);
    ctx.stroke();

    ctx.beginPath();
    for (var column = 0; column < columns; column++){
      var from = Math.floor((column / columns) * level.length);
      var to = Math.max(from + 1, Math.ceil(((column + 1) / columns) * level.length));
      to = Math.min(level.length, to);
      var minValue = 32767;
      var maxValue = -32768;
      for (var point = from; point < to; point++){
        if (level.min[point] < minValue) minValue = level.min[point];
        if (level.max[point] > maxValue) maxValue = level.max[point];
      }
      if (minValue > maxValue){ minValue = 0; maxValue = 0; }
      var x = column * xStep;
      var upperY = mid - (maxValue / 32767) * half;
      var lowerY = mid - (minValue / 32768) * half;
      lows[column] = lowerY;
      if (column === 0) ctx.moveTo(x, upperY);
      else ctx.lineTo(x, upperY);
    }
    for (var reverse = columns - 1; reverse >= 0; reverse--){
      ctx.lineTo((reverse + 1) * xStep, lows[reverse]);
    }
    ctx.closePath();
    ctx.fillStyle = AUDIO_FILL;
    ctx.fill();
    return true;
  }

  function decodeFileToWaveform(file){
    if (!root || !file || !WaveformApi) return Promise.resolve(null);
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC || typeof file.arrayBuffer !== 'function') return Promise.resolve(null);
    var context = new AC();
    return file.arrayBuffer()
      .then(function(buffer){ return context.decodeAudioData(buffer.slice(0)); })
      .then(function(audioBuffer){
        if (typeof WaveformApi.computePeakPyramidFromAudioBufferAsync === 'function'){
          return WaveformApi.computePeakPyramidFromAudioBufferAsync(audioBuffer);
        }
        return WaveformApi.computePeakPyramidFromAudioBuffer(audioBuffer);
      })
      .catch(function(){ return null; })
      .then(function(waveform){
        try { return Promise.resolve(context.close()).catch(function(){}).then(function(){ return waveform; }); }
        catch (_e) { return waveform; }
      });
  }

  function loadWaveformForClip(clip, options){
    options = options || {};
    var key = clipCacheKey(clip);
    if (!key) return Promise.resolve(null);
    if (waveformPromiseCache.has(key)) return waveformPromiseCache.get(key);
    var LAS = root && root.H2SLocalAudioAssets;
    var readCached = LAS && typeof LAS.getWaveformForLocalAssetRef === 'function'
      ? LAS.getWaveformForLocalAssetRef(key)
      : Promise.resolve(null);
    var promise = Promise.resolve(readCached).then(function(cached){
      var normalized = WaveformApi && WaveformApi.normalizePeakPyramid(cached);
      if (normalized) return normalized;
      if (typeof options.resolveAudioFile !== 'function') return null;
      return Promise.resolve(options.resolveAudioFile(clip.id)).then(function(file){
        return decodeFileToWaveform(file);
      }).then(function(generated){
        if (!generated) return null;
        if (LAS && typeof LAS.putWaveformForLocalAssetRef === 'function'){
          Promise.resolve(LAS.putWaveformForLocalAssetRef(key, generated)).catch(function(){});
        }
        return generated;
      });
    }).catch(function(){ return null; });
    waveformPromiseCache.set(key, promise);
    return promise;
  }

  function instThumbHTML(){
    return '<div class="instThumb" data-role="inst-thumb" aria-hidden="true"><canvas class="instThumbCanvas"></canvas></div>';
  }

  function hydrateInstThumb(instanceEl, clip, width, height, options){
    if (!instanceEl || !clip) return Promise.resolve(false);
    var canvas = instanceEl.querySelector && instanceEl.querySelector('.instThumbCanvas');
    if (!canvas) return Promise.resolve(false);
    var token = (canvas.__h2sThumbToken || 0) + 1;
    canvas.__h2sThumbToken = token;
    var isAudio = clip.kind === 'audio';
    if (!isAudio){
      if (!MathApi || typeof MathApi.deriveClipThumbnailPreview !== 'function') return Promise.resolve(false);
      var preview = MathApi.deriveClipThumbnailPreview(clip, {
        maxNotesPerClip: Number.MAX_SAFE_INTEGER,
        maxScanNotesPerClip: Number.MAX_SAFE_INTEGER,
        spanSec: options && options.spanSec,
      });
      var pref=clip.meta && clip.meta.notation;
      if(pref && (pref.view==='staff' || pref.view==='jianpu')){
        canvas.dataset.notation=pref.view;
        return Promise.resolve(drawNotationPreview(canvas,preview,width,height,pref,options));
      }
      if(canvas.dataset) delete canvas.dataset.notation;
      return Promise.resolve(drawMidiPreview(canvas, preview, width, height, options));
    }

    drawAudioPlaceholder(canvas, width, height, false, options);
    return loadWaveformForClip(clip, options).then(function(waveform){
      if (canvas.__h2sThumbToken !== token) return false;
      if (!waveform) return drawAudioPlaceholder(canvas, width, height, true, options);
      return drawAudioWaveform(canvas, waveform, width, height, options);
    });
  }

  /* Legacy helper retained for Node contracts and older embedders; timeline uses Canvas. */
  function thumbnailSvgHTML(preview, width, height){
    var w = Math.max(1, Math.round(Number(width) || 80));
    var h = Math.max(1, Math.round(Number(height) || 60));
    var kind = preview && preview.kind ? preview.kind : 'unsupported';
    var rects = '';
    if (kind === 'audio'){
      var peaks = Array.isArray(preview.waveformPeaks) ? preview.waveformPeaks : [];
      var mid = h / 2;
      var barW = Math.max(1, w / Math.max(1, peaks.length));
      for (var i = 0; i < peaks.length; i++){
        var peak = clamp(Number(peaks[i]) || 0.1, 0.05, 1);
        var barHeight = Math.max(2, peak * (h * 0.78));
        rects += '<rect x="' + (i * barW).toFixed(2) + '" y="' + (mid - barHeight / 2).toFixed(2) + '" width="' + Math.max(1, barW - 0.5).toFixed(2) + '" height="' + barHeight.toFixed(2) + '" fill="' + AUDIO_FILL + '"/>';
      }
    } else {
      var commands = buildMidiDrawCommands(preview || {}, w, h).commands;
      for (var j = 0; j < commands.length; j++){
        var command = commands[j];
        rects += '<rect x="' + command.x.toFixed(2) + '" y="' + command.y.toFixed(2) + '" width="' + command.width.toFixed(2) + '" height="' + command.height.toFixed(2) + '" fill="' + NOTE_FILL + '"/>';
      }
    }
    if (!rects) rects = '<line x1="4" y1="' + (h / 2) + '" x2="' + (w - 4) + '" y2="' + (h / 2) + '" stroke="' + PLACEHOLDER_STROKE + '" stroke-width="1" stroke-dasharray="3 3"/>';
    return '<svg class="instThumbSvg" width="100%" height="100%" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' + rects + '</svg>';
  }

  return {
    VERSION: 'clip_thumbnail_view_v3_canvas',
    thumbnailSvgHTML: thumbnailSvgHTML,
    instThumbHTML: instThumbHTML,
    hydrateInstThumb: hydrateInstThumb,
    derivePitchViewport: derivePitchViewport,
    buildMidiDrawCommands: buildMidiDrawCommands,
    drawMidiPreview: drawMidiPreview,
    drawNotationPreview: drawNotationPreview,
    drawAudioPlaceholder: drawAudioPlaceholder,
    drawAudioWaveform: drawAudioWaveform,
    loadWaveformForClip: loadWaveformForClip,
    _clearWaveformCacheForTests: function(){ waveformPromiseCache.clear(); },
  };
});
