/* Hum2Song Studio - browser-local YAMNet ONNX instrument worker.
 * The model runs off the UI thread through ONNX Runtime Web/WASM.
 * Audio bytes and inference results remain in this browser tab.
 */
(function(){
  'use strict';

  var MODEL_VERSION = 'yamnet-audioset-onnx-v1';
  var SAMPLE_RATE = 16000;
  var WINDOW_SAMPLES = 400;
  var HOP_SAMPLES = 160;
  var FFT_SIZE = 512;
  var SPECTRUM_BINS = FFT_SIZE / 2 + 1;
  var PATCH_FRAMES = 96;
  // Instrument presence does not need YAMNet's dense 0.48s hop.  A 0.96s
  // hop plus an evenly distributed cap keeps long-song scans responsive.
  var PATCH_HOP_FRAMES = 96;
  var MAX_PATCHES = 32;
  var MEL_BANDS = 64;
  var MEL_MIN_HZ = 125;
  var MEL_MAX_HZ = 7500;
  var LOG_OFFSET = 0.001;
  var sessionPromise = null;
  var melWeights = null;
  var hann = null;

  var GROUPS = [
    { id: 'piano', name: '钢琴', indices: [147, 148, 149] },
    { id: 'guitar', name: '吉他', indices: [135, 136, 138, 139] },
    { id: 'bass', name: '贝斯', indices: [137] },
    { id: 'drums', name: '鼓组', indices: [157, 158, 159, 160, 162, 163] },
    { id: 'percussion', name: '打击乐', indices: [156, 165, 166, 167, 172, 174, 175, 176] },
    { id: 'organ', name: '管风琴', indices: [150, 151, 152] },
    { id: 'synth', name: '合成器', indices: [153] },
    { id: 'brass', name: '铜管', indices: [180, 181, 182, 183] },
    { id: 'strings', name: '弦乐', indices: [185, 186, 188, 189] },
    { id: 'woodwinds', name: '木管', indices: [191, 192, 193] },
    { id: 'harp', name: '竖琴', indices: [194] },
    { id: 'banjo', name: '班卓琴', indices: [142] },
    { id: 'mandolin', name: '曼陀林', indices: [144] },
    { id: 'ukulele', name: '尤克里里', indices: [146] },
    { id: 'harmonica', name: '口琴', indices: [203] },
    { id: 'accordion', name: '手风琴', indices: [204] },
  ];

  function post(message, transfer){
    self.postMessage(message, transfer || []);
  }

  function clamp(value, min, max){ return Math.max(min, Math.min(max, value)); }

  function resampleLinear(source, sourceRate){
    sourceRate = Number(sourceRate);
    if (!sourceRate || sourceRate === SAMPLE_RATE) return source;
    var length = Math.max(1, Math.round(source.length * SAMPLE_RATE / sourceRate));
    var output = new Float32Array(length);
    var ratio = sourceRate / SAMPLE_RATE;
    for (var i = 0; i < length; i++){
      var position = i * ratio;
      var left = Math.floor(position);
      var right = Math.min(source.length - 1, left + 1);
      var amount = position - left;
      output[i] = (source[left] || 0) * (1 - amount) + (source[right] || 0) * amount;
    }
    return output;
  }

  function paddedLength(sampleCount){
    var minSamples = Math.round((0.96 + 0.025 - 0.010) * SAMPLE_RATE);
    var first = Math.max(sampleCount, minSamples);
    var afterFirst = first - minSamples;
    var hopCount = Math.ceil(afterFirst / (PATCH_HOP_FRAMES * HOP_SAMPLES));
    var padding = Math.max(0, minSamples - sampleCount) +
      PATCH_HOP_FRAMES * HOP_SAMPLES * hopCount - afterFirst;
    return sampleCount + padding;
  }

  function reverseBits(value, bits){
    var result = 0;
    for (var i = 0; i < bits; i++){
      result = (result << 1) | (value & 1);
      value >>= 1;
    }
    return result;
  }

  function fftMagnitude(frame){
    var real = new Float64Array(FFT_SIZE);
    var imag = new Float64Array(FFT_SIZE);
    var bits = 9;
    for (var i = 0; i < FFT_SIZE; i++) real[reverseBits(i, bits)] = frame[i] || 0;
    for (var size = 2; size <= FFT_SIZE; size <<= 1){
      var half = size >> 1;
      var angle = -2 * Math.PI / size;
      for (var start = 0; start < FFT_SIZE; start += size){
        for (var j = 0; j < half; j++){
          var phase = angle * j;
          var wr = Math.cos(phase);
          var wi = Math.sin(phase);
          var even = start + j;
          var odd = even + half;
          var tr = wr * real[odd] - wi * imag[odd];
          var ti = wr * imag[odd] + wi * real[odd];
          real[odd] = real[even] - tr;
          imag[odd] = imag[even] - ti;
          real[even] += tr;
          imag[even] += ti;
        }
      }
    }
    var magnitude = new Float32Array(SPECTRUM_BINS);
    for (var bin = 0; bin < SPECTRUM_BINS; bin++) magnitude[bin] = Math.hypot(real[bin], imag[bin]);
    return magnitude;
  }

  function hzToMel(hz){ return 1127 * Math.log(1 + hz / 700); }
  function melToHz(mel){ return 700 * (Math.exp(mel / 1127) - 1); }

  function buildMelWeights(){
    if (melWeights) return melWeights;
    melWeights = new Float32Array(SPECTRUM_BINS * MEL_BANDS);
    var lowMel = hzToMel(MEL_MIN_HZ);
    var highMel = hzToMel(MEL_MAX_HZ);
    var points = [];
    for (var i = 0; i < MEL_BANDS + 2; i++){
      var mel = lowMel + (highMel - lowMel) * i / (MEL_BANDS + 1);
      points.push(melToHz(mel) / (SAMPLE_RATE / (FFT_SIZE * 2)));
    }
    for (var bin = 0; bin < SPECTRUM_BINS; bin++){
      for (var band = 0; band < MEL_BANDS; band++){
        var left = points[band];
        var center = points[band + 1];
        var right = points[band + 2];
        var rising = center > left ? (bin - left) / (center - left) : 0;
        var falling = right > center ? (right - bin) / (right - center) : 0;
        melWeights[bin * MEL_BANDS + band] = Math.max(0, Math.min(rising, falling));
      }
    }
    return melWeights;
  }

  function buildFeatures(samples){
    if (!hann){
      hann = new Float64Array(WINDOW_SAMPLES);
      for (var h = 0; h < WINDOW_SAMPLES; h++) hann[h] = 0.5 - 0.5 * Math.cos(2 * Math.PI * h / WINDOW_SAMPLES);
    }
    var padded = paddedLength(samples.length);
    var frameCount = Math.floor((padded - WINDOW_SAMPLES) / HOP_SAMPLES) + 1;
    var spectrogram = new Float32Array(frameCount * MEL_BANDS);
    var weights = buildMelWeights();
    var frame = new Float64Array(FFT_SIZE);
    for (var frameIndex = 0; frameIndex < frameCount; frameIndex++){
      frame.fill(0);
      var start = frameIndex * HOP_SAMPLES;
      for (var sample = 0; sample < WINDOW_SAMPLES; sample++) frame[sample] = (samples[start + sample] || 0) * hann[sample];
      var magnitude = fftMagnitude(frame);
      for (var band = 0; band < MEL_BANDS; band++){
        var melPower = 0;
        for (var bin = 0; bin < SPECTRUM_BINS; bin++) melPower += magnitude[bin] * weights[bin * MEL_BANDS + band];
        spectrogram[frameIndex * MEL_BANDS + band] = Math.log(melPower + LOG_OFFSET);
      }
    }
    var patchCount = Math.floor((frameCount - PATCH_FRAMES) / PATCH_HOP_FRAMES) + 1;
    var patches = new Array(patchCount);
    for (var patch = 0; patch < patchCount; patch++){
      var output = new Float32Array(PATCH_FRAMES * MEL_BANDS);
      var offset = patch * PATCH_HOP_FRAMES * MEL_BANDS;
      output.set(spectrogram.subarray(offset, offset + output.length));
      patches[patch] = output;
    }
    return patches;
  }

  function selectPatches(patches){
    if (patches.length <= MAX_PATCHES) return patches;
    var selected = new Array(MAX_PATCHES);
    for (var i = 0; i < MAX_PATCHES; i++){
      var sourceIndex = Math.round(i * (patches.length - 1) / (MAX_PATCHES - 1));
      selected[i] = patches[sourceIndex];
    }
    return selected;
  }

  function ensureOrt(){
    if (sessionPromise) return sessionPromise;
    importScripts(new URL('../vendor/onnxruntime-web/ort.wasm.min.js?v=ort-web-118', self.location.href).href);
    ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime-web/', self.location.href).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    var modelUrl = new URL('../vendor/yamnet-v1/yamnet.onnx?v=yamnet-inline-v1', self.location.href).href;
    sessionPromise = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return sessionPromise;
  }

  function scoreGroups(scores, count){
    return GROUPS.map(function(group){
      var score = 0;
      group.indices.forEach(function(index){
        // Qualcomm's YAMNet export exposes AudioSet logits; convert each
        // independent label to a probability before multi-label aggregation.
        var logit = Number(scores[index] || 0);
        score = Math.max(score, 1 / (1 + Math.exp(-logit)));
      });
      return { group: group, score: score, count: count };
    });
  }

  async function analyze(message){
    var source = message.audio instanceof Float32Array ? message.audio : new Float32Array(message.audio);
    var samples = resampleLinear(source, Number(message.sampleRate) || SAMPLE_RATE);
    post({ type: 'progress', requestId: message.requestId, progress: 0, phase: 'preparing' });
    var allPatches = buildFeatures(samples);
    var patches = selectPatches(allPatches);
    var session = await ensureOrt();
    var stats = GROUPS.map(function(group){ return { group: group, sum: 0, peak: 0, active: 0 }; });
    for (var patchIndex = 0; patchIndex < patches.length; patchIndex++){
      var tensor = new ort.Tensor('float32', patches[patchIndex], [1, 1, PATCH_FRAMES, MEL_BANDS]);
      var outputs = await session.run({ audio: tensor });
      var scores = outputs.class_scores.data;
      scoreGroups(scores, patches.length).forEach(function(item, index){
        stats[index].sum += item.score;
        stats[index].peak = Math.max(stats[index].peak, item.score);
        if (item.score >= 0.20) stats[index].active += 1;
      });
      post({ type: 'progress', requestId: message.requestId, progress: Math.round((patchIndex + 1) / patches.length * 100) });
    }
    var items = stats.map(function(item){
      var mean = item.sum / patches.length;
      var coverage = item.active / patches.length;
      var confidence = clamp(0.65 * item.peak + 0.35 * Math.min(1, mean * 3), 0, 0.99);
      return {
        id: item.group.id,
        name: item.group.name,
        confidence: Number(confidence.toFixed(3)),
        peakScore: Number(item.peak.toFixed(3)),
        coverage: Number(coverage.toFixed(3)),
      };
    }).filter(function(item){ return item.peakScore >= 0.25 && (item.coverage >= 0.02 || item.confidence >= 0.45); })
      .sort(function(a, b){ return b.confidence - a.confidence; });
    return {
      status: 'ok',
      analyzerVersion: MODEL_VERSION,
      model: 'YAMNet AudioSet ONNX',
      executionProvider: 'wasm',
      durationSec: Number((samples.length / SAMPLE_RATE).toFixed(3)),
      frames: patches.length,
      candidateFrames: allPatches.length,
      samplingMode: 'fast-scan',
      items: items,
    };
  }

  self.onmessage = function(event){
    var message = event.data || {};
    if (message.type !== 'analyze') return;
    analyze(message).then(function(result){ post({ type: 'result', requestId: message.requestId, result: result }); })
      .catch(function(error){ post({ type: 'error', requestId: message.requestId, error: String(error && error.message || error || 'instrument_analysis_failed') }); });
  };
})();
