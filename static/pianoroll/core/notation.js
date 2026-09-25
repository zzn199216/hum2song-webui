/* Shared, non-mutating score projection. Musical time is always quarter-note beats. */
(function(root, factory){
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SNotation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const KEYS = { C:0, G:7, D:2, A:9, E:4, B:11, 'F#':6, F:5, Bb:10, Eb:3, Ab:8, Db:1, Gb:6 };
  const STEPS = [0,2,4,5,7,9,11];
  const DURATIONS = [[64,'w',0],[48,'h',1],[32,'h',0],[24,'q',1],[16,'q',0],[12,'8',1],[8,'8',0],[6,'16',1],[4,'16',0],[3,'32',1],[2,'32',0],[1,'64',0]];
  const clone = x => JSON.parse(JSON.stringify(x));
  const round = n => Math.round(n * 1e6) / 1e6;
  function preferences(raw){
    raw = raw || {};
    return { view:['roll','staff','jianpu'].includes(raw.view) ? raw.view : 'roll',
      key:Object.prototype.hasOwnProperty.call(KEYS,raw.key) ? raw.key : 'C',
      clef:['treble','bass'].includes(raw.clef) ? raw.clef : 'treble',
      grid:[4,8,16].includes(Number(raw.grid)) ? Number(raw.grid) : 4 };
  }
  function meter(value){
    const m = /^(\d+)\/(2|4|8|16)$/.exec(String(value || '4/4'));
    const n = m ? Number(m[1]) : 4, d = m ? Number(m[2]) : 4;
    return n > 0 && n <= 32 ? {n,d,beats:n*4/d,text:n+'/'+d} : {n:4,d:4,beats:4,text:'4/4'};
  }
  function spelling(pitch, key){
    // Spell relative to the selected major-key scale, including its diatonic letters.
    const tonic = KEYS[key] === undefined ? 0 : KEYS[key];
    const delta = ((pitch-tonic)%12+12)%12;
    const flat = key === 'F' || key.includes('b');
    let degree = STEPS.indexOf(delta), accidental = '';
    if (degree < 0){
      degree = flat ? STEPS.findIndex(s => s > delta) : STEPS.findLastIndex(s => s < delta);
      accidental = flat ? 'b' : '#';
    }
    const letters = 'cdefgab', tonicLetter = letters.indexOf(key[0].toLowerCase());
    const letter = letters[(tonicLetter+degree)%7];
    const natural = STEPS[letters.indexOf(letter)];
    let alter = ((pitch-natural)%12+12)%12;
    if (alter > 6) alter -= 12;
    const oct = Math.floor((pitch-alter)/12)-1;
    return {degree:degree+1,accidental,octave:Math.floor((pitch-tonic)/12)-5,
      key:letter+'/'+oct,alter:alter === 0 ? 'n' : alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)};
  }
  // Staff dragging advances letters in the displayed key. Keep chromatic offsets
  // (e.g. C-sharp in C major) so returning to the starting position is lossless.
  function transposeStaff(pitch, steps, key){
    key=preferences({key}).key;
    const spelled=spelling(pitch,key), parts=spelled.key.split('/'), letters='cdefgab';
    const position=Number(parts[1])*7+letters.indexOf(parts[0]);
    const tonicLetter=letters.indexOf(key[0].toLowerCase());
    function scalePitch(pos){
      const letter=((pos%7)+7)%7, degree=(letter-tonicLetter+7)%7;
      const natural=STEPS[letter];
      let alteration=((KEYS[key]+STEPS[degree]-natural)%12+12)%12;
      if(alteration>6)alteration-=12;
      return (Math.floor(pos/7)+1)*12+natural+alteration;
    }
    return Math.max(0,Math.min(127,scalePitch(position+Math.round(steps))+pitch-scalePitch(position)));
  }
  function project(score, bpm, opts){
    const pref = preferences(opts), ts = meter(score && score.time_signature);
    const factor = score && (score.version === 2 || score.timebase === 'beat') ? 1 : bpm/60;
    if (!(factor > 0) || !Number.isFinite(factor)) throw new Error('Invalid project BPM');
    const quantum = 16/pref.grid, barTicks = ts.beats*16;
    const lanes = []; let approximated = 0, count = 0, last = barTicks;
    for (const [ti, track] of (score.tracks || []).entries()){
      const groups = new Map();
      for (const [ni,n] of (track.notes || []).entries()){
        const start = Number(factor === 1 && n.startBeat !== undefined ? n.startBeat : n.start)*factor;
        const dur = Number(factor === 1 && n.durationBeat !== undefined ? n.durationBeat : n.duration)*factor;
        if (!Number.isFinite(start) || !Number.isFinite(dur) || start < 0 || dur <= 0 || !Number.isFinite(Number(n.pitch))) throw new Error('Invalid note timing or pitch');
        const from = Math.max(0,Math.round(start*16/quantum)*quantum);
        const to = Math.max(from+quantum,Math.round((start+dur)*16/quantum)*quantum);
        if (Math.abs(from/16-start)>0.00001 || Math.abs((to-from)/16-dur)>0.00001) approximated++;
        const ref = {trackId:String(track.id),noteId:String(n.id),noteIndex:ni,pitch:Number(n.pitch)};
        const key = from+':'+to;
        if (!groups.has(key)) groups.set(key,{from,to,refs:[]});
        groups.get(key).refs.push(ref); count++; last = Math.max(last,to);
      }
      const voices = [];
      for (const group of [...groups.values()].sort((a,b)=>a.from-b.from || b.to-a.to)){
        let voice = voices.find(v=>v.end<=group.from);
        if (!voice){ voice={end:0,events:[],trackId:String(track.id),name:track.name || 'Track '+(ti+1),index:voices.length}; voices.push(voice); }
        voice.events.push(group); voice.end=group.to;
      }
      if (!voices.length) voices.push({events:[],trackId:String(track.id),name:track.name || 'Track '+(ti+1),index:0});
      lanes.push(...voices);
    }
    if (!lanes.length) lanes.push({events:[],trackId:'',name:'',index:0});
    const bars = Math.ceil(last/barTicks);
    if (bars > 512 || lanes.length > 32 || count > 12000) throw new Error('This clip is too large for notation. Split it into shorter clips.');
    for (const lane of lanes){
      lane.bars = Array.from({length:bars},()=>[]);
      const emit = (from,to,refs) => {
        let at=from;
        while(at<to){
          const bar=Math.floor(at/barTicks), available=Math.min(to-at,barTicks-at%barTicks);
          const def=DURATIONS.find(d=>d[0]<=available && (refs.length || d[0]<=16));
          const end=at+def[0];
          lane.bars[bar].push({from:at,to:end,refs,trackId:lane.trackId,duration:def[1],dots:def[2],ticks:def[0],rest:!refs.length,
            tieIn:refs.length>0 && at>from,tieOut:refs.length>0 && end<to});
          at=end;
        }
      };
      let cursor=0;
      for(const ev of lane.events){
        if(ev.from>cursor) emit(cursor,ev.from,[]);
        emit(ev.from,ev.to,ev.refs); cursor=ev.to;
      }
      if(cursor<bars*barTicks) emit(cursor,bars*barTicks,[]);
    }
    return {lanes,bars,barTicks,meter:ts,pref,approximated,count};
  }
  function edit(score, refs, patch, bpm){
    if (!(bpm>0)) throw new Error('Invalid BPM');
    const next=clone(score), wanted=new Set(refs.map(r=>String(r.trackId)+'\0'+String(r.noteId)));
    for(const t of next.tracks || []) for(const n of t.notes || []){
      if(!wanted.has(String(t.id)+'\0'+String(n.id))) continue;
      if(patch.pitchDelta!=null) n.pitch=Math.min(127,Math.max(0,Math.round(n.pitch+patch.pitchDelta)));
      if(patch.pitch!=null) n.pitch=Math.min(127,Math.max(0,Math.round(patch.pitch)));
      if(patch.velocity!=null) n.velocity=Math.min(127,Math.max(1,Math.round(patch.velocity)));
      const beat=next.version===2 || next.timebase==='beat', sf=beat?'startBeat':'start', df=beat?'durationBeat':'duration', f=beat?1:60/bpm;
      if(patch.startBeat!=null) n[sf]=round(Math.max(0,patch.startBeat)*f);
      if(patch.moveBeat!=null) n[sf]=round(Math.max(0,n[sf]+patch.moveBeat*f));
      if(patch.durationBeat!=null) n[df]=round(Math.max(1/64,patch.durationBeat)*f);
      for(const v of [n.pitch,n.velocity,n[sf],n[df]]) if(!Number.isFinite(v)) throw new Error('Invalid note edit');
    }
    return next;
  }
  function reconcileSavedScore(original, savedDraft, editedDraft, converted){
    // The legacy editor uses seconds. Preserve untouched beat events exactly rather
    // than round-tripping their timing merely because another note was edited.
    const result=Object.assign({},clone(original),{tracks:clone(converted.tracks)}), index=score=>{
      const map=new Map();for(const t of score.tracks || [])for(const n of t.notes || [])map.set(String(t.id)+'\0'+String(n.id),n);return map;
    };
    const originalNotes=index(original), saved=index(savedDraft), edited=index(editedDraft);
    const same=(a,b)=>a && b && ['id','pitch','start','duration','velocity'].every(k=>a[k]===b[k]);
    result.tracks=result.tracks.map(t=>Object.assign({},(original.tracks || []).find(old=>String(old.id)===String(t.id)) || {},t));
    for(const t of result.tracks || [])t.notes=(t.notes || []).map(n=>{
      const key=String(t.id)+'\0'+String(n.id),old=originalNotes.get(key);
      if(!old)return n;
      return same(saved.get(key),edited.get(key))?clone(old):Object.assign({},old,n);
    });
    return result;
  }
  return {KEYS,preferences,meter,spelling,transposeStaff,project,edit,reconcileSavedScore};
});
