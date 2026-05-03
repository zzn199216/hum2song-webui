(function(root, factory){
  if (typeof module === 'object' && module.exports){
    module.exports = factory();
  } else {
    root.H2SArrangementQualityV0 = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function(){
  'use strict';

  var BUILTIN_TONE_SYNTH = new Set(['bass', 'drum', 'lead', 'pad', 'pluck', 'default']);

  function isFiniteNumber(x){
    return typeof x === 'number' && isFinite(x);
  }

  function defaultOpts(userOpts){
    var o = (userOpts && typeof userOpts === 'object') ? userOpts : {};
    return {
      coverageMinRatio: isFiniteNumber(o.coverageMinRatio) ? Number(o.coverageMinRatio) : 0.72,
      coverageMinSpanBeats: isFiniteNumber(o.coverageMinSpanBeats) ? Number(o.coverageMinSpanBeats) : 6,
      trackBalanceMinRatio: isFiniteNumber(o.trackBalanceMinRatio) ? Number(o.trackBalanceMinRatio) : 0.62,
      loudAvgVelocityWarn: isFiniteNumber(o.loudAvgVelocityWarn) ? Number(o.loudAvgVelocityWarn) : 86,
      loudGainDbWarn: isFiniteNumber(o.loudGainDbWarn) ? Number(o.loudGainDbWarn) : -3,
      loudMelodyProximity: isFiniteNumber(o.loudMelodyProximity) ? Number(o.loudMelodyProximity) : 12,
      densityMaxNotesPerBeat: isFiniteNumber(o.densityMaxNotesPerBeat) ? Number(o.densityMaxNotesPerBeat) : 12,
      sparseNoteMax: isFiniteNumber(o.sparseNoteMax) ? Number(o.sparseNoteMax) : 2,
      sparseMinSpanBeats: isFiniteNumber(o.sparseMinSpanBeats) ? Number(o.sparseMinSpanBeats) : 16,
    };
  }

  function normalizeInstrumentViaApi(projectApi, raw){
    if (projectApi && typeof projectApi.normalizeInstrument === 'function'){
      try { return projectApi.normalizeInstrument(raw); } catch (_) {}
    }
    if (typeof raw === 'string' && raw.trim()){
      var s = raw.trim();
      if (s.indexOf('sampler:') === 0) return { kind: 'sampler', packId: s.slice(8).trim() };
      if (s.indexOf('oneshot:') === 0) return { kind: 'oneshot', packId: s.slice(8).trim() };
      return { kind: 'tone_synth', presetId: s };
    }
    return { kind: 'tone_synth', presetId: 'default', params: {} };
  }

  function isLikelyResolvableInstrument(instr, projectApi){
    if (instr == null || typeof instr !== 'string' || !instr.trim()) return false;
    var t = instr.trim();
    var low = t.toLowerCase();
    var desc = normalizeInstrumentViaApi(projectApi, t);
    if (!desc || typeof desc !== 'object') desc = {};

    if (desc.kind === 'oneshot'){
      var op = desc.packId || '';
      return typeof op === 'string' && op.indexOf('user:') === 0 && op.length > 5;
    }
    if (desc.kind === 'sampler'){
      var pk2 = String(desc.packId || '');
      if (pk2.indexOf('user:') === 0) return true;
      var packs2 = (projectApi && projectApi.SAMPLER_PACKS) ? projectApi.SAMPLER_PACKS : null;
      if (packs2 && packs2[pk2]) return true;
      return false;
    }
    if (desc.kind === 'tone_synth'){
      var pre = String(desc.presetId || low || 'default').toLowerCase();
      return BUILTIN_TONE_SYNTH.has(pre);
    }
    return false;
  }

  function accumulateClipStats(scoreBeat){
    var endBeat = 0;
    var minStart = null;
    var maxVelSum = 0;
    var maxVelCt = 0;
    var maxVelPeak = 0;
    var n = 0;
    var trs = (scoreBeat && Array.isArray(scoreBeat.tracks)) ? scoreBeat.tracks : [];
    for (var ti = 0; ti < trs.length; ti++){
      var tr = trs[ti];
      var notes = (tr && Array.isArray(tr.notes)) ? tr.notes : [];
      for (var ni = 0; ni < notes.length; ni++){
        var nt = notes[ni];
        if (!nt) continue;
        var sb = Number(nt.startBeat);
        var db = Number(nt.durationBeat);
        var vel = Number(nt.velocity);
        if (!isFiniteNumber(sb)) sb = 0;
        if (!isFiniteNumber(db) || db <= 0) continue;
        if (!isFiniteNumber(vel) || vel < 1) vel = 1;
        var ed = sb + db;
        if (ed > endBeat) endBeat = ed;
        if (minStart == null || sb < minStart) minStart = sb;
        maxVelSum += vel;
        maxVelCt++;
        if (vel > maxVelPeak) maxVelPeak = vel;
      }
      n += notes.length;
    }
    return {
      noteCount: n,
      endBeat: endBeat,
      minStart: (minStart == null) ? 0 : minStart,
      avgVelocity: maxVelCt ? (maxVelSum / maxVelCt) : 0,
      maxVelocity: maxVelPeak,
      activeSpan: Math.max(0, endBeat - (minStart == null ? 0 : minStart)),
    };
  }

  function simulateCreatedTrackState(ops){
    var gainByTrack = {}; // tid -> gainDb number (omit => not set)
    var created = new Set();
    var instruments = {};
    var list = Array.isArray(ops) ? ops : [];
    for (var i = 0; i < list.length; i++){
      var op = list[i];
      if (!op || typeof op !== 'object') continue;
      var kind = String(op.op || '');
      if (kind === 'createTrack'){
        var ctid = String(op.trackId || '');
        created.add(ctid);
        instruments[ctid] = String(op.instrument || '').trim();
        if (Object.prototype.hasOwnProperty.call(op, 'gainDb') && isFiniteNumber(Number(op.gainDb))){
          gainByTrack[ctid] = Number(op.gainDb);
        } else {
          gainByTrack[ctid] = 0;
        }
      }
      if (kind === 'setTrackInstrument'){
        var stid = String(op.trackId || '');
        if (created.has(stid)) instruments[stid] = String(op.instrument || '').trim();
      }
    }
    return { created: created, gainByTrack: gainByTrack, instruments: instruments };
  }

  /** @param {*} projectV2 unused for v0 (reserved) */
  function analyzeArrangementQualityV0(projectV2, patch, context, opts){
    var cfg = defaultOpts(opts);
    var warnings = [];
    var metrics = { clips: [], tracks: {}, targetSpanBeat: 0 };
    var projectApi = (opts && opts.H2SProject) ? opts.H2SProject : null;

    if (!patch || typeof patch !== 'object'){
      warnings.push({ code: 'invalid_patch_json', severity: 'warn' });
      return { ok: true, warnings: warnings, metrics: metrics };
    }

    var ctx = (context && typeof context === 'object') ? context : {};
    var targetSpan = isFiniteNumber(Number(ctx.selectedClipSpanBeat)) ? Number(ctx.selectedClipSpanBeat) : 0;
    metrics.targetSpanBeat = targetSpan;
    var melodyMaxVel = isFiniteNumber(Number(ctx.melodyMaxVelocity)) ? Number(ctx.melodyMaxVelocity) : null;

    var ops = Array.isArray(patch.ops) ? patch.ops : [];
    var sim = simulateCreatedTrackState(ops);

    var clipById = {};
    var orphanedCreateClips = new Set();
    for (var oi = 0; oi < ops.length; oi++){
      var op = ops[oi];
      if (!op || typeof op !== 'object') continue;
      if (String(op.op) !== 'createClip') continue;
      var cid = String(op.clipId || '');
      clipById[cid] = { clipId: cid, scoreBeat: op.scoreBeat };
      orphanedCreateClips.add(cid);
    }

    var instByClipForCreated = []; // instances whose clip created in patch AND track created in patch?
    var instList = [];
    for (var oj = 0; oj < ops.length; oj++){
      var opi = ops[oj];
      if (!opi || String(opi.op) !== 'addInstance') continue;
      instList.push({ clipId: String(opi.clipId || ''), trackId: String(opi.trackId || '') });
    }
    for (var ii = 0; ii < instList.length; ii++){
      var ins = instList[ii];
      if (clipById[ins.clipId]) orphanedCreateClips.delete(ins.clipId);
      if (clipById[ins.clipId] && sim.created.has(ins.trackId)) instByClipForCreated.push(ins);
    }

    orphanedCreateClips.forEach(function(oid){
      warnings.push({
        code: 'orphan_clip',
        severity: 'warn',
        clipId: oid,
      });
      var oo = clipById[oid];
      if (oo && oo.scoreBeat){
        metrics.clips.push({ clipId: oid, orphan: true, stats: accumulateClipStats(oo.scoreBeat) });
      }
    });

    var accompanimentEndByTrackId = {}; // tid -> max endBeat clip-local among linked clips

    for (var ci = 0; ci < instByClipForCreated.length; ci++){
      var ain = instByClipForCreated[ci];
      var ent = clipById[ain.clipId];
      if (!ent || !ent.scoreBeat) continue;
      var st = accumulateClipStats(ent.scoreBeat);
      metrics.clips.push({
        clipId: ain.clipId,
        trackId: ain.trackId,
        stats: st,
      });
      var denom = Math.max(1e-6, targetSpan, st.endBeat);
      metrics.tracks[ain.trackId] = metrics.tracks[ain.trackId] || {
        velocities: [], clipIds: [],
        gainDb: Object.prototype.hasOwnProperty.call(sim.gainByTrack, ain.trackId) ? sim.gainByTrack[ain.trackId] : 0,
      };
      if (metrics.tracks[ain.trackId].gainDb === undefined){
        metrics.tracks[ain.trackId].gainDb = 0;
      }

      var notesArr = [];
      var trkx = (ent.scoreBeat && Array.isArray(ent.scoreBeat.tracks)) ? ent.scoreBeat.tracks : [];
      for (var tx = 0; tx < trkx.length; tx++){
        var nn = trkx[tx] && Array.isArray(trkx[tx].notes) ? trkx[tx].notes : [];
        notesArr = notesArr.concat(nn || []);
      }
      for (var vi = 0; vi < notesArr.length; vi++){
        var nv = notesArr[vi];
        if (!nv || !isFiniteNumber(Number(nv.velocity))) continue;
        metrics.tracks[ain.trackId].velocities.push(Number(nv.velocity));
      }
      metrics.tracks[ain.trackId].clipIds.push(ain.clipId);

      if (st.noteCount === 0){
        warnings.push({ code: 'empty_clip', severity: 'warn', clipId: ain.clipId, trackId: ain.trackId });
      } else {
        if (targetSpan >= cfg.coverageMinSpanBeats && targetSpan > 0 && cfg.coverageMinRatio > 0){
          var cov = st.endBeat / targetSpan;
          if (cov < cfg.coverageMinRatio){
            warnings.push({
              code: 'short_coverage',
              severity: 'warn',
              clipId: ain.clipId,
              trackId: ain.trackId,
              coverageRatio: Math.round(cov * 1000) / 1000,
              endBeat: st.endBeat,
              targetSpanBeat: targetSpan,
            });
          }
        }

        var effectiveSpanForDensity = denom;
        var nPerBeat = st.noteCount / effectiveSpanForDensity;
        metrics.clips[metrics.clips.length - 1].notesPerBeat = Math.round(nPerBeat * 1000) / 1000;
        if (cfg.densityMaxNotesPerBeat > 0 && nPerBeat > cfg.densityMaxNotesPerBeat){
          warnings.push({
            code: 'overly_dense',
            severity: 'warn',
            clipId: ain.clipId,
            trackId: ain.trackId,
            notesPerBeat: Math.round(nPerBeat * 1000) / 1000,
            noteCount: st.noteCount,
          });
        }

        if (
          targetSpan >= cfg.sparseMinSpanBeats &&
          st.noteCount <= cfg.sparseNoteMax
        ){
          warnings.push({
            code: 'sparse_notes',
            severity: 'warn',
            clipId: ain.clipId,
            trackId: ain.trackId,
            noteCount: st.noteCount,
            targetSpanBeat: targetSpan,
          });
        }
      }

      if (!accompanimentEndByTrackId[ain.trackId] || st.endBeat > accompanimentEndByTrackId[ain.trackId]){
        accompanimentEndByTrackId[ain.trackId] = st.endBeat;
      }
    }

    var trackIdsMeasured = Object.keys(accompanimentEndByTrackId);
    if (trackIdsMeasured.length >= 2){
      var vals = [];
      for (var key in accompanimentEndByTrackId){
        if (Object.prototype.hasOwnProperty.call(accompanimentEndByTrackId, key)){
          vals.push(accompanimentEndByTrackId[key]);
        }
      }
      vals.sort(function(a, b){ return a - b; });
      var lo = vals[0];
      var hi = vals[vals.length - 1];
      if (hi >= 4 && cfg.trackBalanceMinRatio > 0 && lo / hi < cfg.trackBalanceMinRatio){
        warnings.push({
          code: 'track_imbalance',
          severity: 'warn',
          minEndBeat: lo,
          maxEndBeat: hi,
          ratio: Math.round((lo / hi) * 1000) / 1000,
        });
      }
    }

    sim.created.forEach(function(tid){
      var ig = Object.prototype.hasOwnProperty.call(sim.gainByTrack, tid) ? sim.gainByTrack[tid] : 0;
      var rawInst = sim.instruments[tid] || '';
      if (!isLikelyResolvableInstrument(rawInst, projectApi)){
        warnings.push({ code: 'questionable_instrument', severity: 'warn', trackId: tid, instrument: rawInst });
      }

      var velArr = metrics.tracks[tid] && Array.isArray(metrics.tracks[tid].velocities) ? metrics.tracks[tid].velocities : [];
      if (!velArr.length) return;
      var sum = 0;
      for (var ux = 0; ux < velArr.length; ux++) sum += velArr[ux];
      var avgV = sum / velArr.length;
      var melodyTooClose = melodyMaxVel != null && avgV >= (melodyMaxVel - cfg.loudMelodyProximity);
      var absLoud = isFiniteNumber(cfg.loudAvgVelocityWarn) && avgV >= cfg.loudAvgVelocityWarn && ig >= cfg.loudGainDbWarn;

      if (absLoud || (melodyTooClose && ig >= -3)){
        warnings.push({
          code: 'loud_combo',
          severity: 'warn',
          trackId: tid,
          avgVelocity: Math.round(avgV * 10) / 10,
          gainDb: ig,
          melodyMaxVelocity: melodyMaxVel,
        });
      }
    });

    return { ok: true, warnings: warnings, metrics: metrics };
  }

  return { analyzeArrangementQualityV0: analyzeArrangementQualityV0 };
});
