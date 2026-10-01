(function(root){
  'use strict';
  const N=root.H2SNotation,V=root.H2SNotationView;
  const clone=x=>JSON.parse(JSON.stringify(x));
  function create(app,rt){
    const modal=document.getElementById('modal');if(!modal || !N || !V)return;
    const zh=()=>String((root.I18N && root.I18N.getLang && root.I18N.getLang()) || document.documentElement.lang || '').startsWith('zh');
    const t=(cn,en)=>zh()?cn:en;
    let pref=N.preferences(),renderKey='',generation=0,redo=[],raf=0,exportUrl=null,exportGeneration=0;
    let pageJob=0,slots=[],screenModel=null,screenOptions=null,screenPlan=null,currentPage=0,visibleHits=[],selectedHits=new Set(),playingHits=new Set();
    const pageCache=new Map(),hitItems=new WeakMap(),slotKeys=new WeakMap();
    let playbackRows=[],followRows=[],followKey=null;
    let seekDrag=null,staffDrag=null,suppressClickUntil=0,rollPosition=null;
    const sizes=[50,60,75,90,100,110,125,150];
    let notationSize=100,zoomAnchor=null;
    try{const stored=Number(localStorage.getItem('h2s.notation.size'));if(sizes.includes(stored))notationSize=stored;}catch(_){}
    const draft=()=>rt.state.modal.draftScore;
    const bpm=()=>Number(app.getProjectV2().bpm) || 120;
    const refs=()=>rt.state.modal.selection && rt.state.modal.selection.noteRefs || [];
    const clip=()=>app.getProjectV2().clips[rt.state.modal.clipId];
    const bar=document.createElement('div');bar.className='notation-workbar';
    const tabs=document.createElement('div');tabs.className='notation-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('音符展示','Note view'));
    const labels={roll:['钢琴卷帘','Piano roll'],staff:['五线谱','Staff'],jianpu:['简谱','Numbered']};
    function button(parent,cn,en,fn,className){const e=document.createElement('button');e.type='button';e.className=className || 'btn';e.textContent=t(cn,en);e.onclick=fn;parent.append(e);return e;}
    for(const mode of Object.keys(labels)){
      const b=button(tabs,...labels[mode],()=>switchView(mode));b.dataset.view=mode;b.setAttribute('role','tab');b.id='notation-tab-'+mode;b.setAttribute('aria-controls',mode==='roll'?'canvasWrap':'notationSurface');
    }
    tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const bs=[...tabs.children],idx=bs.indexOf(document.activeElement);const next=e.key==='Home'?0:e.key==='End'?2:(idx+(e.key==='ArrowRight'?1:2))%3;bs[next].click();bs[next].focus();});
    bar.append(tabs);
    const transport=document.createElement('div');transport.className='notation-transport';bar.append(transport);
    ['btnClipPlay','btnClipStop'].forEach(id=>{const e=document.getElementById(id);e.textContent=id==='btnClipPlay'?'▶':'■';e.setAttribute('aria-label',id==='btnClipPlay'?t('播放片段','Play clip'):t('停止','Stop'));transport.append(e);});
    const undoButton=button(transport,'撤销','Undo',()=>{rt.modalUndoLastEdit();syncSelection();});
    const redoButton=button(transport,'重做','Redo',()=>redoEdit());
    const spacer=document.createElement('span');spacer.className='notation-spacer';bar.append(spacer);
    button(bar,'导出乐谱','Export score',()=>openExport());
    const toolsButton=button(bar,'更多工具','More tools',()=>{const show=modal.dataset.details!=='true';modal.dataset.details=String(show);toolsButton.setAttribute('aria-expanded',String(show));rt.modalRequestDraw();});toolsButton.setAttribute('aria-expanded','false');
    const left=modal.querySelector('.editorLeft');left.prepend(bar);
    const editbar=document.createElement('div');editbar.className='notation-editbar';bar.after(editbar);
    function field(parent,cn,en,values,fn){const label=document.createElement('label');label.append(document.createTextNode(t(cn,en)));const e=document.createElement('select');for(const [value,name] of values){const o=document.createElement('option');o.value=value;o.textContent=name;e.append(o);}e.onchange=()=>fn(e.value);label.append(e);parent.append(label);return e;}
    function input(cn,en,min,max,step,fn){const label=document.createElement('label');label.textContent=t(cn,en);const e=document.createElement('input');e.type='number';e.min=min;e.max=max;e.step=step;e.onchange=()=>{if(e.value.trim() && e.checkValidity())apply(fn(Number(e.value)));else syncSelection();};label.append(e);editbar.append(label);return e;}
    const noteLabel=document.createElement('span');noteLabel.className='notation-note-label';editbar.append(noteLabel);
    const pitchNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
    const pitchInput=field(editbar,'音高','Pitch',[['','—'],...Array.from({length:128},(_,p)=>[p,pitchNames[p%12]+(Math.floor(p/12)-1)])],v=>{if(v!=='')apply({pitch:Number(v)});});
    const startInput=input('起始拍','Start beat',1,100000,0.0625,v=>({startBeat:v-1}));
    const durationInput=field(editbar,'时值','Duration',[['',t('自定','Custom')],[4,t('全音符','Whole')],[2,t('二分音符','Half')],[1,t('四分音符','Quarter')],[.5,t('八分音符','Eighth')],[.25,t('十六分音符','Sixteenth')],[1.5,t('附点四分','Dotted quarter')],[.75,t('附点八分','Dotted eighth')]],v=>{if(v!=='')apply({durationBeat:Number(v)});});
    const lengthInput=input('拍数','Beats',0.015625,10000,0.015625,v=>({durationBeat:v}));
    const velInput=input('力度','Velocity',1,127,1,v=>({velocity:v}));
    const shorter=button(editbar,'− 半音','− semitone',()=>apply({pitchDelta:-1}),'btn mini');
    const higher=button(editbar,'+ 半音','+ semitone',()=>apply({pitchDelta:1}),'btn mini');
    const insertButton=button(editbar,'＋ 音符','＋ Note',()=>insert(),'btn mini');
    const deleteButton=button(editbar,'删除','Delete',()=>rt.modalDeleteSelectedNotes(),'btn mini');
    const settings=document.createElement('div');settings.className='notation-settings';editbar.after(settings);
    const keySelect=field(settings,'调号','Key',Object.keys(N.KEYS).map(k=>[k,'1 = '+k]),v=>{pref.key=v;invalidate();});
    const clefSelect=field(settings,'谱号','Clef',[['treble',t('高音','Treble')],['bass',t('低音','Bass')]],v=>{pref.clef=v;invalidate();});
    const gridSelect=field(settings,'显示精度','Display grid',[[4,'1/16'],[8,'1/32'],[16,'1/64']],v=>{pref.grid=Number(v);invalidate();});
    const sizeSelect=field(settings,'谱面大小','Score size',sizes.map(n=>[n,n+'%']),v=>{
      finishSeek(false);finishStaffDrag(false);
      zoomAnchor=screenPlan?.pages[currentPage]?.rows[0]?.bar ?? null;
      notationSize=Number(v);try{localStorage.setItem('h2s.notation.size',v);}catch(_){}
      invalidate();
    });sizeSelect.id='notationSize';sizeSelect.value=notationSize;
    const hint=document.createElement('span');hint.className='notation-hint';settings.append(hint);
    const surface=document.createElement('div');surface.id='notationSurface';surface.className='notation-surface';surface.hidden=true;surface.setAttribute('role','tabpanel');surface.tabIndex=0;settings.after(surface);
    const pager=document.createElement('nav');pager.className='notation-pager';pager.hidden=true;pager.setAttribute('aria-label',t('乐谱分页','Score pages'));surface.after(pager);
    const previousPage=button(pager,'上一页','Previous',()=>goPage(currentPage-1),'btn mini');
    const pageLabel=document.createElement('span');pageLabel.className='notation-page-position';pager.append(pageLabel);
    const nextPage=button(pager,'下一页','Next',()=>goPage(currentPage+1),'btn mini');
    function goPage(index){if(!slots.length)return;const slot=slots[Math.max(0,Math.min(slots.length-1,index))];surface.scrollTop+=slot.getBoundingClientRect().top-surface.getBoundingClientRect().top;queuePages();}
    function queuePages(){if(!pageJob && rt.state.modal.show && pref.view!=='roll')pageJob=requestAnimationFrame(updatePages);}
    surface.addEventListener('scroll',queuePages,{passive:true});
    function refreshHits(){
      visibleHits=[];playbackRows=[];
      for(const slot of slots){
        for(const e of slot.querySelectorAll('[data-hit]'))visibleHits.push(e);
        const svg=slot.querySelector('svg');if(!svg)continue;
        svg.querySelectorAll('.notation-playhead').forEach(e=>e.remove());
        for(const row of V.playbackRows(svg)){
          const marker=document.createElementNS('http://www.w3.org/2000/svg','g');marker.setAttribute('class','notation-playhead');marker.setAttribute('aria-hidden','true');marker.style.display='none';
          const line=document.createElementNS(marker.namespaceURI,'line');line.setAttribute('y1',row.top);line.setAttribute('y2',row.bottom);line.setAttribute('x1','0');line.setAttribute('x2','0');
          const cap=document.createElementNS(marker.namespaceURI,'path');cap.setAttribute('d','M -5 '+(row.top-5)+' L 5 '+(row.top-5)+' L 0 '+row.top+' Z');const handle=document.createElementNS(marker.namespaceURI,'rect');handle.setAttribute('class','notation-seek-handle');handle.setAttribute('x','-12');handle.setAttribute('y',row.top-17);handle.setAttribute('width','24');handle.setAttribute('height','19');marker.append(line,cap,handle);svg.append(marker);
          playbackRows.push({...row,marker});
        }
      }
      syncSelection();startHighlight();if(rt.state.modal.isPlaying && pref.view!=='roll')movePlayheads(Number(rt.state.modal.cursorSec || 0)*bpm()/60);
    }
    function hidePlayheads(){for(const row of playbackRows)row.marker.style.display='none';followKey=null;}
    function movePlayheads(beat,follow=true){
      if(!screenPlan)return;
      for(const row of playbackRows){
        if(beat<row.from || beat>=row.to){if(row.marker.style.display!=='none')row.marker.style.display='none';continue;}
        // Engraved note spacing is nonlinear. Interpolate between actual glyph
        // anchors, including rests, rather than assuming equal pixels per beat.
        let i=0;while(i+1<row.anchors.length && row.anchors[i+1].beat<=beat)i++;
        const a=row.anchors[i],b=row.anchors[i+1] || a;
        const ratio=b.beat>a.beat?Math.max(0,Math.min(1,(beat-a.beat)/(b.beat-a.beat))):0;
        row.marker.setAttribute('transform','translate('+(a.x+(b.x-a.x)*ratio)+' 0)');row.marker.style.display='';
      }
      if(!follow)return;
      const target=followRows.find(r=>beat>=r.from && beat<r.to);if(!target || target.key===followKey)return;followKey=target.key;
      const slot=slots[target.page];if(!slot)return;
      const bounds=surface.getBoundingClientRect(),rect=slot.getBoundingClientRect(),scale=rect.width/screenPlan.pageWidth;
      const top=rect.top+target.top*scale,bottom=rect.top+target.bottom*scale;
      // Follow once per system, so manual scrolling within a system is not
      // immediately pulled back on the next animation frame.
      if(top<bounds.top+8 || bottom>bounds.bottom-8){surface.scrollTop+=top-bounds.top-24;queuePages();}
    }
    function updatePages(){
      pageJob=0;if(!screenPlan || !rt.state.modal.show || pref.view==='roll')return;
      const bounds=surface.getBoundingClientRect(),positions=slots.map((slot,index)=>({slot,index,rect:slot.getBoundingClientRect()}));
      const visible=positions.filter(p=>p.rect.bottom>bounds.top-100 && p.rect.top<bounds.bottom+100);
      const active=positions.find(p=>p.rect.bottom>bounds.top+Math.min(120,surface.clientHeight/3)) || positions[positions.length-1];
      currentPage=active?active.index:0;
      const rows=screenPlan.pages[currentPage].rows,range=(rows[0].bar+1)+'–'+(rows.at(-1).bar+rows.at(-1).count);
      pageLabel.textContent=t('第 '+(currentPage+1)+' 页 / 共 '+slots.length+' 页 · 小节 '+range,(currentPage+1)+' / '+slots.length+' pages · Measures '+range);
      previousPage.disabled=currentPage===0;nextPage.disabled=currentPage===slots.length-1;
      const wanted=new Set(visible.map(p=>p.index));let changed=false;
      for(const p of positions)if(!wanted.has(p.index) && p.slot.firstChild){p.slot.replaceChildren();changed=true;}
      // One page per frame keeps scrolling and pointer events responsive. Cache
      // unchanged pages across edits; never retain the whole engraved score.
      const pageKey=p=>{const spec=screenPlan.pages[p.index];return JSON.stringify([screenOptions,p.index,screenPlan.pages.length,spec.height,spec.rows.map(r=>[r.y,r.offset,r.noteBase,r.lane.name,r.lane.index,r.bar,r.count,r.lane.bars.slice(r.bar,r.bar+r.count)])]);};
      const pending=visible.map(p=>({...p,key:pageKey(p)})).filter(p=>!p.slot.firstChild || slotKeys.get(p.slot)!==p.key).sort((a,b)=>Math.abs(a.index-currentPage)-Math.abs(b.index-currentPage));
      const p=pending[0];
      if(p){
        const key=p.key;
        let entry=pageCache.get(key);
        try{
          if(!entry){
            // A reused SVG is patched in place; its old cache key must not point
            // to the edited result (notably when undoing or cancelling a drag).
            const previous=p.slot.querySelector('svg');for(const [cachedKey,value] of pageCache)if(value===previous)pageCache.delete(cachedKey);
            const rendered=V.render(screenModel,{...screenOptions,plan:screenPlan,pageIndex:p.index,reusePage:previous});entry=rendered.pages[0];entry.querySelectorAll('[data-hit]').forEach(e=>hitItems.set(e,rendered.registry[Number(e.dataset.hit)]));
          }
          pageCache.delete(key);pageCache.set(key,entry);while(pageCache.size>4)pageCache.delete(pageCache.keys().next().value);
          if(p.slot.firstChild!==entry)p.slot.replaceChildren(entry);slotKeys.set(p.slot,key);changed=true;
        }catch(err){p.slot.textContent=t('此页无法显示：','Unable to display this page: ')+err.message;}
      }
      if(changed)refreshHits();if(pending.length>1)queuePages();
    }
    const surfaceWidth=()=>{const css=getComputedStyle(surface);return Math.max(320,Math.floor(surface.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)));};
    let observedWidth=0;
    const resizeObserver=new ResizeObserver(()=>{
      if(!rt.state.modal.show || pref.view==='roll' || !surface.clientWidth)return;
      const width=surfaceWidth();if(width===observedWidth)return;observedWidth=width;
      finishStaffDrag(false);invalidate();
    });
    resizeObserver.observe(surface);
    const notice=document.createElement('div');notice.className='notation-notice';notice.setAttribute('role','status');surface.before(notice);
    modal.classList.add('notation-enabled');modal.dataset.details='false';
    const audition=root.H2SEditorAudition.create(rt,err=>{notice.textContent=t('试听不可用：','Preview unavailable: ')+err.message;});
    let previewEnabled=true;
    const previewButton=button(bar,'试听：开','Preview: on',()=>{previewEnabled=!previewEnabled;audition.setEnabled(previewEnabled);previewButton.textContent=previewEnabled?t('试听：开','Preview: on'):t('试听：关','Preview: off');previewButton.setAttribute('aria-pressed',String(previewEnabled));});
    previewButton.setAttribute('aria-pressed','true');bar.insertBefore(previewButton,spacer);

    function invalidate(){renderKey='';rt.modalRequestDraw();}
    function switchView(mode){
      const grid=document.querySelector('.editorGridWrap');
      if(pref.view==='roll' && !document.getElementById('canvasWrap').hidden)rollPosition={top:grid.scrollTop,left:grid.scrollLeft};
      finishSeek(false);finishStaffDrag(false);audition.stop();rt.modalEndEdgeScroll();generation++;pref.view=mode;modal.dataset.noteView=mode;surface.hidden=mode==='roll';pager.hidden=mode==='roll';document.getElementById('canvasWrap').hidden=mode!=='roll';settings.hidden=mode==='roll';notice.hidden=mode==='roll';
      cancelAnimationFrame(pageJob);pageJob=0;hidePlayheads();screenPlan=null;pageCache.clear();startHighlight();
      for(const b of tabs.children){const selected=b.dataset.view===mode;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;}
      surface.setAttribute('aria-labelledby','notation-tab-'+mode);keySelect.value=pref.key;clefSelect.value=pref.clef;gridSelect.value=pref.grid;
      if(mode==='roll'){rt.modalResizeCanvasToContent();if(rollPosition){grid.scrollTop=rollPosition.top;grid.scrollLeft=rollPosition.left;}else rt.modalAutoScrollPitchToCenter();}
      invalidate();}
    function selectedNotes(){const selected=new Set(refs().map(r=>r.trackId+'\0'+r.noteId));const out=[];for(const tr of draft().tracks || [])for(const n of tr.notes || [])if(selected.has(String(tr.id)+'\0'+String(n.id)))out.push(n);return out;}
    function syncSelection(){
      if(!rt.state.modal.show)return;
      const play=document.getElementById('btnClipPlay'),playing=rt.state.modal.isPlaying;
      play.textContent=playing?'Ⅱ':'▶';play.setAttribute('aria-label',playing?t('暂停片段','Pause clip'):t('播放片段','Play clip'));play.title=play.getAttribute('aria-label');
      document.getElementById('btnClipStop').title=t('停止并回到开头','Stop and return to start');
      const notes=selectedNotes(),one=notes.length===1?notes[0]:null;
      noteLabel.textContent=notes.length?t('已选 '+notes.length+' 个音','Selected: '+notes.length):t('选择音符开始编辑','Select a note to edit');
      [pitchInput,startInput,lengthInput,velInput,durationInput].forEach(e=>{e.disabled=!one;});
      if(one){pitchInput.value=one.pitch;startInput.value=+(one.start*bpm()/60+1).toFixed(5);lengthInput.value=+(one.duration*bpm()/60).toFixed(5);velInput.value=one.velocity;
        durationInput.value=[4,2,1,.5,.25,1.5,.75].find(v=>Math.abs(v-Number(lengthInput.value))<.00001) || '';}
      else [pitchInput,startInput,lengthInput,velInput,durationInput].forEach(e=>e.value='');
      shorter.disabled=higher.disabled=deleteButton.disabled=!notes.length;
      undoButton.disabled=!root.H2SProjectLastUndo.canUndo('editor');redoButton.disabled=!redo.length;
      const selected=new Set(refs().map(r=>r.trackId+'\0'+r.noteId));
      const next=new Set(visibleHits.filter(e=>hitItems.get(e).refs.some(r=>selected.has(r.trackId+'\0'+r.noteId))));
      for(const e of selectedHits)if(!next.has(e))e.classList.remove('is-selected');
      for(const e of next)if(!selectedHits.has(e))e.classList.add('is-selected');selectedHits=next;
    }
    function apply(patch){if(!refs().length)return;rt.modalStop();const next=N.edit(draft(),refs(),patch,bpm());if(JSON.stringify(next)===JSON.stringify(draft()))return;rt.modalCaptureEditorUndo('notation_edit');rt.state.modal.draftScore=next;rt.state.modal.dirty=true;invalidate();}
    function insert(){
      const score=draft();if(!score.tracks.length)score.tracks.push({id:'trk_'+Date.now(),name:t('旋律','Melody'),notes:[]});
      const cell=rt.state.modal.selectedCell || {startSec:rt.state.modal.cursorSec || 0,pitch:60};
      rt.modalCaptureEditorUndo('notation_insert');
      const track=score.tracks.find(tr=>String(tr.id)===String(cell.trackId || (refs()[0] && refs()[0].trackId))) || score.tracks[0];
      const note={id:root.H2SProject.makeId?root.H2SProject.makeId('note'):'note_'+crypto.randomUUID(),pitch:cell.pitch,velocity:90,start:cell.startSec,duration:60/bpm()};
      track.notes.push(note);select({refs:[{trackId:String(track.id),noteId:note.id}],beat:note.start*bpm()/60},false);rt.state.modal.dirty=true;invalidate();
    }
    function select(item,extend){
      const m=rt.state.modal;m.selection={noteRefs:extend?[...refs()]:[],tool:'pointer'};
      for(const r of item.refs){const found=m.selection.noteRefs.findIndex(x=>x.trackId===r.trackId && x.noteId===r.noteId);if(found<0)m.selection.noteRefs.push(r);else if(extend)m.selection.noteRefs.splice(found,1);}
      rt.modalSeek(item.beat*60/bpm());m.selectedCell=item.refs.length?null:{startSec:m.cursorSec,pitch:60,trackId:item.trackId};rt.modalSyncLegacySelectionFromRefs();rt.modalUpdateSelectionUI();syncSelection();startHighlight();
    }
    function seekPoint(e,preferred){
      const svg=preferred?preferred.marker.ownerSVGElement:e.target.closest('svg');if(!svg)return null;
      const matrix=svg.getScreenCTM();if(!matrix)return null;
      const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
      const row=preferred || playbackRows.find(r=>r.marker.ownerSVGElement===svg && point.y>=r.top-20 && point.y<=r.bottom);
      if(!row || !row.anchors.length)return null;
      let i=0;while(i+1<row.anchors.length && row.anchors[i+1].x<=point.x)i++;
      const a=row.anchors[i],b=row.anchors[i+1] || a;
      const fraction=b.x>a.x?Math.max(0,Math.min(1,(point.x-a.x)/(b.x-a.x))):0;
      const beat=Math.max(row.from,Math.min(row.to-0.0001,a.beat+(b.beat-a.beat)*fraction));
      return {row,seconds:beat*60/bpm()};
    }
    function finishSeek(commit){
      const d=seekDrag;if(!d)return;seekDrag=null;surface.classList.remove('is-seeking');
      if(!commit)rt.state.modal.cursorSec=d.before;
      if(surface.hasPointerCapture(d.id))surface.releasePointerCapture(d.id);
      suppressClickUntil=performance.now()+400;startHighlight();
      if(commit && d.playing)rt.modalPlay();
    }
    surface.addEventListener('pointerdown',e=>{
      if(pref.view==='roll' || e.button!==0 || e.shiftKey || staffDrag || seekDrag)return;
      const handle=e.target.closest('.notation-seek-handle');
      if(!handle && e.target.closest('[data-hit]'))return;
      const preferred=handle && playbackRows.find(r=>r.marker===handle.parentNode);
      const point=seekPoint(e,preferred);if(!point)return;
      e.preventDefault();surface.focus({preventScroll:true});
      const playing=rt.state.modal.isPlaying || rt._modalPlayPending;rt.modalStop();
      seekDrag={id:e.pointerId,row:point.row,before:rt.state.modal.cursorSec,playing};
      rt.state.modal.cursorSec=point.seconds;startHighlight();
      surface.setPointerCapture(e.pointerId);surface.classList.add('is-seeking');
    });
    surface.addEventListener('pointermove',e=>{
      if(!seekDrag || e.pointerId!==seekDrag.id)return;e.preventDefault();
      const point=seekPoint(e,seekDrag.row);if(point){rt.state.modal.cursorSec=point.seconds;startHighlight();}
    });
    surface.addEventListener('pointerup',e=>{if(seekDrag && e.pointerId===seekDrag.id)finishSeek(true);});
    surface.addEventListener('pointercancel',()=>finishSeek(false));
    surface.addEventListener('lostpointercapture',()=>finishSeek(false));
    root.addEventListener('blur',()=>finishSeek(false));
    // Capture on the persistent surface: SVG note elements are replaced by live engraving.
    surface.addEventListener('pointerdown',e=>{
      if(pref.view==='roll' || e.button!==0 || e.shiftKey || staffDrag || seekDrag)return;
      const h=e.target.closest('[data-hit]'),item=h && hitItems.get(h);
      if(!item || item.refs.length!==1)return;
      const matrix=h.ownerSVGElement.getScreenCTM();if(!matrix)return;
      e.preventDefault();rt.modalStop();select(item,false);surface.focus({preventScroll:true});
      const note=selectedNotes()[0];if(!note)return;
      staffDrag={pointerId:e.pointerId,startY:e.clientY,scale:Math.hypot(matrix.c,matrix.d),step:pref.view==='staff'?5:12,plan:screenPlan,
        score:clone(draft()),dirty:rt.state.modal.dirty,refs:clone(item.refs),pitch:note.pitch,current:note.pitch,key:pref.key};
      surface.setPointerCapture(e.pointerId);surface.classList.add('is-dragging');audition.play(note.pitch,note.velocity);
    });
    surface.addEventListener('pointermove',e=>{
      const d=staffDrag;if(!d || d.pointerId!==e.pointerId)return;e.preventDefault();
      const steps=Math.round((d.startY-e.clientY)/(d.step*d.scale));
      const pitch=N.transposeStaff(d.pitch,steps,d.key);if(pitch===d.current)return;
      d.current=pitch;rt.state.modal.draftScore=N.edit(d.score,d.refs,{pitch},bpm());
      rt.state.modal.dirty=d.dirty || pitch!==d.pitch;audition.play(pitch,selectedNotes()[0].velocity);invalidate();
    });
    function finishStaffDrag(commit){
      const d=staffDrag;if(!d)return;staffDrag=null;surface.classList.remove('is-dragging');
      const finalScore=draft();rt.state.modal.draftScore=d.score;rt.state.modal.dirty=d.dirty;
      if(commit && d.current!==d.pitch){rt.modalCaptureEditorUndo('staff_pitch_drag');rt.state.modal.draftScore=finalScore;rt.state.modal.dirty=true;}
      if(surface.hasPointerCapture(d.pointerId))surface.releasePointerCapture(d.pointerId);
      suppressClickUntil=performance.now()+400;audition.stop();invalidate();
    }
    surface.addEventListener('pointerup',e=>{if(staffDrag && e.pointerId===staffDrag.pointerId)finishStaffDrag(true);});
    surface.addEventListener('pointercancel',()=>finishStaffDrag(false));
    surface.addEventListener('lostpointercapture',()=>finishStaffDrag(false));
    root.addEventListener('blur',()=>{finishStaffDrag(false);audition.stop();});
    surface.addEventListener('click',e=>{if(e.detail && performance.now()<suppressClickUntil)return;const h=e.target.closest('[data-hit]');if(h)select(hitItems.get(h),e.shiftKey);});
    surface.addEventListener('dblclick',e=>{const h=e.target.closest('[data-hit]');if(h && !hitItems.get(h).refs.length){select(hitItems.get(h),false);insert();}});
    surface.addEventListener('keydown',e=>{
      if((e.key==='Enter' || e.key===' ') && e.target.dataset.hit!=null){e.preventDefault();select(hitItems.get(e.target),e.shiftKey);return;}
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && refs().length){e.preventDefault();apply(e.key==='ArrowUp'?{pitchDelta:e.shiftKey?12:1}:e.key==='ArrowDown'?{pitchDelta:e.shiftKey?-12:-1}:{moveBeat:(e.key==='ArrowRight'?1:-1)/pref.grid});}
    });
    // Keep all three views in the existing history. Redo stores the inverse snapshots of existing undo.
    const originalCapture=rt.modalCaptureEditorUndo.bind(rt),originalUndo=rt.modalUndoLastEdit.bind(rt);
    rt.modalCaptureEditorUndo=function(...args){redo=[];return originalCapture(...args);};
    rt.modalUndoLastEdit=function(){const before=clone(draft()),ui=clone(rt.state.modal.selection);const result=originalUndo();if(result){redo.push({score:before,selection:ui});invalidate();}return result;};
    function redoEdit(){if(!redo.length)return;const item=redo.pop();originalCapture('redo');rt.state.modal.draftScore=item.score;rt.state.modal.selection=item.selection;rt.modalSyncLegacySelectionFromRefs();rt.state.modal.dirty=JSON.stringify(draft())!==JSON.stringify(rt.state.modal.savedScore);invalidate();}
    document.addEventListener('keydown',e=>{
      if(seekDrag){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape')finishSeek(false);return;}
      if(staffDrag){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape')finishStaffDrag(false);return;}
      if(dialog.open){e.stopImmediatePropagation();return;}
      if(!rt.state.modal.show || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable)return;
      if((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase()==='z' && e.shiftKey) || e.key.toLowerCase()==='y')){e.preventDefault();e.stopImmediatePropagation();redoEdit();}
    },true);
    const originalOpen=rt.openClipEditor.bind(rt),originalClose=rt.closeModal.bind(rt),originalDraw=rt.modalDraw.bind(rt);
    rt.openClipEditor=function(id){originalOpen(id);if(!rt.state.modal.show || rt.state.modal.clipId!==id)return;rollPosition=null;surface.scrollTop=0;pref=N.preferences(clip().meta && clip().meta.notation);redo=[];switchView(pref.view);startHighlight();};
    rt.closeModal=function(save){
      finishSeek(false);finishStaffDrag(false);audition.dispose();rt.modalEndEdgeScroll();
      const id=rt.state.modal.clipId, shouldSave=save && rt.state.modal.show;
      const originalScore=shouldSave?clone(clip().score):null;
      const originalMeta=shouldSave?clone(clip().meta || {}):null, originalRevision=shouldSave?clip().revisionId:null;
      const savedDraft=shouldSave?clone(rt.state.modal.savedScore):null, editedDraft=shouldSave?clone(draft()):null;
      generation++;cancelAnimationFrame(raf);cancelAnimationFrame(pageJob);pageJob=0;screenPlan=null;pageCache.clear();slots=[];visibleHits=[];playbackRows=[];followRows=[];followKey=null;selectedHits.clear();playingHits.clear();surface.replaceChildren();closeExport();const result=originalClose(save);
      if(shouldSave){const p=app.getProjectV2(),c=p.clips[id];
        if(c){const nextScore=N.reconcileSavedScore(originalScore,savedDraft,editedDraft,c.score);
          if(JSON.stringify(nextScore)!==JSON.stringify(originalScore) && c.revisionId===originalRevision){
            c.score=originalScore;c.meta=originalMeta;
            root.H2SProject.beginNewClipRevision(p,id,{reason:'editor_save'});
          }
          c.meta=Object.assign({},c.meta,{notation:clone(pref)});c.score=nextScore;
          root.H2SProject.recomputeClipMetaFromScoreBeat(c);app.commitV2(p,'notation_preferences');}}
      return result;
    };
    rt.modalDraw=function(){
      if(pref.view==='roll'){originalDraw();if(rt.state.modal.show)audition.syncKeyboard();syncSelection();return;}
      if(!rt.state.modal.show)return;syncSelection();startHighlight();
      // Legacy selection annotates notes with UI-only _trackId/_noteIndex.
      // Selecting/previewing a note must not trigger a full engraving pass.
      const width=surfaceWidth();
      const key=JSON.stringify([draft(),pref,bpm(),width,notationSize],(k,v)=>k.startsWith('_')?undefined:v);if(key===renderKey)return;renderKey=key;
      const ticket=++generation;notice.textContent=t('正在排版…','Engraving…');
      Promise.resolve(pref.view==='staff'?V.load('staff'):null).then(()=>{
        if(ticket!==generation || !rt.state.modal.show)return;
        const model=N.project(draft(),bpm(),pref);
        const footer=model.approximated?t('节奏为显示近似；播放保留原始时值。','Rhythm is approximated for display; playback retains original timing.'):'';
        screenModel=model;screenOptions={mode:pref.view,bpm:bpm(),title:clip().name,footer,layout:'screen',width:Math.max(320,Math.round(width*100/notationSize)),language:zh()?'zh':'en',key:pref.key,clef:pref.clef,grid:pref.grid,meter:model.meter.text};
        const frozen=staffDrag && staffDrag.plan;
        // Pitch does not change voices or rhythm. Hold page geometry during a
        // gesture, then allow ledger-line spacing to reflow once on release.
        screenPlan=frozen?{...frozen,pages:frozen.pages.map(p=>({...p,rows:p.rows.map(r=>({...r,lane:model.lanes.find(l=>l.trackId===r.lane.trackId && l.index===r.lane.index)}))}))}:V.layout(model,screenOptions);
        const leader=model.lanes[0];followKey=null;followRows=[];
        screenPlan.pages.forEach((p,page)=>p.rows.forEach(row=>{if(row.lane.trackId===leader.trackId && row.lane.index===leader.index)followRows.push({page,key:page+':'+row.bar,from:row.bar*model.barTicks/16,to:(row.bar+row.count)*model.barTicks/16,top:row.y+20,bottom:row.y+row.height-30});}));
        const scrollTop=surface.scrollTop;
        const displayWidth=Math.max(width,320*notationSize/100);
        while(slots.length>screenPlan.pages.length)slots.pop().remove();
        screenPlan.pages.forEach((p,i)=>{let slot=slots[i];if(!slot){slot=document.createElement('section');slot.className='notation-page-slot';slot.dataset.page=String(i+1);slots.push(slot);surface.append(slot);}const range=(p.rows[0].bar+1)+'–'+(p.rows.at(-1).bar+p.rows.at(-1).count);slot.setAttribute('aria-label',t('第 '+(i+1)+' 页 · 小节 '+range,'Page '+(i+1)+' · Measures '+range));slot.style.width=displayWidth+'px';slot.style.height=(p.height*displayWidth/screenPlan.pageWidth)+'px';});
        surface.scrollTop=scrollTop;
        if(zoomAnchor!=null){const index=screenPlan.pages.findIndex(p=>p.rows.some(r=>zoomAnchor>=r.bar && zoomAnchor<r.bar+r.count));if(index>=0)surface.scrollTop+=slots[index].getBoundingClientRect().top-surface.getBoundingClientRect().top;zoomAnchor=null;}
        queuePages();
        notice.textContent=model.approximated?t(model.approximated+' 个音符按显示精度记谱，原始演奏节奏未改变。',model.approximated+' notes approximated for display. Original timing is unchanged.'):t('点选音符 · ↑↓ 改音高 · ←→ 移动 · 双击休止符插入','Select notes · ↑↓ pitch · ←→ timing · Double-click a rest to insert');
        notice.textContent=t('点击谱面空白定位 · 拖动绿线顶端调整进度 · 上下拖音符改音高 · Esc 取消。','Click blank score to seek · Drag the green cap to scrub · Drag notes vertically for pitch · Esc cancels. ')+(model.approximated?' '+notice.textContent:'');
        hint.textContent=t('显示设置不改变演奏','Display settings preserve performance');syncSelection();
      }).catch(err=>{if(ticket!==generation)return;surface.replaceChildren();slots=[];visibleHits=[];screenPlan=null;pageLabel.textContent='—';notice.textContent=t('无法显示乐谱：','Unable to display score: ')+err.message;renderKey='';});
    };
    function startHighlight(){cancelAnimationFrame(raf);raf=0;
      if(!rt.state.modal.show || pref.view==='roll' || !rt.state.modal.isPlaying){
        for(const e of playingHits)e.classList.remove('is-playing');playingHits.clear();
        if(rt.state.modal.show && pref.view!=='roll'){
          // Like the roll's stopped cursor, retain the shared transport position.
          // Draw once without an idle animation loop or forced scrolling.
          followKey=null;movePlayheads(Number(rt.state.modal.cursorSec || 0)*bpm()/60,false);
        }else hidePlayheads();
        return;
      }
      const tick=()=>{raf=0;if(!rt.state.modal.show || pref.view==='roll' || !rt.state.modal.isPlaying){startHighlight();return;}
        const beat=Number(rt.state.modal.cursorSec || 0)*bpm()/60;
        movePlayheads(beat);
        const next=new Set(visibleHits.filter(e=>{const item=hitItems.get(e);return item.refs.length && beat>=item.beat && beat<item.beat+item.duration;}));
        for(const e of playingHits)if(!next.has(e))e.classList.remove('is-playing');for(const e of next)if(!playingHits.has(e))e.classList.add('is-playing');playingHits=next;
        raf=requestAnimationFrame(tick);
      };raf=requestAnimationFrame(tick);
    }

    const dialog=document.createElement('dialog');dialog.className='notation-export';dialog.setAttribute('aria-label',t('导出乐谱预览','Score export preview'));
    const exportHeader=document.createElement('div');exportHeader.className='notation-export-header';dialog.append(exportHeader);
    const exportTitle=document.createElement('strong');exportTitle.textContent=t('导出乐谱','Export score');exportHeader.append(exportTitle);
    const exportMode=field(exportHeader,'格式','Notation',[['staff',t('五线谱','Staff')],['jianpu',t('简谱','Numbered')]],()=>renderExport());
    const pdfButton=button(exportHeader,'下载 PDF','Download PDF',()=>downloadPDF());
    const retryButton=button(exportHeader,'重试','Retry',()=>renderExport());retryButton.hidden=true;
    const svgButton=button(exportHeader,'下载 SVG','Download SVG',()=>{
      if(!exportPages.length)return;
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','794');svg.setAttribute('height',String(1123*exportPages.length));
      exportPages.forEach((p,i)=>{const copy=p.cloneNode(true);copy.querySelectorAll('.notation-hit').forEach(e=>e.remove());copy.setAttribute('y',String(i*1123));svg.append(copy);});
      download(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}),fileName()+'.svg');
    });
    button(exportHeader,'返回编辑','Back to editing',()=>closeExport());
    const exportStatus=document.createElement('div');exportStatus.className='notation-export-status';exportStatus.setAttribute('role','status');dialog.append(exportStatus);
    const preview=document.createElement('div');preview.className='notation-export-pages';dialog.append(preview);document.body.append(dialog);
    let exportPages=[],exportDraft=null,exportPref=null,exportBpm=120,exportName='',exportBlob=null,exportAbort=null,exportCache=null;
    const fileName=()=>String(exportName || 'clip').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90)+'-'+exportMode.value;
    function download(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
    function openExport(){finishStaffDrag(false);audition.stop();rt.modalStop();exportDraft=clone(draft());exportPref=clone(pref);exportBpm=bpm();exportName=clip().name;exportMode.value=pref.view==='jianpu'?'jianpu':'staff';dialog.showModal();renderExport();}
    function closeExport(){exportGeneration++;if(exportAbort)exportAbort.abort();exportAbort=null;if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=null;exportBlob=null;preview.replaceChildren();exportPages=[];if(dialog.open)dialog.close();}
    dialog.addEventListener('cancel',()=>closeExport());
    async function renderExport(){
      if(exportAbort)exportAbort.abort();exportAbort=new AbortController();
      const signal=exportAbort.signal,ticket=++exportGeneration;
      if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=null;
      exportBlob=null;pdfButton.disabled=svgButton.disabled=true;retryButton.hidden=true;preview.replaceChildren();exportPages=[];exportStatus.textContent=t('正在生成预览…','Preparing preview…');
      const mode=exportMode.value,language=zh()?'zh':'en';
      const key=JSON.stringify([exportDraft,exportPref,exportBpm,exportName,mode,language],(k,v)=>k.startsWith('_')?undefined:v);
      function ready(blob){
        exportBlob=blob;exportUrl=URL.createObjectURL(blob);
        const a=document.createElement('a');a.href=exportUrl;a.target='_blank';a.rel='noopener';a.textContent=t('打开实际 PDF 预览','Open actual PDF preview');
        exportStatus.textContent=t(exportPages.length+' 页 · A4 · ',exportPages.length+' pages · A4 · ');exportStatus.append(a);pdfButton.disabled=svgButton.disabled=false;
      }
      if(exportCache && exportCache.key===key){exportPages=exportCache.pages;preview.replaceChildren(...exportPages);ready(exportCache.blob);return;}
      exportCache=null;
      try{
        // Paint the dialog before projection/engraving, and allow immediate cancel.
        await new Promise(resolve=>setTimeout(resolve,0));if(signal.aborted)return;
        const model=N.project(exportDraft,exportBpm,exportPref);
        const blob=await V.exportPdf(model,{mode,bpm:exportBpm,title:exportName,language,signal,
          footer:model.approximated?t('节奏按显示精度近似记谱','Rhythm approximated to the selected display grid'):'',
          onPage(page,index,total){if(ticket!==exportGeneration)return;page.querySelectorAll('.notation-hit').forEach(e=>e.remove());exportPages.push(page);preview.append(page);
            exportStatus.textContent=t('正在生成 PDF：'+(index+1)+' / '+total+' 页','Preparing PDF: '+(index+1)+' / '+total+' pages');},
        });
        if(ticket!==exportGeneration)return;
        exportCache={key,pages:exportPages,blob};ready(blob);
      }catch(err){if(ticket===exportGeneration && !signal.aborted){exportStatus.textContent=t('导出未完成，请重试。','Export did not finish. Please retry. ')+(err.message || '');retryButton.hidden=false;}}
    }
    function downloadPDF(){if(exportBlob)download(exportBlob,fileName()+'.pdf');}
    return {switchView,syncSelection,openExport,redoEdit};
  }
  root.H2SNotationController={create};
})(window);
