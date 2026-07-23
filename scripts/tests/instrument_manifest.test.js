#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const manifest = require(path.join(root, 'static/pianoroll/core/instrument_manifest.js'));
global.window = global;
require(path.join(root, 'static/pianoroll/project.js'));

const builtIns = manifest.getBuiltInInstrumentManifest();
assert(Array.isArray(builtIns), 'manifest should export an array of built-in instruments');
assert(builtIns.length >= 7, 'manifest should include synth and sampled built-ins');
assert.strictEqual(manifest.VERSION, 'instrument_manifest_v1', 'registry should expose v1 metadata');

const legacyKeys = builtIns.map((item) => item.legacyKey);
for (const key of [
  'default',
  'bass',
  'lead',
  'pad',
  'pluck',
  'drum',
  'drum:electronic',
  'drum:kick',
  'drum:kick:electronic',
  'drum:kick:deep',
  'drum:kick:dance',
  'drum:kick:sub',
  'drum:snare',
  'drum:hihat',
  'drum:toms',
  'drum:cymbals',
  'sampler:tonejs:piano',
  'sampler:tonejs:strings',
  'sampler:tonejs:violin',
  'sampler:tonejs:guitar-acoustic',
  'sampler:tonejs:guitar-electric',
  'sampler:tonejs:guitar-nylon',
  'sampler:tonejs:cello',
  'sampler:tonejs:contrabass',
  'sampler:tonejs:flute',
  'sampler:tonejs:clarinet',
  'sampler:tonejs:trumpet',
  'sampler:tonejs:french-horn',
  'sampler:tonejs:trombone',
  'sampler:tonejs:saxophone',
  'sampler:tonejs:xylophone',
]) {
  assert(legacyKeys.includes(key), `manifest should include legacy key ${key}`);
}

assert.strictEqual(manifest.resolveInstrument('default').id, 'builtin.piano');
assert.strictEqual(manifest.resolveInstrument('bass').engineType, 'builtin_synth');
assert.strictEqual(manifest.resolveInstrument('drum').engineType, 'drum');
assert.strictEqual(manifest.resolveInstrument('drum:electronic').presetId, 'drum:electronic');
assert.strictEqual(manifest.resolveInstrument('drum:kick').engineType, 'drum');
assert.strictEqual(manifest.resolveInstrument('drum:kick:electronic').source, 'opensource');
assert.strictEqual(manifest.resolveInstrument('drum:kick:deep').engineType, 'drum');
assert.strictEqual(manifest.resolveInstrument('drum:kick:dance').engineType, 'drum');
assert.strictEqual(manifest.resolveInstrument('drum:kick:sub').engineType, 'drum');
assert.strictEqual(manifest.resolveInstrument('sampler:tonejs:piano').engineType, 'sampler');
assert.strictEqual(manifest.resolveInstrument('piano').samplerPackId, 'tonejs:piano', 'old piano alias should resolve to sampled piano metadata');
assert.strictEqual(manifest.resolveInstrument('violin').samplerPackId, 'tonejs:violin', 'old violin alias should resolve to sampled violin metadata');
assert.strictEqual(manifest.resolveInstrument('flute').samplerPackId, 'tonejs:flute', 'flute alias should resolve to sampled flute metadata');
assert.strictEqual(manifest.resolveInstrument('sax').samplerPackId, 'tonejs:saxophone', 'sax alias should resolve to sampled saxophone metadata');
assert.strictEqual(manifest.getInstrumentById('opensource.tonejs.violin').legacyKey, 'sampler:tonejs:violin');
assert.strictEqual(manifest.getInstrumentByLegacyKey('tonejs:guitar-electric').legacyKey, 'sampler:tonejs:guitar-electric');
assert.strictEqual(manifest.getInstrumentByLegacyKey('tonejs:french-horn').legacyKey, 'sampler:tonejs:french-horn');

const missing = manifest.resolveInstrument('legacy:missing');
assert.strictEqual(missing.missing, true, 'unknown instruments should return a missing fallback');
assert.strictEqual(missing.legacyKey, 'legacy:missing');
assert.doesNotThrow(() => manifest.resolveInstrument(null));

const options = manifest.getSelectableInstrumentOptions();
assert(options.some((option) => option.value === 'default'), 'dropdown options should keep legacy stored values');
assert(options.some((option) => option.value === 'sampler:tonejs:piano'), 'dropdown options should include sampled piano');
assert(options.some((option) => option.value === 'sampler:tonejs:strings'), 'dropdown options should include sampled strings');
assert(options.some((option) => option.value === 'sampler:tonejs:violin'), 'dropdown options should include sampled violin');
assert(options.some((option) => option.value === 'sampler:tonejs:guitar-acoustic'), 'dropdown options should include sampled acoustic guitar');
assert(options.some((option) => option.value === 'sampler:tonejs:guitar-electric'), 'dropdown options should include sampled electric guitar');
assert(options.some((option) => option.value === 'sampler:tonejs:guitar-nylon'), 'dropdown options should include nylon guitar');
assert(options.some((option) => option.value === 'sampler:tonejs:flute'), 'dropdown options should include flute');
assert(options.some((option) => option.value === 'sampler:tonejs:trumpet'), 'dropdown options should include trumpet');
assert(options.some((option) => option.value === 'sampler:tonejs:xylophone'), 'dropdown options should include xylophone');
for (const drumKey of [
  'drum',
  'drum:electronic',
  'drum:kick',
  'drum:kick:electronic',
  'drum:kick:deep',
  'drum:kick:dance',
  'drum:kick:sub',
  'drum:snare',
  'drum:hihat',
  'drum:toms',
  'drum:cymbals',
]) {
  assert(options.some((option) => option.value === drumKey), `dropdown options should include ${drumKey}`);
}
assert(!options.some((option) => option.value === 'builtin.piano'), 'tracks should keep storing legacy keys, not manifest ids');
assert(options.filter((option) => option.engine === 'tone_sampler').every((option) => option.samplerPackId), 'sampler options should expose samplerPackId');
assert(options.some((option) => option.license === 'CC-BY-3.0'), 'open-source samplers should expose license metadata');

const pianoSearch = manifest.searchInstruments('gangqin');
assert(pianoSearch.some((item) => item.legacyKey === 'sampler:tonejs:piano' || item.legacyKey === 'default'), 'search should match aliases');
const guitarSearch = manifest.searchInstruments('electric guitar');
assert(guitarSearch.some((item) => item.legacyKey === 'sampler:tonejs:guitar-electric'), 'search should match tags/aliases');
const brassSearch = manifest.searchInstruments('brass');
assert(brassSearch.some((item) => item.legacyKey === 'sampler:tonejs:trumpet'), 'search should match brass tags');
const groups = manifest.getInstrumentCategoryGroups();
assert(groups.some((group) => group.category === 'strings' && group.instruments.some((item) => item.legacyKey === 'sampler:tonejs:violin')), 'groups should include strings sampled violin');
assert(groups.some((group) => group.category === 'woodwinds' && group.instruments.some((item) => item.legacyKey === 'sampler:tonejs:flute')), 'groups should include woodwinds flute');
assert(groups.some((group) => group.category === 'brass' && group.instruments.some((item) => item.legacyKey === 'sampler:tonejs:trumpet')), 'groups should include brass trumpet');
assert(groups.some((group) => group.category === 'percussion' && group.instruments.some((item) => item.legacyKey === 'sampler:tonejs:xylophone')), 'groups should include percussion xylophone');

const timelineController = fs.readFileSync(path.join(root, 'static/pianoroll/timeline_controller.js'), 'utf8');
assert(timelineController.includes('H2SInstrumentManifest'), 'timeline dropdown should use the manifest when available');
assert(timelineController.includes('getSelectableInstrumentOptions'), 'timeline dropdown should derive built-ins from manifest');
assert(timelineController.includes('instrument.missing'), 'timeline dropdown should show unknown stored instruments safely');
assert(timelineController.includes('trackInstrumentSearch'), 'timeline instrument picker should include search input');
assert(timelineController.includes('<optgroup'), 'timeline instrument picker should render category groups');
assert(timelineController.includes('trackInstrumentTrigger'), 'timeline track header should render a compact instrument trigger');
assert(timelineController.includes('trackInstrumentPopover'), 'timeline instrument picker should render in a body-level popover');
assert(timelineController.includes("zIndex = '11500'"), 'timeline instrument popover should sit above timeline clips');
assert(timelineController.includes("textOverflow = 'ellipsis'"), 'compact instrument trigger should ellipsize long instrument names');

const indexHtml = fs.readFileSync(path.join(root, 'static/pianoroll/index.html'), 'utf8');
const manifestScriptIndex = indexHtml.indexOf('core/instrument_manifest.js');
const timelineScriptIndex = indexHtml.indexOf('timeline_controller.js');
const instrumentCacheBust = 'kick-presets-v1';
assert(manifestScriptIndex >= 0, 'index should load the instrument manifest');
assert(timelineScriptIndex >= 0, 'index should load the timeline controller');
assert(manifestScriptIndex < timelineScriptIndex, 'manifest should load before timeline controller');
assert(indexHtml.includes(`project.js?v=${instrumentCacheBust}`), 'index should cache-bust project sampler metadata');
assert(indexHtml.includes(`controllers/instrument_library_store.js?v=${instrumentCacheBust}`), 'index should cache-bust instrument library store');
assert(indexHtml.includes(`core/instrument_manifest.js?v=${instrumentCacheBust}`), 'index should cache-bust instrument manifest');
assert(indexHtml.includes(`timeline_controller.js?v=${instrumentCacheBust}`), 'index should cache-bust timeline picker UI');
assert(indexHtml.includes('id="btnCreditsEntry"'), 'index should include a Studio credits entry');
assert(indexHtml.includes('id="creditsPanel"'), 'index should include a Studio credits panel');
assert(indexHtml.includes('tonejs-instruments'), 'credits panel should attribute tonejs-instruments samples');

const en = JSON.parse(fs.readFileSync(path.join(root, 'static/i18n/locales/en.json'), 'utf8'));
const zh = JSON.parse(fs.readFileSync(path.join(root, 'static/i18n/locales/zh.json'), 'utf8'));
for (const key of [
  'instrument.name.piano',
  'instrument.name.bass',
  'instrument.name.lead',
  'instrument.name.pad',
  'instrument.name.pluck',
  'instrument.name.drums',
  'instrument.name.drumsElectronic',
  'instrument.name.drumKick',
  'instrument.name.drumKickElectronic',
  'instrument.name.drumKickDeep',
  'instrument.name.drumKickDance',
  'instrument.name.drumKickSub',
  'instrument.name.drumSnare',
  'instrument.name.drumHihat',
  'instrument.name.drumToms',
  'instrument.name.drumCymbals',
  'instrument.name.sampledPiano',
  'instrument.name.sampledStrings',
  'instrument.name.sampledViolin',
  'instrument.name.sampledGuitarAcoustic',
  'instrument.name.sampledGuitarElectric',
  'instrument.name.sampledGuitarNylon',
  'instrument.name.sampledCello',
  'instrument.name.sampledContrabass',
  'instrument.name.sampledFlute',
  'instrument.name.sampledClarinet',
  'instrument.name.sampledTrumpet',
  'instrument.name.sampledFrenchHorn',
  'instrument.name.sampledTrombone',
  'instrument.name.sampledSaxophone',
  'instrument.name.sampledXylophone',
  'instrument.category.keyboard',
  'instrument.category.bass',
  'instrument.category.synth',
  'instrument.category.drums',
  'instrument.category.strings',
  'instrument.category.guitar',
  'instrument.category.woodwinds',
  'instrument.category.brass',
  'instrument.category.percussion',
  'instrument.category.sampled',
  'instrument.search.placeholder',
  'instrument.search.empty',
  'instrument.missing',
  'credits.entry',
  'credits.title',
  'credits.tonejsBody',
]) {
  assert(en[key], `English locale should include ${key}`);
  assert(zh[key], `Chinese locale should include ${key}`);
}

const projectJs = fs.readFileSync(path.join(root, 'static/pianoroll/project.js'), 'utf8');
assert(projectJs.includes("DEFAULT_INSTRUMENT: 'default'"), 'default stored instrument should remain legacy default');
assert(projectJs.includes("'tonejs:violin'"), 'project sampler packs should include registry violin pack');
assert(projectJs.includes("'tonejs:guitar-nylon'"), 'project sampler packs should include nylon guitar pack');
assert(projectJs.includes('registry.resolveInstrument'), 'project normalizeInstrument should consult registry resolve layer');

const samplerPacks = global.H2SProject && global.H2SProject.SAMPLER_PACKS;
assert(samplerPacks && typeof samplerPacks === 'object', 'project should expose SAMPLER_PACKS for tests');
for (const [packId, pack] of Object.entries(samplerPacks)) {
  assert(pack && pack.baseUrlDefault && pack.urls, `sampler pack ${packId} should expose baseUrlDefault and urls`);
  const baseDir = path.join(root, pack.baseUrlDefault.replace(/^\/static\/pianoroll\//, 'static/pianoroll/'));
  for (const [note, filename] of Object.entries(pack.urls)) {
    const filePath = path.join(baseDir, filename);
    assert(fs.existsSync(filePath), `sampler pack ${packId} note ${note} missing file ${filePath}`);
  }
}

const audioController = fs.readFileSync(path.join(root, 'static/pianoroll/controllers/audio_controller.js'), 'utf8');
const exportController = fs.readFileSync(path.join(root, 'static/pianoroll/controllers/export_wav_controller.js'), 'utf8');
for (const key of ["case 'bass'", "case 'lead'", "case 'pad'", "case 'pluck'"]) {
  assert(audioController.includes(key), `audio synth mapping should still include ${key}`);
  assert(exportController.includes(key), `export synth mapping should still include ${key}`);
}
assert(audioController.includes('H2SGmDrumKit.createToneDrumKit'), 'live playback should use the GM drum engine');
assert(exportController.includes('H2SGmDrumKit.createToneDrumKit'), 'WAV export should use the GM drum engine');
assert(indexHtml.includes(`core/gm_drum_kit.js?v=${instrumentCacheBust}`), 'index should load and cache-bust GM drum engine');

console.log('instrument manifest tests passed');
