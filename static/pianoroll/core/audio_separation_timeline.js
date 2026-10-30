/* Pure planning helpers for AI audio stem materialization. */
(function () {
  'use strict';

  var AUDIO_ROLES = {
    vocals: 'stem_vocals_audio',
    drums: 'stem_drums_audio',
    bass: 'stem_bass_audio',
    other: 'stem_other_audio',
    instrumental: 'stem_instrumental_audio',
  };
  var SCORE_ROLES = {
    vocals: 'stem_vocals_score',
    drums: 'stem_drums_score',
    bass: 'stem_bass_score',
    other: 'stem_other_score',
  };

  function timelineItems(manifest) {
    manifest = manifest || {};
    if (manifest.schemaVersion === 'h2s-multistem/v1') {
      return (manifest.stems || []).filter(function (s) { return s.presence === 'candidate'; }).map(function (s) {
        return { stem: s.category, kind: 'audio', artifactId: s.audio.artifactId, stemId: s.stemId };
      });
    }
    var timeline = Array.isArray(manifest.timelineAudioStems) ? manifest.timelineAudioStems : [];
    var transcribed = {};
    (Array.isArray(manifest.transcribedStems) ? manifest.transcribedStems : []).forEach(function (stem) {
      transcribed[String(stem)] = true;
    });
    return timeline.map(function (rawStem) {
      var stem = String(rawStem);
      if (transcribed[stem] && SCORE_ROLES[stem]) {
        return { stem: stem, kind: 'midi', artifactRole: SCORE_ROLES[stem] };
      }
      return { stem: stem, kind: 'audio', artifactRole: AUDIO_ROLES[stem] || '' };
    }).filter(function (item) { return !!item.artifactRole; });
  }

  function planTrackIndices(project, sourceInstanceId, count) {
    var tracks = project && Array.isArray(project.tracks) ? project.tracks : [];
    var instances = project && Array.isArray(project.instances) ? project.instances : [];
    var source = instances.find(function (inst) { return inst && String(inst.id) === String(sourceInstanceId || ''); });
    if (!source) return { ok: false, reason: 'source_instance_not_found', trackIndices: [] };
    var sourceTrack = Math.max(0, Math.floor(Number(source.trackIndex) || 0));
    var occupied = {};
    instances.forEach(function (inst) {
      if (!inst) return;
      occupied[Math.max(0, Math.floor(Number(inst.trackIndex) || 0))] = true;
    });
    var out = [];
    for (var index = sourceTrack + 1; index < tracks.length && out.length < count; index += 1) {
      if (!occupied[index]) out.push(index);
    }
    var next = tracks.length;
    while (out.length < count) {
      out.push(next);
      next += 1;
    }
    return {
      ok: true,
      sourceTrackIndex: sourceTrack,
      sourceStartSec: Math.max(0, Number(source.startSec) || 0),
      trackIndices: out,
      requiredTrackCount: next,
    };
  }

  function findArtifact(artifacts, role) {
    return (Array.isArray(artifacts) ? artifacts : []).find(function (artifact) {
      return artifact && artifact.role === role;
    }) || null;
  }

  var api = {
    stemLabel: function (stem) {
      var fallback = { vocals: 'Vocals', instrumental: 'Instrumental', piano: 'Piano', guitar: 'Guitar', bass: 'Bass', drums: 'Drums', other: 'Other sounds' }[stem] || stem;
      return typeof window !== 'undefined' && window.I18N && window.I18N.t ? window.I18N.t('audio.stem.' + stem, fallback) : fallback;
    },
    timelineItems: timelineItems,
    planTrackIndices: planTrackIndices,
    findArtifact: findArtifact,
    AUDIO_ROLES: AUDIO_ROLES,
    SCORE_ROLES: SCORE_ROLES,
  };
  if (typeof window !== 'undefined') window.H2SAudioSeparationTimeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
