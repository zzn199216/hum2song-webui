const assert = require('assert');

const worker = require('../../static/pianoroll/core/audio_instrument_worker.js');

function nearlyEqual(actual, expected, epsilon, message){
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} vs ${expected}`);
}

function sine(frequency, sampleCount = 15600){
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < samples.length; i++){
    samples[i] = Math.sin(2 * Math.PI * frequency * i / worker.SAMPLE_RATE);
  }
  return samples;
}

function melBandEnergy(patch, band){
  let sum = 0;
  for (let frame = 0; frame < worker.PATCH_FRAMES; frame++) sum += patch[frame * worker.MEL_BANDS + band];
  return sum / worker.PATCH_FRAMES;
}

assert.strictEqual(worker.frequencyToBin(0), 0, 'DC should map to FFT bin 0');
nearlyEqual(worker.frequencyToBin(250), 8, 1e-12, '250 Hz FFT bin');
nearlyEqual(worker.frequencyToBin(440), 14.08, 1e-12, '440 Hz FFT bin');
nearlyEqual(worker.frequencyToBin(1000), 32, 1e-12, '1 kHz FFT bin');
nearlyEqual(worker.frequencyToBin(4000), 128, 1e-12, '4 kHz FFT bin');
nearlyEqual(worker.frequencyToBin(7000), 224, 1e-12, '7 kHz FFT bin');
nearlyEqual(worker.frequencyToBin(worker.MEL_MAX_HZ), 240, 1e-12, 'Mel upper edge FFT bin');

const bank = worker.buildMelFilterBank();
assert.strictEqual(bank.points.length, worker.MEL_BANDS + 2, 'Mel bank should expose band edges');
assert(bank.points.every((value) => Number.isFinite(value) && value >= 0 && value <= worker.SPECTRUM_BINS - 1), 'Mel edges must stay within the positive-frequency FFT bins');
for (let i = 1; i < bank.points.length; i++) assert(bank.points[i] > bank.points[i - 1], 'Mel edges must be strictly increasing');
for (let band = 0; band < worker.MEL_BANDS; band++){
  const support = [];
  for (let bin = 0; bin < worker.SPECTRUM_BINS; bin++) if (bank.weights[bin * worker.MEL_BANDS + band] > 0) support.push(bin);
  assert(support.length > 0, `Mel band ${band} should have a valid triangular support`);
  assert(support[0] >= 0 && support[support.length - 1] <= worker.SPECTRUM_BINS - 1, `Mel band ${band} support should stay within Nyquist`);
}

const sineExpectations = [
  [250, 0.60],
  [440, 0.60],
  [1000, 0.60],
  [4000, 0.60],
  [7000, 0.60],
];
for (const [frequency, maxRatio] of sineExpectations){
  const patches = worker.buildFeatures(sine(frequency));
  assert.strictEqual(patches.length, 1, `${frequency} Hz should produce one complete patch`);
  let maxBand = 0;
  let maxEnergy = -Infinity;
  for (let band = 0; band < worker.MEL_BANDS; band++){
    const energy = melBandEnergy(patches[0], band);
    if (energy > maxEnergy){ maxEnergy = energy; maxBand = band; }
  }
  const centerHz = bank.points[maxBand + 1] * worker.SAMPLE_RATE / worker.FFT_SIZE;
  assert(centerHz >= frequency * maxRatio && centerHz <= frequency / maxRatio, `${frequency} Hz energy should stay near its Mel region: ${centerHz} Hz`);
}

const deterministicInput = sine(440, 32000);
const first = worker.buildFeatures(deterministicInput)[0];
const second = worker.buildFeatures(deterministicInput)[0];
assert.deepStrictEqual(Array.from(first), Array.from(second), 'same PCM input must produce deterministic features');

const sixtySecondCandidateCount = worker.buildFeatures(new Float32Array(worker.SAMPLE_RATE * 60)).length;
const sixtySecondSelected = worker.selectPatchIndices(sixtySecondCandidateCount);
assert(sixtySecondCandidateCount > worker.MAX_PATCHES, '60-second input should exercise bounded sampling');
assert.strictEqual(sixtySecondSelected.length, worker.MAX_PATCHES, 'long input must cap selected patches');
assert.strictEqual(sixtySecondSelected[0], 0, 'bounded scan should retain the first patch');
assert.strictEqual(sixtySecondSelected[sixtySecondSelected.length - 1], sixtySecondCandidateCount - 1, 'bounded scan should retain the last patch');

console.log('yamnet_preprocessing_golden.test.js: all passed');
