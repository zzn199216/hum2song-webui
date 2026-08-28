/* Pure helpers for removing long silent spans from separated audio stems. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SAudioStemSilenceSegments = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULT_WINDOW_SEC = 0.05;
  var DEFAULT_MIN_SILENCE_SEC = 1.5;
  var DEFAULT_PADDING_SEC = 0.12;
  var DEFAULT_PEAK_THRESHOLD_DB = -48;
  var DEFAULT_RMS_THRESHOLD_DB = -60;
  var DEFAULT_MAX_RANGES = 64;
  var DEFAULT_DUPLICATE_SIMILARITY = 0.999;
  var DEFAULT_FINGERPRINT_SAMPLES = 4096;

  function finite(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function dbFromLinear(value) {
    return value > 0 ? 20 * Math.log10(value) : -Infinity;
  }

  function optionNumber(options, key, fallback, minimum) {
    var value = Number(options && options[key]);
    return finite(value) && value >= minimum ? value : fallback;
  }

  function mergeToRangeLimit(ranges, maxRanges) {
    var out = ranges.slice();
    while (out.length > maxRanges) {
      var closestIndex = 0;
      var closestGap = Infinity;
      for (var index = 0; index < out.length - 1; index += 1) {
        var gap = out[index + 1].startSample - out[index].endSample;
        if (gap < closestGap) {
          closestGap = gap;
          closestIndex = index;
        }
      }
      out.splice(closestIndex, 2, {
        startSample: out[closestIndex].startSample,
        endSample: out[closestIndex + 1].endSample,
      });
    }
    return out;
  }

  function findAudibleRanges(audioBuffer, options) {
    options = options || {};
    if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') throw new TypeError('invalid_audio_buffer');
    var sampleRate = Number(audioBuffer.sampleRate);
    var channelCount = Number(audioBuffer.numberOfChannels);
    var totalSamples = Number(audioBuffer.length);
    if (!finite(sampleRate) || sampleRate <= 0) throw new TypeError('invalid_audio_sample_rate');
    if (!finite(channelCount) || channelCount < 1) throw new TypeError('invalid_audio_channel_count');
    if (!finite(totalSamples) || totalSamples < 0) throw new TypeError('invalid_audio_length');
    totalSamples = Math.floor(totalSamples);
    if (totalSamples === 0) return [];

    var windowSec = optionNumber(options, 'windowSec', DEFAULT_WINDOW_SEC, 0.01);
    var minSilenceSec = optionNumber(options, 'minSilenceSec', DEFAULT_MIN_SILENCE_SEC, windowSec);
    var paddingSec = optionNumber(options, 'paddingSec', DEFAULT_PADDING_SEC, 0);
    var peakThresholdDb = optionNumber(options, 'peakThresholdDb', DEFAULT_PEAK_THRESHOLD_DB, -200);
    var rmsThresholdDb = optionNumber(options, 'rmsThresholdDb', DEFAULT_RMS_THRESHOLD_DB, -200);
    var maxRanges = Math.max(1, Math.floor(optionNumber(options, 'maxRanges', DEFAULT_MAX_RANGES, 1)));
    var windowSamples = Math.max(1, Math.round(windowSec * sampleRate));
    var minSilenceSamples = Math.max(windowSamples, Math.round(minSilenceSec * sampleRate));
    var paddingSamples = Math.max(0, Math.round(paddingSec * sampleRate));
    var sampleStep = Math.max(1, Math.floor(sampleRate / 8000));
    var channels = [];
    for (var channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      channels.push(audioBuffer.getChannelData(channelIndex));
    }
    var activeWindows = [];
    for (var start = 0; start < totalSamples; start += windowSamples) {
      var end = Math.min(totalSamples, start + windowSamples);
      var peak = 0;
      var sumSquares = 0;
      var sampleCount = 0;
      for (var channel = 0; channel < channels.length; channel += 1) {
        var data = channels[channel];
        for (var sample = start; sample < end; sample += sampleStep) {
          var value = Number(data[sample]) || 0;
          var absolute = Math.abs(value);
          if (absolute > peak) peak = absolute;
          sumSquares += value * value;
          sampleCount += 1;
        }
      }
      var rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
      if (dbFromLinear(peak) > peakThresholdDb || dbFromLinear(rms) > rmsThresholdDb) {
        activeWindows.push({ startSample: start, endSample: end });
      }
    }
    if (activeWindows.length === 0) return [];

    var merged = [activeWindows[0]];
    for (var activeIndex = 1; activeIndex < activeWindows.length; activeIndex += 1) {
      var current = merged[merged.length - 1];
      var next = activeWindows[activeIndex];
      if (next.startSample - current.endSample < minSilenceSamples) {
        current.endSample = next.endSample;
      } else {
        merged.push({ startSample: next.startSample, endSample: next.endSample });
      }
    }
    merged = mergeToRangeLimit(merged, maxRanges);

    for (var rangeIndex = 0; rangeIndex < merged.length; rangeIndex += 1) {
      var range = merged[rangeIndex];
      var leadingSilence = range.startSample;
      var trailingSilence = totalSamples - range.endSample;
      range.startSample = leadingSilence < minSilenceSamples ? 0 : Math.max(0, range.startSample - paddingSamples);
      range.endSample = trailingSilence < minSilenceSamples ? totalSamples : Math.min(totalSamples, range.endSample + paddingSamples);
      range.startSec = range.startSample / sampleRate;
      range.endSec = range.endSample / sampleRate;
      range.durationSec = (range.endSample - range.startSample) / sampleRate;
    }
    return merged;
  }

  function coversWholeBuffer(ranges, audioBuffer) {
    if (!Array.isArray(ranges) || ranges.length !== 1 || !audioBuffer) return false;
    return ranges[0].startSample === 0 && ranges[0].endSample === Number(audioBuffer.length);
  }

  function fingerprintRange(audioBuffer, range, options) {
    options = options || {};
    if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function' || !range) return null;
    var sampleRate = Number(audioBuffer.sampleRate);
    var channelCount = Math.max(1, Math.floor(Number(audioBuffer.numberOfChannels) || 0));
    var totalSamples = Math.max(0, Math.floor(Number(audioBuffer.length) || 0));
    var startSample = Math.max(0, Math.floor(Number(range.startSample) || 0));
    var endSample = Math.min(totalSamples, Math.ceil(Number(range.endSample) || 0));
    if (!finite(sampleRate) || sampleRate <= 0 || endSample <= startSample) return null;
    var fingerprintSamples = Math.max(256, Math.floor(optionNumber(
      options,
      'fingerprintSamples',
      DEFAULT_FINGERPRINT_SAMPLES,
      256
    )));
    var channels = [];
    for (var channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      channels.push(audioBuffer.getChannelData(channelIndex));
    }
    // Fingerprint the audible waveform itself, not uneven silence padding left by segmentation.
    var edgeScanStep = Math.max(1, Math.floor(sampleRate / 12000));
    var peak = 0;
    for (var peakSample = startSample; peakSample < endSample; peakSample += edgeScanStep) {
      for (var peakChannel = 0; peakChannel < channelCount; peakChannel += 1) {
        peak = Math.max(peak, Math.abs(Number(channels[peakChannel][peakSample]) || 0));
      }
    }
    var edgeThreshold = Math.max(0.00001, peak * 0.001);
    var audibleStart = startSample;
    var audibleEnd = endSample;
    var foundStart = false;
    for (var edgeSample = startSample; edgeSample < endSample && !foundStart; edgeSample += edgeScanStep) {
      for (var edgeChannel = 0; edgeChannel < channelCount; edgeChannel += 1) {
        if (Math.abs(Number(channels[edgeChannel][edgeSample]) || 0) >= edgeThreshold) {
          audibleStart = edgeSample;
          foundStart = true;
          break;
        }
      }
    }
    var foundEnd = false;
    for (var reverseSample = endSample - 1; reverseSample >= audibleStart && !foundEnd; reverseSample -= edgeScanStep) {
      for (var reverseChannel = 0; reverseChannel < channelCount; reverseChannel += 1) {
        if (Math.abs(Number(channels[reverseChannel][reverseSample]) || 0) >= edgeThreshold) {
          audibleEnd = Math.min(endSample, reverseSample + edgeScanStep);
          foundEnd = true;
          break;
        }
      }
    }
    if (audibleEnd > audibleStart) {
      startSample = audibleStart;
      endSample = audibleEnd;
    }
    var values = new Float32Array(fingerprintSamples * channelCount);
    var sourceLength = endSample - startSample;
    var mean = 0;
    var valueCount = 0;
    for (var sampleIndex = 0; sampleIndex < fingerprintSamples; sampleIndex += 1) {
      var sourcePosition = startSample + ((sampleIndex + 0.5) * sourceLength / fingerprintSamples) - 0.5;
      var left = Math.max(startSample, Math.min(endSample - 1, Math.floor(sourcePosition)));
      var right = Math.max(startSample, Math.min(endSample - 1, left + 1));
      var mix = Math.max(0, Math.min(1, sourcePosition - left));
      for (var channel = 0; channel < channelCount; channel += 1) {
        var data = channels[channel];
        var value = (Number(data[left]) || 0) * (1 - mix) + (Number(data[right]) || 0) * mix;
        var outputIndex = sampleIndex * channelCount + channel;
        values[outputIndex] = value;
        mean += value;
        valueCount += 1;
      }
    }
    mean = valueCount > 0 ? mean / valueCount : 0;
    var sumSquares = 0;
    for (var index = 0; index < values.length; index += 1) {
      values[index] -= mean;
      sumSquares += values[index] * values[index];
    }
    var rms = values.length > 0 ? Math.sqrt(sumSquares / values.length) : 0;
    if (!(rms > 0)) return null;
    for (var normalizedIndex = 0; normalizedIndex < values.length; normalizedIndex += 1) {
      values[normalizedIndex] /= rms;
    }
    return {
      values: values,
      rms: rms,
      durationSec: sourceLength / sampleRate,
      channelCount: channelCount,
    };
  }

  function compareFingerprints(left, right) {
    if (!left || !right || left.channelCount !== right.channelCount || left.values.length !== right.values.length) return 0;
    var dot = 0;
    var leftPower = 0;
    var rightPower = 0;
    for (var index = 0; index < left.values.length; index += 1) {
      var leftValue = left.values[index];
      var rightValue = right.values[index];
      dot += leftValue * rightValue;
      leftPower += leftValue * leftValue;
      rightPower += rightValue * rightValue;
    }
    var waveformSimilarity = leftPower > 0 && rightPower > 0
      ? dot / Math.sqrt(leftPower * rightPower)
      : 0;
    return Math.max(0, Math.min(1, waveformSimilarity));
  }

  function groupNearDuplicateRanges(audioBuffer, ranges, options) {
    options = options || {};
    if (!Array.isArray(ranges)) return [];
    var threshold = optionNumber(options, 'duplicateSimilarity', DEFAULT_DUPLICATE_SIMILARITY, 0);
    threshold = Math.max(0, Math.min(1, threshold));
    var fingerprints = [];
    var groups = [];
    for (var index = 0; index < ranges.length; index += 1) {
      var fingerprint = fingerprintRange(audioBuffer, ranges[index], options);
      fingerprints.push(fingerprint);
      var canonicalRangeIndex = index;
      var similarity = 1;
      var relativeGainDb = 0;
      for (var candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
        if (groups[candidateIndex].canonicalRangeIndex !== candidateIndex) continue;
        var candidateSimilarity = compareFingerprints(fingerprint, fingerprints[candidateIndex]);
        if (candidateSimilarity >= threshold) {
          canonicalRangeIndex = candidateIndex;
          similarity = candidateSimilarity;
          relativeGainDb = fingerprint && fingerprints[candidateIndex] && fingerprints[candidateIndex].rms > 0
            ? 20 * Math.log10(fingerprint.rms / fingerprints[candidateIndex].rms)
            : 0;
          break;
        }
      }
      groups.push({
        rangeIndex: index,
        canonicalRangeIndex: canonicalRangeIndex,
        similarity: similarity,
        relativeGainDb: finite(relativeGainDb) ? relativeGainDb : 0,
      });
    }
    return groups;
  }

  function encodeWavSegment(audioBuffer, startSec, endSec) {
    if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function') return null;
    var sampleRate = Number(audioBuffer.sampleRate);
    var channelCount = Number(audioBuffer.numberOfChannels);
    var startSample = Math.max(0, Math.floor(Number(startSec || 0) * sampleRate));
    var endSample = Math.min(Number(audioBuffer.length), Math.ceil(Number(endSec) * sampleRate));
    if (!finite(sampleRate) || sampleRate <= 0 || !finite(channelCount) || channelCount < 1 || endSample <= startSample) return null;
    var frameCount = endSample - startSample;
    var blockAlign = channelCount * 2;
    var dataSize = frameCount * blockAlign;
    var arrayBuffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(arrayBuffer);
    function writeString(offset, value) {
      for (var index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    var offset = 44;
    for (var frame = startSample; frame < endSample; frame += 1) {
      for (var channel = 0; channel < channelCount; channel += 1) {
        var sample = Number(audioBuffer.getChannelData(channel)[frame]) || 0;
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  return {
    DEFAULT_WINDOW_SEC: DEFAULT_WINDOW_SEC,
    DEFAULT_MIN_SILENCE_SEC: DEFAULT_MIN_SILENCE_SEC,
    DEFAULT_PADDING_SEC: DEFAULT_PADDING_SEC,
    DEFAULT_PEAK_THRESHOLD_DB: DEFAULT_PEAK_THRESHOLD_DB,
    DEFAULT_RMS_THRESHOLD_DB: DEFAULT_RMS_THRESHOLD_DB,
    DEFAULT_MAX_RANGES: DEFAULT_MAX_RANGES,
    DEFAULT_DUPLICATE_SIMILARITY: DEFAULT_DUPLICATE_SIMILARITY,
    DEFAULT_FINGERPRINT_SAMPLES: DEFAULT_FINGERPRINT_SAMPLES,
    findAudibleRanges: findAudibleRanges,
    coversWholeBuffer: coversWholeBuffer,
    fingerprintRange: fingerprintRange,
    compareFingerprints: compareFingerprints,
    groupNearDuplicateRanges: groupNearDuplicateRanges,
    encodeWavSegment: encodeWavSegment,
  };
});
