/* Real gestures and SVG identity checks. Run only in an isolated local QA project. */
async page=>{
 const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 await page.evaluate(()=>{H2SApp.state.modal.draftScore={time_signature:'4/4',tracks:[{id:'edit',name:'Melody',notes:Array.from({length:128},(_,i)=>({id:'n'+i,pitch:60+i%5,start:i*.6,duration:.6,velocity:90}))}]};});
 const original=await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v));
 const results=[];
 for(const mode of ['staff','jianpu']){
  await page.locator('[data-view="'+mode+'"]').click();
  await page.waitForFunction(mode=>document.querySelector('#notationSurface '+(mode==='staff'?'.vf-notehead':'.notation-degree')),mode);
  await page.evaluate(()=>{document.querySelector('#notationSurface').scrollTop=0;});
  const glyph=page.locator('#notationSurface '+(mode==='staff'?'.vf-notehead path':'.notation-degree')).first();
  await glyph.scrollIntoViewIfNeeded();
  const point=await glyph.evaluate((e,mode)=>{const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,step:e.ownerSVGElement.getScreenCTM().d*(mode==='staff'?5:12)};},mode);
  await page.evaluate(()=>{
   const s=document.querySelector('#notationSurface'),svg=s.querySelector('svg'),rows=[...svg.querySelectorAll('[data-notation-row]')];
   const raw=Tone.getContext().rawContext;
   window.localEditQA={svg,slot:svg.parentElement,rows,blankFrames:0,frames:0,frequencies:[],raw,create:raw.createOscillator};
   raw.createOscillator=function(){const osc=localEditQA.create.call(this),set=osc.frequency.setValueAtTime;osc.frequency.setValueAtTime=function(f,...args){localEditQA.frequencies.push(f);return set.call(this,f,...args);};return osc;};
   const tick=()=>{localEditQA.frames++;if(!localEditQA.slot.querySelector('svg'))localEditQA.blankFrames++;localEditQA.raf=requestAnimationFrame(tick);};localEditQA.raf=requestAnimationFrame(tick);
  });
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  assert(await page.locator('#notationSurface .is-selected').count()>0,'Pointer down must highlight note');
  await page.mouse.move(point.x,point.y-point.step*2);
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 64 · beat 1"]'));
  await page.waitForFunction(()=>localEditQA.frequencies.some(f=>Math.abs(f-329.627557)<.01));
  const during=await page.evaluate(()=>({samePage:localEditQA.svg===localEditQA.slot.querySelector('svg'),unchangedRows:localEditQA.rows.slice(1).every(r=>r.isConnected),changedRow:!localEditQA.rows[0].isConnected,pitch:H2SApp.state.modal.draftScore.tracks[0].notes[0].pitch,degree:document.querySelector('.notation-degree')?.textContent}));
  assert(during.samePage && during.unchangedRows && during.changedRow && during.pitch===64,'Edit must replace only the affected system: '+JSON.stringify(during));
  if(mode==='jianpu')assert(during.degree==='3','Numbered pitch digit must update while holding');
  // Keep dragging through an octave, then cancel the entire gesture.
  await page.mouse.move(point.x,point.y-point.step*7);
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 72 · beat 1"]'));
  await page.waitForFunction(()=>localEditQA.frequencies.some(f=>Math.abs(f-523.251131)<.01));
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 60 · beat 1"]'));
  assert(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Esc must restore exact draft');
  const metrics=await page.evaluate(()=>{cancelAnimationFrame(localEditQA.raf);localEditQA.raw.createOscillator=localEditQA.create;return {blankFrames:localEditQA.blankFrames,frames:localEditQA.frames,frequencies:localEditQA.frequencies,samePage:localEditQA.svg===localEditQA.slot.querySelector('svg')};});
  assert(metrics.blankFrames===0 && metrics.frames>0 && metrics.samePage,'No empty score frame during drag/cancel');
  // A committed gesture is exactly one undo, and redo restores the final pitch.
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y-point.step*2);await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 64 · beat 1"]'));
  await page.getByRole('button',{name:/^(撤销|Undo)$/}).click();
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 60 · beat 1"]'));
  assert(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Single undo restores gesture');
  await page.getByRole('button',{name:/^(重做|Redo)$/}).click();
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 64 · beat 1"]'));
  await page.getByRole('button',{name:/^(撤销|Undo)$/}).click();
  await page.waitForFunction(()=>document.querySelector('[data-note="true"][aria-label="Note 60 · beat 1"]'));
  results.push({mode,...during,...metrics});
 }
 await page.getByRole('button',{name:/^(取消|Cancel)$/}).click();
 return {status:'PASS',results,escUndoRedo:true};
}
