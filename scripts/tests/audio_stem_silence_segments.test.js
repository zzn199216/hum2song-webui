#!/usr/bin/env node
'use strict';

const assert = require('assert');
const segmenter = require('../../static/pianoroll/core/audio_stem_silence_segments.js');

function bufferFromMono(samples, sampleRate = 100) {
  const data = Float32Array.from(samples);
  return {
    numberOfChannels: 1,
    sampleRate,
    length: data.length,
    duration: data.length / sampleRate,
    getChannelData: () => data,
  };
}

function seconds(value, sampleRate = 100) {
  return new Array(Math.round(value * sampleRate)).fill(0);
}

function tone(value, duration, sampleRate = 100) {
  return new Array(Math.round(duration * sampleRate)).fill(value);
}

(function keepsShortPausesInsideOneClip() {
  const buffer = bufferFromMono([
    ...tone(0.2, 1),
    ...seconds(1),
    ...tone(0.2, 1),
  ]);
  const ranges = segmenter.findAudibleRanges(buffer);
  assert.strictEqual(ranges.length, 1);
  assert.strictEqual(segmenter.coversWholeBuffer(ranges, buffer), true);
})();

(function removesOnlyLongInternalSilence() {
  const buffer = bufferFromMono([
    ...tone(0.2, 1),
    ...seconds(2.5),
    ...tone(0.2, 1),
  ]);
  const ranges = segmenter.findAudibleRanges(buffer);
  assert.strictEqual(ranges.length, 2);
  assert(ranges[0].endSec > 1 && ranges[0].endSec < 1.3);
  assert(ranges[1].startSec > 3.2 && ranges[1].startSec < 3.5);
  assert.strictEqual(ranges[1].startSec, ranges[1].startSample / buffer.sampleRate);
})();

(function trimsLongBoundarySilenceButKeepsShortBoundarySilence() {
  const longBoundary = bufferFromMono([
    ...seconds(2),
    ...tone(0.2, 1),
    ...seconds(2),
  ]);
  const trimmed = segmenter.findAudibleRanges(longBoundary);
  assert.strictEqual(trimmed.length, 1);
  assert(trimmed[0].startSec > 1.7);
  assert(trimmed[0].endSec < 3.3);

  const shortBoundary = bufferFromMono([
    ...seconds(1),
    ...tone(0.2, 1),
    ...seconds(1),
  ]);
  const kept = segmenter.findAudibleRanges(shortBoundary);
  assert.strictEqual(segmenter.coversWholeBuffer(kept, shortBoundary), true);
})();

(function ignoresLowLevelStemLeakageInLongBlankAreas() {
  const buffer = bufferFromMono([
    ...tone(0.15, 1),
    ...tone(0.0001, 2),
    ...tone(0.15, 1),
  ]);
  assert.strictEqual(segmenter.findAudibleRanges(buffer).length, 2);
})();

(function reportsFullySilentStemsAndEncodesExactRanges() {
  const silent = bufferFromMono(seconds(3));
  assert.deepStrictEqual(segmenter.findAudibleRanges(silent), []);

  const buffer = bufferFromMono([...tone(0.25, 1), ...tone(-0.25, 1)]);
  const wav = segmenter.encodeWavSegment(buffer, 0.5, 1.5);
  assert(wav instanceof Blob);
  assert.strictEqual(wav.type, 'audio/wav');
  assert.strictEqual(wav.size, 44 + 100 * 2);
})();

(function groupsOnlyTrulyNearIdenticalAudibleRanges() {
  const first = Array.from({ length: 100 }, (_, index) => Math.sin(index / 7) * 0.2);
  const nearCopy = first.map((value) => value * 0.9995);
  const changedVolume = first.map((value) => value * 0.99);
  const changedContent = Array.from({ length: 100 }, (_, index) => Math.cos(index / 5) * 0.2);
  const buffer = bufferFromMono([
    ...first,
    ...seconds(2),
    ...nearCopy,
    ...seconds(2),
    ...changedVolume,
    ...seconds(2),
    ...changedContent,
  ]);
  const ranges = segmenter.findAudibleRanges(buffer, { paddingSec: 0 });
  const groups = segmenter.groupNearDuplicateRanges(buffer, ranges);
  assert.strictEqual(groups.length, 4);
  assert.strictEqual(groups[0].canonicalRangeIndex, 0);
  assert.strictEqual(groups[1].canonicalRangeIndex, 0, '99.95% amplitude copy reuses the first range');
  assert.strictEqual(groups[2].canonicalRangeIndex, 0, 'different loudness of the same waveform remains one Clip');
  assert(Math.abs(groups[2].relativeGainDb - (20 * Math.log10(0.99))) < 0.001, 'relative loudness is preserved as instance gain');
  assert.strictEqual(groups[3].canonicalRangeIndex, 3, 'different waveform stays independent');
})();

(function ignoresUnevenSilencePaddingWhenComparingWaveformShape() {
  const shape = Array.from({ length: 160 }, (_, index) => Math.sin(index / 8) * 0.3);
  const buffer = bufferFromMono([
    ...seconds(0.2), ...shape, ...seconds(0.3),
    ...seconds(2),
    ...seconds(0.5), ...shape.map((value) => value * 0.5), ...seconds(0.1),
  ]);
  const ranges = segmenter.findAudibleRanges(buffer, { paddingSec: 0.6 });
  const groups = segmenter.groupNearDuplicateRanges(buffer, ranges);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[1].canonicalRangeIndex, 0, 'uneven crop padding does not split the same waveform into two Clips');
  assert(Math.abs(groups[1].relativeGainDb - (20 * Math.log10(0.5))) < 0.05);
})();

console.log('audio_stem_silence_segments.test.js: all passed');
