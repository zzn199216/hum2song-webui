/* Hum2Song Studio - AudioAnalysis V0 pure engine.
 * No DOM, project persistence, network, or model dependencies.
 */
(function(root, factory){
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SAudioAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  var SCHEMA_VERSION = 'audio-analysis-v0';
  var ANALYZER_VERSION = 'audio-analysis-v0';

  function finite(value){ return typeof value === 'number' && isFinite(value); }

  function dbFromLinear(value){
    var n = Number(value);
    if (!finite(n) || n <= 0) return null;
    return 20 * Math.log10(Math.max(1e-12, n));
  }

  function normalizeSource(source, durationSec){
    source = source && typeof source === 'object' ? source : {};
    return {
      clipId: source.clipId != null ? String(source.clipId) : null,
      assetId: source.assetId != null ? String(source.assetId) : null,
      durationSec: durationSec,
    };
  }

  function createResult(source, durationSec, sampleRate, channels, peakDb, rmsDb, analyzedAt){
    return {
      schemaVersion: SCHEMA_VERSION,
      analyzerVersion: ANALYZER_VERSION,
      source: normalizeSource(source, durationSec),
      technical: {
        sampleRate: sampleRate,
        channels: channels,
        peakDb: peakDb,
        rmsDb: rmsDb,
      },
      rhythm: { bpm: null, confidence: null, status: 'not_available_v0' },
      harmony: { key: null, mode: null, confidence: null, status: 'not_available_v0' },
      instruments: { status: 'not_available_v0' },
      analyzedAt: analyzedAt || new Date().toISOString(),
    };
  }

  function analyzeChannels(channels, sampleRate, options){
    options = options || {};
    if (!Array.isArray(channels) || channels.length < 1) throw new TypeError('invalid_audio_channels');
    var rate = Number(sampleRate);
    if (!finite(rate) || rate <= 0) throw new TypeError('invalid_audio_sample_rate');
    var frameCount = 0;
    for (var c = 0; c < channels.length; c++){
      var channel = channels[c];
      if (!channel || typeof channel.length !== 'number') throw new TypeError('invalid_audio_channel');
      frameCount = Math.max(frameCount, channel.length);
    }
    var sumSquares = 0;
    var sampleCount = 0;
    var peak = 0;
    for (var channelIndex = 0; channelIndex < channels.length; channelIndex++){
      var data = channels[channelIndex];
      for (var sampleIndex = 0; sampleIndex < data.length; sampleIndex++){
        var value = Number(data[sampleIndex]);
        if (!finite(value)) continue;
        var abs = Math.abs(value);
        if (abs > peak) peak = abs;
        sumSquares += value * value;
        sampleCount += 1;
      }
    }
    var durationSec = frameCount / rate;
    var rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
    return createResult(
      options.source,
      durationSec,
      rate,
      channels.length,
      dbFromLinear(peak),
      dbFromLinear(rms),
      options.analyzedAt
    );
  }

  function analyzeAudioBuffer(audioBuffer, options){
    options = options || {};
    if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') throw new TypeError('invalid_audio_buffer');
    var channels = Number(audioBuffer.numberOfChannels);
    var sampleRate = Number(audioBuffer.sampleRate);
    if (!finite(channels) || channels < 1 || Math.floor(channels) !== channels) throw new TypeError('invalid_audio_channel_count');
    var data = [];
    for (var i = 0; i < channels; i++) data.push(audioBuffer.getChannelData(i));
    var result = analyzeChannels(data, sampleRate, options);
    if (finite(Number(audioBuffer.duration)) && Number(audioBuffer.duration) >= 0){
      result.source.durationSec = Number(audioBuffer.duration);
    }
    return result;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    ANALYZER_VERSION: ANALYZER_VERSION,
    dbFromLinear: dbFromLinear,
    analyzeChannels: analyzeChannels,
    analyzeAudioBuffer: analyzeAudioBuffer,
  };
});
