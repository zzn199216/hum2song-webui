/* Hum2Song Studio - bridge to the browser-local AudioAnalysis worker. */
(function(root, factory){
  'use strict';
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SAudioInstrumentClient = api;
})(typeof window !== 'undefined' ? window : globalThis, function(root){
  'use strict';

  function create(opts){
    opts = opts || {};
    var worker = null;
    var sequence = 0;
    var pending = new Map();
    var workerUrl = opts.workerUrl || '/static/pianoroll/core/audio_instrument_worker.js';

    function ensureWorker(){
      if (worker) return worker;
      if (typeof Worker !== 'function') throw new Error('audio_instrument_worker_unavailable');
      worker = new Worker(workerUrl + (workerUrl.indexOf('?') >= 0 ? '&' : '?') + 'v=audio-instrument-v5');
      worker.onmessage = function(event){
        var data = event.data || {};
        var request = data.requestId != null ? pending.get(String(data.requestId)) : null;
        if (data.type === 'progress'){
          if (request && typeof request.onProgress === 'function') request.onProgress(Number(data.progress) || 0);
          return;
        }
        if (!request) return;
        pending.delete(String(data.requestId));
        if (data.type === 'result') request.resolve(data.result);
        else request.reject(new Error(String(data.error || 'instrument_analysis_failed')));
      };
      worker.onerror = function(event){
        pending.forEach(function(request){ request.reject(new Error(String(event && event.message || 'instrument_analysis_worker_failed'))); });
        pending.clear();
        worker = null;
      };
      return worker;
    }

    function monoSamples(audioBuffer){
      if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') throw new Error('invalid_audio_buffer');
      var channels = Math.max(1, Number(audioBuffer.numberOfChannels) || 1);
      var length = Number(audioBuffer.length) || 0;
      var mono = new Float32Array(length);
      for (var channelIndex = 0; channelIndex < channels; channelIndex++){
        var data = audioBuffer.getChannelData(channelIndex);
        for (var i = 0; i < length; i++) mono[i] += Number(data[i] || 0) / channels;
      }
      return mono;
    }

    function analyzeAudioBuffer(audioBuffer, options){
      options = options || {};
      var id = String(++sequence);
      var samples = monoSamples(audioBuffer);
      var activeWorker = ensureWorker();
      return new Promise(function(resolve, reject){
        pending.set(id, { resolve: resolve, reject: reject, onProgress: options.onProgress });
        activeWorker.postMessage({
          type: 'analyze',
          requestId: id,
          audio: samples,
          sampleRate: Number(audioBuffer.sampleRate) || 48000,
          diagnostic: options.diagnostic === true,
        }, [samples.buffer]);
      });
    }

    function dispose(){
      if (worker) worker.terminate();
      worker = null;
      pending.forEach(function(request){ request.reject(new Error('audio_instrument_worker_disposed')); });
      pending.clear();
    }

    return { analyzeAudioBuffer: analyzeAudioBuffer, dispose: dispose };
  }

  return { create: create };
});
