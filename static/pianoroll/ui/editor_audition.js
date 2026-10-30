/* One short preview voice shared by note gestures and the roll keyboard.
 * It never schedules Tone.Transport or writes to the score/history. */
(function(root){
  'use strict';
  function create(rt,onError){
    let voice=null,enabled=true,active=null,request=0,keyboardPointer=null,rollPointer=null,layout='';
    const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
    const grid=document.querySelector('.editorGridWrap'),inner=document.querySelector('.editorGridInner');
    const keyboard=document.createElement('div');keyboard.className='editor-piano-keys';
    keyboard.setAttribute('role','group');keyboard.setAttribute('aria-label','Piano preview keyboard');inner.append(keyboard);
    function highlight(){keyboard.querySelectorAll('[data-pitch]').forEach(b=>b.classList.toggle('is-sounding',Number(b.dataset.pitch)===active));}
    async function play(pitch,velocity){
      pitch=Math.round(Number(pitch));
      if(!enabled || !Number.isFinite(pitch) || pitch<0 || pitch>127 || pitch===active)return;
      active=pitch;highlight();const ticket=++request;
      try{
        if(!root.Tone)throw new Error('Audio engine unavailable');
        await root.Tone.start();
        if(ticket!==request || !enabled || !rt.state.modal.show)return;
        // Use the existing audio context with its current clock. A native short
        // voice avoids the transport look-ahead and cold synth initialization.
        releaseVoice();
        const context=root.Tone.getContext().rawContext,now=context.currentTime;
        const oscillator=context.createOscillator(),gain=context.createGain();
        oscillator.type='triangle';oscillator.frequency.setValueAtTime(440*Math.pow(2,(pitch-69)/12),now);
        const level=0.2*Math.max(0.1,Math.min(1,(Number(velocity)||90)/127));
        gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(level,now+0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+0.32);
        oscillator.connect(gain);gain.connect(context.destination);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
        oscillator.start(now);oscillator.stop(now+0.34);voice={oscillator,gain,context};
      }catch(err){if(ticket===request){active=null;highlight();if(onError)onError(err);}}
    }
    function releaseVoice(){if(!voice)return;const {oscillator,gain,context}=voice;voice=null;const now=context.currentTime;gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0,now,0.008);oscillator.stop(now+0.04);}
    function stop(){request++;active=null;releaseVoice();highlight();}
    function dispose(){stop();keyboardPointer=null;rollPointer=null;}
    function setEnabled(value){enabled=!!value;if(!enabled)stop();}
    function syncKeyboard(){
      const m=rt.state.modal,w=rt.modalPitchWindow(),C=root.H2SEditorCoords;
      const rowH=Math.max(10,Number(m.rowH)||16),padT=C?C.padT(m):m.padT,padL=C?C.padL(m):m.padL;
      const key=[w.pitchMin,w.pitchMax,rowH,padT,padL].join(':');
      keyboard.style.transform='translateX('+grid.scrollLeft+'px)';
      if(key===layout)return;layout=key;keyboard.replaceChildren();keyboard.style.width=padL+'px';
      keyboard.style.height=(padT+(w.pitchMax-w.pitchMin+1)*rowH)+'px';keyboard.style.setProperty('--keys-top',padT+'px');
      for(let p=w.pitchMax;p>=w.pitchMin;p--){
        const black=[1,3,6,8,10].includes(p%12),name=names[p%12]+(Math.floor(p/12)-1);
        const b=document.createElement('button');b.type='button';b.dataset.pitch=p;
        b.className='editor-piano-key '+(black?'is-black':'is-white');
        b.style.top=(padT+(w.pitchMax-p)*rowH)+'px';b.style.height=rowH+'px';
        b.textContent=p%12===0?name:'';b.title=name;b.setAttribute('aria-label','Preview '+name);
        b.addEventListener('keydown',e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat){rt.modalStop();play(p,90);}}});
        b.addEventListener('keyup',e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();stop();}});
        b.addEventListener('blur',stop);keyboard.append(b);
      }
      highlight();
    }
    grid.addEventListener('scroll',()=>{keyboard.style.transform='translateX('+grid.scrollLeft+'px)';},{passive:true});
    function keyAt(e){const b=document.elementFromPoint(e.clientX,e.clientY);return b && b.closest('.editor-piano-key');}
    keyboard.addEventListener('pointerdown',e=>{
      if(e.button!==0 || keyboardPointer!==null)return;
      const b=keyAt(e);if(!b)return;e.preventDefault();rt.modalStop();keyboardPointer=e.pointerId;
      keyboard.setPointerCapture(e.pointerId);play(Number(b.dataset.pitch),90);
    });
    keyboard.addEventListener('pointermove',e=>{if(e.pointerId!==keyboardPointer)return;const b=keyAt(e);if(b)play(Number(b.dataset.pitch),90);else stop();});
    function endKeys(){keyboardPointer=null;rollPointer=null;stop();}
    keyboard.addEventListener('pointerup',endKeys);keyboard.addEventListener('pointercancel',endKeys);keyboard.addEventListener('lostpointercapture',endKeys);
    root.addEventListener('blur',endKeys);
    // The original roll retains ownership of hit-testing, movement, and undo.
    const down=rt.modalPointerDown.bind(rt),move=rt.modalPointerMove.bind(rt),up=rt.modalPointerUp.bind(rt);
    function previewDragged(){const m=rt.state.modal;if(m.mode!=='drag_note')return;const r=m.selection && m.selection.noteRefs[0];const n=r && rt.modalFindNoteById(r.noteId,r.trackId);if(n)play(n.note.pitch,n.note.velocity);}
    rt.modalPointerDown=function(e){down(e);if(rt.state.modal.mode==='drag_note'){rt.modalStop();rollPointer=e.pointerId;previewDragged();}};
    rt.modalPointerMove=function(e){move(e);if(rollPointer!==null && rollPointer===e.pointerId)previewDragged();};
    rt.modalPointerUp=function(e){up(e);rollPointer=null;stop();};
    const stopTransport=rt.modalStop.bind(rt);
    rt.modalStop=function(...args){stop();return stopTransport(...args);};
    root.addEventListener('pointercancel',endKeys);
    return {play,stop,dispose,setEnabled,syncKeyboard};
  }
  root.H2SEditorAudition={create};
})(window);
