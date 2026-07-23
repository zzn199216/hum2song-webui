(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.H2SGmDrumKit = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  var VERSION = 'gm_drum_kit_v1';
  var PRESET_PREFIX = 'drum';

  var KICK_PRESETS = {
    'drum:kick:electronic': {
      midi: 36,
      outputDb: -2,
      outputGain: 0.8,
      maxDuration: 0.4,
      options: {
        pitchDecay: 0.03, octaves: 7,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.06 },
      },
    },
    'drum:kick:deep': {
      midi: 32,
      outputDb: -2,
      outputGain: 0.8,
      maxDuration: 0.65,
      options: {
        pitchDecay: 0.06, octaves: 5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.58, sustain: 0.01, release: 0.18 },
      },
    },
    'drum:kick:dance': {
      midi: 36,
      outputDb: -1,
      outputGain: 0.9,
      maxDuration: 0.35,
      options: {
        pitchDecay: 0.015, octaves: 8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.04 },
      },
    },
    'drum:kick:sub': {
      midi: 24,
      outputDb: -3,
      outputGain: 0.7,
      maxDuration: 0.9,
      options: {
        pitchDecay: 0.09, octaves: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.002, decay: 0.78, sustain: 0.02, release: 0.28 },
      },
    },
  };

  var GM_GROUPS = {
    kick: [35, 36],
    sideStick: [37],
    snare: [38, 39, 40],
    tom: [41, 43, 45, 47, 48, 50],
    hihatClosed: [42, 44],
    hihatOpen: [46],
    cymbal: [49, 51, 52, 53, 55, 57, 59],
    percussion: [54, 56, 58, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81],
  };

  var GROUP_BY_NOTE = {};
  Object.keys(GM_GROUPS).forEach(function(group){
    GM_GROUPS[group].forEach(function(note){ GROUP_BY_NOTE[note] = group; });
  });

  function normalizePresetId(value){
    var id = String(value || 'drum').trim().toLowerCase();
    return id === 'drums' ? 'drum' : id;
  }

  function isDrumPresetId(value){
    var id = normalizePresetId(value);
    return id === PRESET_PREFIX || id.indexOf(PRESET_PREFIX + ':') === 0;
  }

  function classifyMidiNote(value){
    var note = Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
    return GROUP_BY_NOTE[note] || 'percussion';
  }

  function forcedGroupForPreset(value){
    switch (normalizePresetId(value)){
      case 'drum:kick': return 'kick';
      case 'drum:kick:electronic': return 'kick';
      case 'drum:kick:deep': return 'kick';
      case 'drum:kick:dance': return 'kick';
      case 'drum:kick:sub': return 'kick';
      case 'drum:snare': return 'snare';
      case 'drum:hihat': return 'hihatClosed';
      case 'drum:toms': return 'tom';
      case 'drum:cymbals': return 'cymbal';
      default: return null;
    }
  }

  function midiFromTriggerArg(Tone, value){
    try{
      if (value && typeof value.toMidi === 'function') return Math.round(value.toMidi());
      if (typeof value === 'number' && isFinite(value)){
        if (value >= 0 && value <= 127 && Math.floor(value) === value) return value;
        return Math.round(69 + 12 * Math.log(value / 440) / Math.log(2));
      }
      if (Tone && typeof Tone.Frequency === 'function'){
        var frequency = Tone.Frequency(value);
        if (frequency && typeof frequency.toMidi === 'function') return Math.round(frequency.toMidi());
      }
    }catch(e){}
    return 36;
  }

  function connectVoice(voice, output, voices){
    if (!voice) return null;
    try{ if (voice.connect) voice.connect(output); }catch(e){}
    voices.push(voice);
    return voice;
  }

  function createToneDrumKit(Tone, presetId){
    if (!Tone) throw new Error('Tone.js is required');
    var normalizedPreset = normalizePresetId(presetId);
    var electronic = normalizedPreset === 'drum:electronic';
    var kickPreset = KICK_PRESETS[normalizedPreset] || null;
    var outputDb = kickPreset ? kickPreset.outputDb : (electronic ? -3 : -1);
    var outputGain = kickPreset ? kickPreset.outputGain : (electronic ? 0.7 : 0.9);
    var output = Tone.Volume ? new Tone.Volume(outputDb) : new Tone.Gain(outputGain);
    var voices = [];

    function membrane(options){
      return connectVoice(new Tone.MembraneSynth(options || {}), output, voices);
    }
    function noise(options){
      if (!Tone.NoiseSynth) return membrane();
      return connectVoice(new Tone.NoiseSynth(options || {}), output, voices);
    }
    function metal(options){
      if (!Tone.MetalSynth) return noise();
      return connectVoice(new Tone.MetalSynth(options || {}), output, voices);
    }
    function pitched(options){
      if (!Tone.Synth) return membrane();
      return connectVoice(new Tone.Synth(options || {}), output, voices);
    }

    var kick = membrane(kickPreset ? kickPreset.options : electronic ? {
      pitchDecay: 0.03, octaves: 8,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.08 },
    } : {
      pitchDecay: 0.05, octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.42, sustain: 0.01, release: 0.12 },
    });
    var tom = membrane({
      pitchDecay: electronic ? 0.025 : 0.045,
      octaves: electronic ? 4 : 3,
      oscillator: { type: electronic ? 'triangle' : 'sine' },
      envelope: { attack: 0.001, decay: electronic ? 0.2 : 0.32, sustain: 0, release: 0.08 },
    });
    var snare = noise({
      noise: { type: electronic ? 'pink' : 'white' },
      envelope: { attack: 0.001, decay: electronic ? 0.11 : 0.18, sustain: 0, release: 0.04 },
    });
    var sideStick = pitched({
      oscillator: { type: 'square' },
      envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.015 },
    });
    var hihatClosed = metal({
      frequency: electronic ? 320 : 250,
      envelope: { attack: 0.001, decay: electronic ? 0.045 : 0.07, release: 0.015 },
      harmonicity: 5.1, modulationIndex: 32, resonance: electronic ? 5200 : 4200, octaves: 1.5,
    });
    var hihatOpen = metal({
      frequency: electronic ? 300 : 230,
      envelope: { attack: 0.001, decay: electronic ? 0.32 : 0.48, release: 0.12 },
      harmonicity: 5.1, modulationIndex: 28, resonance: electronic ? 4800 : 3800, octaves: 1.5,
    });
    var cymbal = metal({
      frequency: electronic ? 220 : 180,
      envelope: { attack: 0.001, decay: electronic ? 0.55 : 0.9, release: 0.25 },
      harmonicity: 5.1, modulationIndex: 40, resonance: electronic ? 4100 : 3200, octaves: 2.5,
    });
    var percussion = metal({
      frequency: 360,
      envelope: { attack: 0.001, decay: 0.13, release: 0.04 },
      harmonicity: 3.1, modulationIndex: 12, resonance: 2600, octaves: 1,
    });

    var voiceByGroup = {
      kick: kick,
      sideStick: sideStick,
      snare: snare,
      tom: tom,
      hihatClosed: hihatClosed,
      hihatOpen: hihatOpen,
      cymbal: cymbal,
      percussion: percussion,
    };
    var forcedGroup = forcedGroupForPreset(normalizedPreset);

    function triggerAttackRelease(noteArg, duration, time, velocity){
      var midi = midiFromTriggerArg(Tone, noteArg);
      var group = forcedGroup || classifyMidiNote(midi);
      if (forcedGroup === 'hihatClosed' && classifyMidiNote(midi) === 'hihatOpen') group = 'hihatOpen';
      var voice = voiceByGroup[group] || percussion;
      var dur = Math.max(0.01, Number(duration) || 0.1);
      var vel = Math.max(0.01, Math.min(1, Number(velocity) || 0.8));
      if (!voice || typeof voice.triggerAttackRelease !== 'function') return;
      if (group === 'kick'){
        var kickMidi = kickPreset ? kickPreset.midi : 36;
        var kickMaxDuration = kickPreset ? kickPreset.maxDuration : 0.5;
        voice.triggerAttackRelease(Tone.Frequency(kickMidi, 'midi'), Math.min(dur, kickMaxDuration), time, vel);
      } else if (group === 'tom'){
        var tomMidi = forcedGroup ? 45 : Math.max(41, Math.min(50, midi));
        voice.triggerAttackRelease(Tone.Frequency(tomMidi, 'midi'), Math.min(dur, 0.45), time, vel);
      } else if (group === 'sideStick'){
        voice.triggerAttackRelease(Tone.Frequency(78, 'midi'), Math.min(dur, 0.08), time, vel * 0.7);
      } else {
        voice.triggerAttackRelease(dur, time, vel);
      }
    }

    return {
      presetId: normalizedPreset,
      triggerAttackRelease: triggerAttackRelease,
      connect: function(destination){ output.connect(destination); return this; },
      toDestination: function(){ if (output.toDestination) output.toDestination(); return this; },
      dispose: function(){
        for (var i = 0; i < voices.length; i++){
          try{ if (voices[i] && voices[i].dispose) voices[i].dispose(); }catch(e){}
        }
        try{ if (output && output.dispose) output.dispose(); }catch(e){}
      },
      get volume(){ return output.volume || null; },
      get mute(){ return !!output.mute; },
      set mute(value){ if ('mute' in output) output.mute = !!value; },
    };
  }

  return {
    VERSION: VERSION,
    GM_GROUPS: GM_GROUPS,
    classifyMidiNote: classifyMidiNote,
    createToneDrumKit: createToneDrumKit,
    forcedGroupForPreset: forcedGroupForPreset,
    isDrumPresetId: isDrumPresetId,
    normalizePresetId: normalizePresetId,
  };
});
