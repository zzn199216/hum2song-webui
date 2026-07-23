(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.H2SInstrumentManifest = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  var VERSION = 'instrument_manifest_v1';
  var TONEJS_SOURCE_URL = 'https://github.com/nbrosowsky/tonejs-instruments';
  var TONEJS_SAMPLE_LICENSE = 'CC-BY-3.0';
  var TONEJS_ATTRIBUTION = 'tonejs-instruments samples by Nathan Brosowsky and contributors';
  var TONE_SOURCE_URL = 'https://github.com/Tonejs/Tone.js';

  var CATEGORY_ORDER = ['keyboard', 'bass', 'synth', 'pluck', 'drums', 'strings', 'guitar', 'woodwinds', 'brass', 'percussion', 'sampled', 'other'];

  var INSTRUMENTS = [
    {
      id: 'builtin.piano',
      legacyKey: 'default',
      legacyAliases: ['builtin.piano'],
      displayName: 'Piano',
      kind: 'tone_synth',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'builtin_synth',
      presetId: 'default',
      category: 'keyboard',
      tags: ['piano', 'keyboard', 'synth'],
      aliases: ['default piano', 'built in piano', 'gangqin', '钢琴'],
      i18nNameKey: 'instrument.name.piano',
      i18nDescriptionKey: 'instrument.description.piano',
      license: 'Hum2Song built-in synth',
      attribution: 'Hum2Song Studio Tone.js synth preset',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.bass',
      legacyKey: 'bass',
      displayName: 'Bass',
      kind: 'tone_synth',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'builtin_synth',
      presetId: 'bass',
      category: 'bass',
      tags: ['bass', 'low', 'synth'],
      aliases: ['synth bass', 'di yin', '贝斯', '低音'],
      i18nNameKey: 'instrument.name.bass',
      i18nDescriptionKey: 'instrument.description.bass',
      license: 'Hum2Song built-in synth',
      attribution: 'Hum2Song Studio Tone.js synth preset',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.lead',
      legacyKey: 'lead',
      displayName: 'Lead',
      kind: 'tone_synth',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'builtin_synth',
      presetId: 'lead',
      category: 'synth',
      tags: ['lead', 'synth', 'melody'],
      aliases: ['synth lead', 'main lead', '主音'],
      i18nNameKey: 'instrument.name.lead',
      i18nDescriptionKey: 'instrument.description.lead',
      license: 'Hum2Song built-in synth',
      attribution: 'Hum2Song Studio Tone.js synth preset',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.pad',
      legacyKey: 'pad',
      displayName: 'Pad',
      kind: 'tone_synth',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'builtin_synth',
      presetId: 'pad',
      category: 'synth',
      tags: ['pad', 'synth', 'ambient', 'harmony'],
      aliases: ['synth pad', 'atmosphere', '氛围垫'],
      i18nNameKey: 'instrument.name.pad',
      i18nDescriptionKey: 'instrument.description.pad',
      license: 'Hum2Song built-in synth',
      attribution: 'Hum2Song Studio Tone.js synth preset',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.pluck',
      legacyKey: 'pluck',
      displayName: 'Pluck',
      kind: 'tone_synth',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'builtin_synth',
      presetId: 'pluck',
      category: 'pluck',
      tags: ['pluck', 'synth', 'short', 'arp'],
      aliases: ['plucked synth', '拨弦'],
      i18nNameKey: 'instrument.name.pluck',
      i18nDescriptionKey: 'instrument.description.pluck',
      license: 'Hum2Song built-in synth',
      attribution: 'Hum2Song Studio Tone.js synth preset',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums',
      legacyKey: 'drum',
      legacyAliases: ['drums'],
      displayName: 'Acoustic Drum Kit',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum',
      category: 'drums',
      tags: ['drums', 'beat', 'percussion', 'acoustic', 'gm'],
      aliases: ['drum kit', 'acoustic drums', 'percussion', '鼓组', '原声鼓组', '打击乐'],
      i18nNameKey: 'instrument.name.drums',
      i18nDescriptionKey: 'instrument.description.drums',
      license: 'Hum2Song built-in synth',
      attribution: 'Hum2Song Studio GM drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums.electronic',
      legacyKey: 'drum:electronic',
      displayName: 'Electronic Drum Kit',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:electronic',
      category: 'drums',
      tags: ['drums', 'electronic', 'beat', 'gm'],
      aliases: ['electronic drums', 'drum machine', '电子鼓组', '电子鼓'],
      i18nNameKey: 'instrument.name.drumsElectronic',
      i18nDescriptionKey: 'instrument.description.drumsElectronic',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio GM drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums.kick',
      legacyKey: 'drum:kick',
      displayName: 'Kick Drum',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:kick',
      category: 'drums',
      tags: ['drums', 'kick', 'bass drum'],
      aliases: ['bass drum', 'kick', '底鼓', '大鼓'],
      i18nNameKey: 'instrument.name.drumKick',
      i18nDescriptionKey: 'instrument.description.drumKick',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.electronic_kick',
      legacyKey: 'drum:kick:electronic',
      displayName: 'Electronic Kick',
      kind: 'drum',
      source: 'opensource',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:kick:electronic',
      category: 'drums',
      tags: ['drums', 'kick', 'electronic', 'tight'],
      aliases: ['electronic bass drum', 'electro kick', '电子底鼓'],
      i18nNameKey: 'instrument.name.drumKickElectronic',
      i18nDescriptionKey: 'instrument.description.drumKickElectronic',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio kick synthesis powered by Tone.js',
      sourceUrl: TONE_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.deep_kick',
      legacyKey: 'drum:kick:deep',
      displayName: 'Deep Kick',
      kind: 'drum',
      source: 'opensource',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:kick:deep',
      category: 'drums',
      tags: ['drums', 'kick', 'deep', 'low'],
      aliases: ['deep bass drum', 'low kick', '深沉底鼓'],
      i18nNameKey: 'instrument.name.drumKickDeep',
      i18nDescriptionKey: 'instrument.description.drumKickDeep',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio kick synthesis powered by Tone.js',
      sourceUrl: TONE_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.dance_kick',
      legacyKey: 'drum:kick:dance',
      displayName: 'Dance Kick',
      kind: 'drum',
      source: 'opensource',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:kick:dance',
      category: 'drums',
      tags: ['drums', 'kick', 'dance', 'punchy'],
      aliases: ['dance bass drum', 'club kick', '舞曲底鼓'],
      i18nNameKey: 'instrument.name.drumKickDance',
      i18nDescriptionKey: 'instrument.description.drumKickDance',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio kick synthesis powered by Tone.js',
      sourceUrl: TONE_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.sub_kick',
      legacyKey: 'drum:kick:sub',
      displayName: 'Sub Kick',
      kind: 'drum',
      source: 'opensource',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:kick:sub',
      category: 'drums',
      tags: ['drums', 'kick', 'sub', 'sub-bass'],
      aliases: ['sub bass drum', 'sub-bass kick', '超低音底鼓'],
      i18nNameKey: 'instrument.name.drumKickSub',
      i18nDescriptionKey: 'instrument.description.drumKickSub',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio kick synthesis powered by Tone.js',
      sourceUrl: TONE_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums.snare',
      legacyKey: 'drum:snare',
      displayName: 'Snare Drum',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:snare',
      category: 'drums',
      tags: ['drums', 'snare', 'clap', 'side stick'],
      aliases: ['snare', 'clap', '军鼓', '小鼓', '拍手'],
      i18nNameKey: 'instrument.name.drumSnare',
      i18nDescriptionKey: 'instrument.description.drumSnare',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums.hihat',
      legacyKey: 'drum:hihat',
      displayName: 'Hi-Hat',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:hihat',
      category: 'drums',
      tags: ['drums', 'hi-hat', 'closed', 'open'],
      aliases: ['hihat', 'closed hat', 'open hat', '踩镲', '开镲', '闭镲'],
      i18nNameKey: 'instrument.name.drumHihat',
      i18nDescriptionKey: 'instrument.description.drumHihat',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums.toms',
      legacyKey: 'drum:toms',
      displayName: 'Toms',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:toms',
      category: 'drums',
      tags: ['drums', 'toms', 'floor tom'],
      aliases: ['tom tom', 'floor tom', '通鼓', '桶鼓', '落地通鼓'],
      i18nNameKey: 'instrument.name.drumToms',
      i18nDescriptionKey: 'instrument.description.drumToms',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'builtin.drums.cymbals',
      legacyKey: 'drum:cymbals',
      displayName: 'Cymbals',
      kind: 'drum',
      source: 'builtin',
      engine: 'tone_synth',
      engineType: 'drum',
      presetId: 'drum:cymbals',
      category: 'drums',
      tags: ['drums', 'cymbals', 'crash', 'ride'],
      aliases: ['crash cymbal', 'ride cymbal', '镲片', '吊镲', '叮叮镲'],
      i18nNameKey: 'instrument.name.drumCymbals',
      i18nDescriptionKey: 'instrument.description.drumCymbals',
      license: 'MIT (Tone.js engine)',
      attribution: 'Hum2Song Studio drum synthesis powered by Tone.js',
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.piano',
      legacyKey: 'sampler:tonejs:piano',
      legacyAliases: ['piano', 'sampler:piano', 'tonejs:piano'],
      displayName: 'Sampled Piano',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:piano',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/piano/',
      category: 'keyboard',
      tags: ['sampled', 'piano', 'keyboard', 'acoustic'],
      aliases: ['grand piano', 'acoustic piano', 'gangqin', '钢琴'],
      i18nNameKey: 'instrument.name.sampledPiano',
      i18nDescriptionKey: 'instrument.description.sampledPiano',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.strings',
      legacyKey: 'sampler:tonejs:strings',
      legacyAliases: ['strings', 'sampler:strings', 'tonejs:strings'],
      displayName: 'Sampled Strings',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:strings',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/violin/',
      category: 'strings',
      tags: ['sampled', 'strings', 'violin', 'orchestral', 'sustain'],
      aliases: ['string ensemble', '弦乐', 'xianyue'],
      i18nNameKey: 'instrument.name.sampledStrings',
      i18nDescriptionKey: 'instrument.description.sampledStrings',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.violin',
      legacyKey: 'sampler:tonejs:violin',
      legacyAliases: ['violin', 'sampler:violin', 'tonejs:violin'],
      displayName: 'Sampled Violin',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:violin',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/violin/',
      category: 'strings',
      tags: ['sampled', 'strings', 'violin', 'solo', 'orchestral'],
      aliases: ['solo violin', 'xiao ti qin', '小提琴'],
      i18nNameKey: 'instrument.name.sampledViolin',
      i18nDescriptionKey: 'instrument.description.sampledViolin',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.bass',
      legacyKey: 'sampler:tonejs:bass',
      legacyAliases: ['bass-electric', 'electric-bass', 'sampler:bass', 'tonejs:bass'],
      displayName: 'Sampled Bass',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:bass',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/bass-electric/',
      category: 'bass',
      tags: ['sampled', 'bass', 'electric', 'low'],
      aliases: ['electric bass', 'sampled electric bass', '电贝斯', '贝斯'],
      i18nNameKey: 'instrument.name.sampledBass',
      i18nDescriptionKey: 'instrument.description.sampledBass',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.guitar_acoustic',
      legacyKey: 'sampler:tonejs:guitar-acoustic',
      legacyAliases: ['guitar-acoustic', 'acoustic-guitar', 'sampler:guitar-acoustic', 'tonejs:guitar-acoustic'],
      displayName: 'Sampled Acoustic Guitar',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:guitar-acoustic',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/guitar-acoustic/',
      category: 'guitar',
      tags: ['sampled', 'guitar', 'acoustic', 'pluck'],
      aliases: ['acoustic guitar', 'steel guitar', '原声吉他', '木吉他'],
      i18nNameKey: 'instrument.name.sampledGuitarAcoustic',
      i18nDescriptionKey: 'instrument.description.sampledGuitarAcoustic',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.guitar_electric',
      legacyKey: 'sampler:tonejs:guitar-electric',
      legacyAliases: ['guitar-electric', 'electric-guitar', 'sampler:guitar-electric', 'tonejs:guitar-electric'],
      displayName: 'Sampled Electric Guitar',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:guitar-electric',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/guitar-electric/',
      category: 'guitar',
      tags: ['sampled', 'guitar', 'electric', 'rock'],
      aliases: ['electric guitar', '电吉他'],
      i18nNameKey: 'instrument.name.sampledGuitarElectric',
      i18nDescriptionKey: 'instrument.description.sampledGuitarElectric',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.guitar_nylon',
      legacyKey: 'sampler:tonejs:guitar-nylon',
      legacyAliases: ['guitar-nylon', 'nylon-guitar', 'classical-guitar', 'sampler:guitar-nylon', 'tonejs:guitar-nylon'],
      displayName: 'Nylon Guitar',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:guitar-nylon',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/guitar-nylon/',
      category: 'guitar',
      tags: ['sampled', 'guitar', 'nylon', 'classical', 'pluck'],
      aliases: ['classical guitar', 'nylon string guitar', '古典吉他', '尼龙吉他'],
      i18nNameKey: 'instrument.name.sampledGuitarNylon',
      i18nDescriptionKey: 'instrument.description.sampledGuitarNylon',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.cello',
      legacyKey: 'sampler:tonejs:cello',
      legacyAliases: ['cello', 'sampler:cello', 'tonejs:cello'],
      displayName: 'Cello',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:cello',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/cello/',
      category: 'strings',
      tags: ['sampled', 'strings', 'cello', 'orchestral'],
      aliases: ['violoncello', 'da ti qin', '大提琴'],
      i18nNameKey: 'instrument.name.sampledCello',
      i18nDescriptionKey: 'instrument.description.sampledCello',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.contrabass',
      legacyKey: 'sampler:tonejs:contrabass',
      legacyAliases: ['contrabass', 'double-bass', 'upright-bass', 'sampler:contrabass', 'tonejs:contrabass'],
      displayName: 'Contrabass',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:contrabass',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/contrabass/',
      category: 'bass',
      tags: ['sampled', 'strings', 'bass', 'contrabass', 'orchestral'],
      aliases: ['double bass', 'upright bass', 'di yin ti qin', '低音提琴'],
      i18nNameKey: 'instrument.name.sampledContrabass',
      i18nDescriptionKey: 'instrument.description.sampledContrabass',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.flute',
      legacyKey: 'sampler:tonejs:flute',
      legacyAliases: ['flute', 'sampler:flute', 'tonejs:flute'],
      displayName: 'Flute',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:flute',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/flute/',
      category: 'woodwinds',
      tags: ['sampled', 'woodwind', 'flute', 'orchestral'],
      aliases: ['concert flute', 'chang di', '长笛'],
      i18nNameKey: 'instrument.name.sampledFlute',
      i18nDescriptionKey: 'instrument.description.sampledFlute',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.clarinet',
      legacyKey: 'sampler:tonejs:clarinet',
      legacyAliases: ['clarinet', 'sampler:clarinet', 'tonejs:clarinet'],
      displayName: 'Clarinet',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:clarinet',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/clarinet/',
      category: 'woodwinds',
      tags: ['sampled', 'woodwind', 'clarinet', 'orchestral'],
      aliases: ['single reed', 'dan huang guan', '单簧管'],
      i18nNameKey: 'instrument.name.sampledClarinet',
      i18nDescriptionKey: 'instrument.description.sampledClarinet',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.trumpet',
      legacyKey: 'sampler:tonejs:trumpet',
      legacyAliases: ['trumpet', 'sampler:trumpet', 'tonejs:trumpet'],
      displayName: 'Trumpet',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:trumpet',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/trumpet/',
      category: 'brass',
      tags: ['sampled', 'brass', 'trumpet', 'orchestral'],
      aliases: ['brass trumpet', 'xiao hao', '小号'],
      i18nNameKey: 'instrument.name.sampledTrumpet',
      i18nDescriptionKey: 'instrument.description.sampledTrumpet',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.french_horn',
      legacyKey: 'sampler:tonejs:french-horn',
      legacyAliases: ['french-horn', 'horn', 'sampler:french-horn', 'tonejs:french-horn'],
      displayName: 'French Horn',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:french-horn',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/french-horn/',
      category: 'brass',
      tags: ['sampled', 'brass', 'horn', 'orchestral'],
      aliases: ['horn', 'yuan hao', '圆号'],
      i18nNameKey: 'instrument.name.sampledFrenchHorn',
      i18nDescriptionKey: 'instrument.description.sampledFrenchHorn',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.trombone',
      legacyKey: 'sampler:tonejs:trombone',
      legacyAliases: ['trombone', 'sampler:trombone', 'tonejs:trombone'],
      displayName: 'Trombone',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:trombone',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/trombone/',
      category: 'brass',
      tags: ['sampled', 'brass', 'trombone', 'orchestral'],
      aliases: ['slide trombone', 'chang hao', '长号'],
      i18nNameKey: 'instrument.name.sampledTrombone',
      i18nDescriptionKey: 'instrument.description.sampledTrombone',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.saxophone',
      legacyKey: 'sampler:tonejs:saxophone',
      legacyAliases: ['saxophone', 'sax', 'sampler:saxophone', 'tonejs:saxophone'],
      displayName: 'Saxophone',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:saxophone',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/saxophone/',
      category: 'woodwinds',
      tags: ['sampled', 'woodwind', 'saxophone', 'sax'],
      aliases: ['sax', 'sa ke si', '萨克斯'],
      i18nNameKey: 'instrument.name.sampledSaxophone',
      i18nDescriptionKey: 'instrument.description.sampledSaxophone',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
    {
      id: 'opensource.tonejs.xylophone',
      legacyKey: 'sampler:tonejs:xylophone',
      legacyAliases: ['xylophone', 'sampler:xylophone', 'tonejs:xylophone'],
      displayName: 'Xylophone',
      kind: 'sampler',
      source: 'opensource',
      engine: 'tone_sampler',
      engineType: 'sampler',
      samplerPackId: 'tonejs:xylophone',
      assetManifestUrl: '/static/pianoroll/vendor/tonejs-instruments/samples/xylophone/',
      category: 'percussion',
      tags: ['sampled', 'percussion', 'mallet', 'xylophone'],
      aliases: ['mallet', 'mu qin', '木琴'],
      i18nNameKey: 'instrument.name.sampledXylophone',
      i18nDescriptionKey: 'instrument.description.sampledXylophone',
      license: TONEJS_SAMPLE_LICENSE,
      attribution: TONEJS_ATTRIBUTION,
      sourceUrl: TONEJS_SOURCE_URL,
      selectable: true,
      enabledByDefault: true,
      selectableByDefault: true,
    },
  ];

  function uniqueStrings(arr){
    var seen = {};
    var out = [];
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++){
      var s = (typeof arr[i] === 'string') ? arr[i].trim() : '';
      if (!s) continue;
      var k = s.toLowerCase();
      if (seen[k]) continue;
      seen[k] = true;
      out.push(s);
    }
    return out;
  }

  function cloneInstrument(item){
    var out = Object.assign({}, item);
    out.tags = uniqueStrings(item.tags);
    out.aliases = uniqueStrings(item.aliases);
    out.legacyAliases = uniqueStrings(item.legacyAliases);
    return out;
  }

  function getBuiltInInstrumentManifest(){
    return INSTRUMENTS.map(cloneInstrument);
  }

  function normalizeInstrumentValue(value){
    return (typeof value === 'string' && value.trim()) ? value.trim() : 'default';
  }

  function lower(value){
    return String(value || '').trim().toLowerCase();
  }

  function matchesIdOrLegacy(item, normalized){
    if (item.id === normalized || item.legacyKey === normalized) return true;
    var lo = lower(normalized);
    var aliases = item.legacyAliases || [];
    for (var i = 0; i < aliases.length; i++){
      if (lower(aliases[i]) === lo) return true;
    }
    return false;
  }

  function getInstrumentById(id){
    var normalized = normalizeInstrumentValue(id);
    for (var i = 0; i < INSTRUMENTS.length; i++){
      if (INSTRUMENTS[i].id === normalized) return cloneInstrument(INSTRUMENTS[i]);
    }
    return null;
  }

  function getInstrumentByLegacyKey(legacyKey){
    var normalized = normalizeInstrumentValue(legacyKey);
    for (var i = 0; i < INSTRUMENTS.length; i++){
      if (matchesIdOrLegacy(INSTRUMENTS[i], normalized)) return cloneInstrument(INSTRUMENTS[i]);
    }
    return null;
  }

  function resolveInstrument(value){
    var normalized = normalizeInstrumentValue(value);
    var found = getInstrumentByLegacyKey(normalized);
    if (found) return found;
    return {
      id: 'unknown',
      legacyKey: normalized,
      legacyAliases: [],
      displayName: normalized,
      kind: 'unknown',
      source: 'unknown',
      engine: 'unknown',
      engineType: 'unknown',
      category: 'unknown',
      tags: [],
      aliases: [],
      i18nNameKey: null,
      i18nDescriptionKey: null,
      license: null,
      attribution: null,
      selectable: false,
      enabledByDefault: false,
      selectableByDefault: false,
      missing: true,
    };
  }

  function categoryRank(category){
    var idx = CATEGORY_ORDER.indexOf(category);
    return idx >= 0 ? idx : CATEGORY_ORDER.length;
  }

  function getCategoryLabelKey(category){
    return 'instrument.category.' + (category || 'unknown');
  }

  function selectableList(){
    return INSTRUMENTS.filter(function(item){
      return item.enabledByDefault !== false && item.selectableByDefault !== false && item.selectable !== false;
    });
  }

  function getSelectableInstrumentOptions(){
    return selectableList()
      .map(function(item){
        return {
          value: item.legacyKey,
          label: item.displayName,
          labelKey: item.i18nNameKey,
          manifestId: item.id,
          category: item.category,
          categoryLabelKey: getCategoryLabelKey(item.category),
          kind: item.kind,
          source: item.source,
          engine: item.engine,
          engineType: item.engineType,
          samplerPackId: item.samplerPackId || null,
          tags: uniqueStrings(item.tags),
          aliases: uniqueStrings(item.aliases),
          license: item.license || null,
          attribution: item.attribution || null,
        };
      });
  }

  function buildSearchText(item){
    return uniqueStrings([
      item.id,
      item.legacyKey,
      item.displayName,
      item.category,
      item.kind,
      item.source,
      item.engine,
      item.samplerPackId,
    ].concat(item.tags || [], item.aliases || [], item.legacyAliases || []))
      .join(' ')
      .toLowerCase();
  }

  function searchInstruments(query, options){
    var opts = options || {};
    var q = lower(query);
    var list = opts.includeUnselectable ? INSTRUMENTS.slice() : selectableList();
    if (opts.category && opts.category !== 'all'){
      list = list.filter(function(item){ return item.category === opts.category; });
    }
    if (q){
      list = list.filter(function(item){ return buildSearchText(item).indexOf(q) >= 0; });
    }
    list.sort(function(a, b){
      var cr = categoryRank(a.category) - categoryRank(b.category);
      if (cr) return cr;
      return String(a.displayName || a.legacyKey).localeCompare(String(b.displayName || b.legacyKey));
    });
    return list.map(cloneInstrument);
  }

  function getInstrumentCategoryGroups(options){
    var list = searchInstruments(options && options.query, options || {});
    var groups = [];
    var byCat = {};
    for (var i = 0; i < list.length; i++){
      var item = list[i];
      var cat = item.category || 'other';
      if (!byCat[cat]){
        byCat[cat] = { category: cat, labelKey: getCategoryLabelKey(cat), instruments: [] };
        groups.push(byCat[cat]);
      }
      byCat[cat].instruments.push(item);
    }
    groups.sort(function(a, b){ return categoryRank(a.category) - categoryRank(b.category); });
    return groups;
  }

  function isKnownBuiltInInstrument(value){
    return !resolveInstrument(value).missing;
  }

  return {
    VERSION: VERSION,
    CATEGORY_ORDER: CATEGORY_ORDER.slice(),
    getBuiltInInstrumentManifest: getBuiltInInstrumentManifest,
    getCategoryLabelKey: getCategoryLabelKey,
    getInstrumentById: getInstrumentById,
    getInstrumentByLegacyKey: getInstrumentByLegacyKey,
    getInstrumentCategoryGroups: getInstrumentCategoryGroups,
    getSelectableInstrumentOptions: getSelectableInstrumentOptions,
    isKnownBuiltInInstrument: isKnownBuiltInInstrument,
    resolveInstrument: resolveInstrument,
    searchInstruments: searchInstruments,
  };
});
