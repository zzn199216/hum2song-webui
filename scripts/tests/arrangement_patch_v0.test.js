#!/usr/bin/env node
'use strict';

const path = require('path');

function assert(cond, msg){
  if (!cond) throw new Error(msg || 'assertion failed');
}

if (typeof globalThis.window === 'undefined') globalThis.window = {};

// Load core project v2 + arrangement patch module.
require(path.resolve(__dirname, '../../static/pianoroll/project.js'));
const H2SProject = globalThis.window.H2SProject;
assert(H2SProject, 'H2SProject loaded');

const Arr = require(path.resolve(__dirname, '../../static/pianoroll/core/arrangement_patch_v0.js'));
assert(Arr && typeof Arr.applyArrangementPatchV0ToProject === 'function', 'arrangement module loaded');

function makeProjectWithMelody(){
  const p2 = H2SProject.defaultProjectV2();

  const melodyScoreBeat = {
    version: 2,
    time_signature: '4/4',
    tracks: [{
      id: 'mel_t0',
      name: 'Melody',
      notes: [
        { id: 'm0', pitch: 64, velocity: 90, startBeat: 0, durationBeat: 1 },
        { id: 'm1', pitch: 67, velocity: 90, startBeat: 1, durationBeat: 1 },
      ]
    }]
  };

  const melodyClip = H2SProject.createClipFromScoreBeat(melodyScoreBeat, { id: 'clip_melody', name: 'Melody', sourceTaskId: 'test:melody' });
  p2.clips[melodyClip.id] = melodyClip;
  p2.clipOrder.push(melodyClip.id);

  const melodyInst = H2SProject.createInstanceV2(melodyClip.id, 8, p2.tracks[0].id);
  p2.instances.push(melodyInst);

  H2SProject.normalizeProjectV2(p2);
  return { p2, melodyClip, melodyInst };
}

function deepStringify(x){
  return JSON.stringify(x);
}

function assertReject(res){
  assert(res && res.ok === false, 'expected ok=false');
}

async function main(){
  // --- valid patch creates track + clip + instance ---
  {
    const { p2, melodyClip, melodyInst } = makeProjectWithMelody();
    const before = deepStringify(p2);

    const melodyScoreBefore = deepStringify(p2.clips[melodyClip.id].score);
    const melodyRevisionBefore = String(p2.clips[melodyClip.id].revisionId || '');

    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_bass_tmp', name: 'Bass', instrument: 'bass' },
        {
          op: 'createClip',
          clipId: 'clip_bass_tmp',
          name: 'Bass',
          sourceTaskId: 'arrange:test',
          scoreBeat: {
            version: 2,
            time_signature: '4/4',
            tracks: [{
              id: 'bass_t0',
              name: 'Bass Notes',
              notes: [
                { id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }
              ]
            }]
          }
        },
        {
          op: 'addInstance',
          instanceId: 'inst_bass_tmp',
          clipId: 'clip_bass_tmp',
          trackId: 'trk_bass_tmp',
          startBeat: melodyInst.startBeat,
          transpose: 0
        }
      ]
    };

    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assert(res && res.ok === true, 'valid patch should apply');
    assert(res.project, 'project returned');

    // original project unchanged
    assert(deepStringify(p2) === before, 'original project must remain unchanged');

    // melody clip unchanged
    assert(deepStringify(p2.clips[melodyClip.id].score) === melodyScoreBefore, 'melody score unchanged');
    assert(String(p2.clips[melodyClip.id].revisionId || '') === melodyRevisionBefore, 'melody revisionId unchanged');

    // generated clip exists + revision chain valid
    const out = res.project;
    const bassClip = out.clips && out.clips['clip_bass_tmp'] ? out.clips['clip_bass_tmp'] : null;
    assert(bassClip, 'bass clip created');
    assert(typeof bassClip.revisionId === 'string' && bassClip.revisionId, 'bass clip revisionId present');
    assert(bassClip.revisions && bassClip.revisions[bassClip.revisionId], 'bass clip revisions contains head');

    // flatten includes generated notes
    const flat = H2SProject.flatten(out);
    const bassFlatTrack = (flat.tracks || []).find(t => String(t.trackId) === 'trk_bass_tmp');
    assert(bassFlatTrack && Array.isArray(bassFlatTrack.notes), 'flatten has bass track');
    const bassNotes = bassFlatTrack.notes || [];
    const found = bassNotes.find(n => String(n.instanceId) === 'inst_bass_tmp' && Number(n.pitch) === 40);
    assert(!!found, 'flatten includes generated bass note');
  }

  // --- seconds fields rejected ---
  {
    const { p2 } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_bass_tmp2', name: 'Bass', instrument: 'bass' },
        {
          op: 'createClip',
          clipId: 'clip_bass_tmp2',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{
              id: 'bass_t0',
              notes: [
                { id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1, startSec: 0.01 }
              ]
            }]
          }
        },
        {
          op: 'addInstance',
          instanceId: 'inst_bass_tmp2',
          clipId: 'clip_bass_tmp2',
          trackId: 'trk_bass_tmp2',
          startBeat: 8
        }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assertReject(res);
  }

  // --- invalid notes rejected ---
  {
    const { p2 } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_bass_tmp3', name: 'Bass', instrument: 'bass' },
        {
          op: 'createClip',
          clipId: 'clip_bass_tmp3',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{
              id: 'bass_t0',
              notes: [
                // invalid pitch
                { id: 'bn0', pitch: 500, velocity: 80, startBeat: 0, durationBeat: 1 }
              ]
            }]
          }
        },
        {
          op: 'addInstance',
          instanceId: 'inst_bass_tmp3',
          clipId: 'clip_bass_tmp3',
          trackId: 'trk_bass_tmp3',
          startBeat: 8
        }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assertReject(res);
  }

  // --- dangling refs rejected ---
  {
    const { p2 } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_bass_tmp4', name: 'Bass', instrument: 'bass' },
        {
          op: 'createClip',
          clipId: 'clip_bass_tmp4',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{
              id: 'bass_t0',
              notes: [
                { id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }
              ]
            }]
          }
        },
        {
          op: 'addInstance',
          instanceId: 'inst_bass_tmp4',
          // clipId does not match created clip => dangling ref
          clipId: 'clip_missing',
          trackId: 'trk_bass_tmp4',
          startBeat: 8
        }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assertReject(res);
  }

  // --- duplicate IDs rejected ---
  {
    const { p2 } = makeProjectWithMelody();
    const existingTrackId = String(p2.tracks[0].id);
    const patch = {
      version: 1,
      ops: [
        // duplicates an existing trackId
        { op: 'createTrack', trackId: existingTrackId, name: 'Bass', instrument: 'bass' },
        {
          op: 'createClip',
          clipId: 'clip_bass_tmp5',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{
              id: 'bass_t0',
              notes: [
                { id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }
              ]
            }]
          }
        },
        {
          op: 'addInstance',
          instanceId: 'inst_bass_tmp5',
          clipId: 'clip_bass_tmp5',
          trackId: existingTrackId,
          startBeat: 8
        }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assertReject(res);
  }

  // --- unsupported ops rejected ---
  {
    const { p2 } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'deleteClip', clipId: 'x' }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assertReject(res);
  }

  // --- createTrack gainDb: valid value persisted ---
  {
    const { p2, melodyInst } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_gain_ok', name: 'Bass', instrument: 'bass', gainDb: -9 },
        {
          op: 'createClip',
          clipId: 'clip_gain_ok',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{ id: 'b0', notes: [{ id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }] }]
          }
        },
        { op: 'addInstance', instanceId: 'inst_gain_ok', clipId: 'clip_gain_ok', trackId: 'trk_gain_ok', startBeat: melodyInst.startBeat }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assert(res && res.ok === true, 'gainDb -9 should apply');
    const tr = res.project.tracks.find(t => t && String(t.id) === 'trk_gain_ok');
    assert(tr && tr.gainDb === -9, 'gainDb persisted');
  }

  // --- createTrack gainDb omitted defaults to 0 ---
  {
    const { p2, melodyInst } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_gain_omit', name: 'Bass', instrument: 'bass' },
        {
          op: 'createClip',
          clipId: 'clip_gain_omit',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{ id: 'b0', notes: [{ id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }] }]
          }
        },
        { op: 'addInstance', instanceId: 'inst_gain_omit', clipId: 'clip_gain_omit', trackId: 'trk_gain_omit', startBeat: melodyInst.startBeat }
      ]
    };
    const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
    assert(res && res.ok === true, 'omit gainDb should apply');
    const tr = res.project.tracks.find(t => t && String(t.id) === 'trk_gain_omit');
    assert(tr && tr.gainDb === 0, 'gainDb defaults to 0');
  }

  // --- createTrack gainDb below -30 rejected ---
  {
    const { p2, melodyInst } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_bad_low', name: 'Bass', instrument: 'bass', gainDb: -30.01 },
        {
          op: 'createClip',
          clipId: 'clip_bad_low',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{ id: 'b0', notes: [{ id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }] }]
          }
        },
        { op: 'addInstance', instanceId: 'inst_bad_low', clipId: 'clip_bad_low', trackId: 'trk_bad_low', startBeat: melodyInst.startBeat }
      ]
    };
    assertReject(Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject }));
  }

  // --- createTrack gainDb above 6 rejected ---
  {
    const { p2, melodyInst } = makeProjectWithMelody();
    const patch = {
      version: 1,
      ops: [
        { op: 'createTrack', trackId: 'trk_bad_hi', name: 'Bass', instrument: 'bass', gainDb: 6.01 },
        {
          op: 'createClip',
          clipId: 'clip_bad_hi',
          name: 'Bass',
          scoreBeat: {
            version: 2,
            tracks: [{ id: 'b0', notes: [{ id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }] }]
          }
        },
        { op: 'addInstance', instanceId: 'inst_bad_hi', clipId: 'clip_bad_hi', trackId: 'trk_bad_hi', startBeat: melodyInst.startBeat }
      ]
    };
    assertReject(Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject }));
  }

  // --- createTrack gainDb NaN / non-number rejected ---
  {
    const { p2, melodyInst } = makeProjectWithMelody();
    const mkPatch = function(gainVal){
      return {
        version: 1,
        ops: [
          { op: 'createTrack', trackId: 'trk_bad_nan', name: 'Bass', instrument: 'bass', gainDb: gainVal },
          {
            op: 'createClip',
            clipId: 'clip_bad_nan',
            name: 'Bass',
            scoreBeat: {
              version: 2,
              tracks: [{ id: 'b0', notes: [{ id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }] }]
            }
          },
          { op: 'addInstance', instanceId: 'inst_bad_nan', clipId: 'clip_bad_nan', trackId: 'trk_bad_nan', startBeat: melodyInst.startBeat }
        ]
      };
    };
    assertReject(Arr.applyArrangementPatchV0ToProject(p2, mkPatch(NaN), { H2SProject }));
    assertReject(Arr.applyArrangementPatchV0ToProject(p2, mkPatch(Number.POSITIVE_INFINITY), { H2SProject }));
    assertReject(Arr.applyArrangementPatchV0ToProject(p2, mkPatch('quiet'), { H2SProject }));
  }

  // --- boundary -30 and 6 accepted ---
  {
    const { p2, melodyInst } = makeProjectWithMelody();
    for (const pair of [['trk_bmin', -30], ['trk_bmax', 6]]){
      const tid = pair[0];
      const g = pair[1];
      const patch = {
        version: 1,
        ops: [
          { op: 'createTrack', trackId: tid, name: 'T', instrument: 'bass', gainDb: g },
          {
            op: 'createClip',
            clipId: 'clip_' + tid,
            name: 'C',
            scoreBeat: {
              version: 2,
              tracks: [{ id: 'b0', notes: [{ id: 'bn0', pitch: 40, velocity: 80, startBeat: 0, durationBeat: 1 }] }]
            }
          },
          { op: 'addInstance', instanceId: 'inst_' + tid, clipId: 'clip_' + tid, trackId: tid, startBeat: melodyInst.startBeat }
        ]
      };
      const res = Arr.applyArrangementPatchV0ToProject(p2, patch, { H2SProject });
      assert(res && res.ok === true, 'boundary gainDb ' + g);
      const tr = res.project.tracks.find(t => t && String(t.id) === tid);
      assert(tr && tr.gainDb === g, 'boundary persisted');
    }
  }

  console.log('PASS arrangement_patch_v0.test.js');
}

main().catch(function(e){
  console.error(e);
  process.exit(1);
});

