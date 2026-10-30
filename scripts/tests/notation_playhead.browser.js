/* Run against an isolated local QA project. Uses real playback plus deterministic beat probes. */
async page=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg);};
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 await page.evaluate(()=>{H2SApp.state.modal.draftScore={time_signature:'4/4',tracks:[{id:'play',name:'Melody',notes:Array.from({length:128},(_,i)=>({id:'n'+i,pitch:60+i%5,start:i*.6,duration:.3,velocity:50}))}]};});
 const original=await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v));
 const results=[];
 for(const mode of ['staff','jianpu']){
  await page.locator('[data-view="'+mode+'"]').click();
  await page.waitForFunction(()=>document.querySelector('#notationSurface .notation-playhead'));
  await page.evaluate(()=>{window.playQA={calls:0,render:H2SNotationView.render};H2SNotationView.render=function(...a){playQA.calls++;return playQA.render(...a);};H2SApp.state.modal.cursorSec=0;});
  // Real transport is the source of cursor time; no separate notation clock.
  await page.locator('#btnClipPlay').click();
  await page.waitForFunction(()=>H2SApp.state.modal.isPlaying && [...document.querySelectorAll('.notation-playhead')].some(e=>e.style.display!=='none'));
  const start=await page.evaluate(()=>({sec:H2SApp.state.modal.cursorSec,calls:playQA.calls,x:document.querySelector('.notation-playhead:not([style*="none"])').getAttribute('transform')}));
  await page.waitForFunction(x=>document.querySelector('.notation-playhead:not([style*="none"])')?.getAttribute('transform')!==x,start.x);
  check(await page.evaluate(()=>playQA.calls)===start.calls,'Moving playhead must not re-engrave score');
  await page.locator('#btnClipPlay').click();
  await page.waitForFunction(()=>!H2SApp.state.modal.isPlaying && !!document.querySelector('.notation-playhead:not([style*="none"])') && !document.querySelector('#notationSurface .is-playing'));
  const stopped=await page.evaluate(async()=>{
   const marker=document.querySelector('.notation-playhead:not([style*="none"])'),x=marker.getAttribute('transform'),sec=H2SApp.state.modal.cursorSec;
   let changes=0;const observer=new MutationObserver(records=>changes+=records.length);observer.observe(marker,{attributes:true});
   await new Promise(resolve=>setTimeout(resolve,200));observer.disconnect();
   return {sec,unchanged:sec===H2SApp.state.modal.cursorSec && x===marker.getAttribute('transform'),changes};
  });
  check(stopped.sec>0 && stopped.unchanged && stopped.changes===0,'Paused cursor must remain still without animation');
  await page.locator('#btnClipPlay').click();
  await page.waitForFunction(sec=>H2SApp.state.modal.isPlaying && H2SApp.state.modal.cursorSec>sec,stopped.sec);
  await page.locator('#btnClipStop').click();
  check(await page.evaluate(()=>H2SApp.state.modal.cursorSec===0 && !H2SApp.state.modal.isPlaying),'Stop must reset playback to zero');
  // Probe the middle of a rest, next system, and a later page without waiting a minute.
  const steps=await page.evaluate(()=>{const model=H2SNotation.project(H2SApp.state.modal.draftScore,100,{view:document.getElementById('modal').dataset.noteView}),s=document.querySelector('#notationSurface'),css=getComputedStyle(s),width=Math.max(320,Math.floor(s.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight))),plan=H2SNotationView.layout(model,{mode:document.getElementById('modal').dataset.noteView,layout:'screen',width});return {next:plan.pages[0].rows[1].bar*4+.25,later:plan.pages[1].rows[0].bar*4+.25};});
  await page.evaluate(()=>{H2SApp.state.modal.isPlaying=true;H2SApp.state.modal.cursorSec=.75*.6;H2SApp.editorRt.modalRequestDraw();});
  await page.waitForFunction(()=>[...document.querySelectorAll('.notation-playhead')].some(e=>e.style.display!== 'none') && !document.querySelector('#notationSurface .is-playing'));
  const rest=await page.evaluate(()=>({playingNotes:document.querySelectorAll('#notationSurface .is-playing').length,marker:!!document.querySelector('.notation-playhead:not([style*="none"])')}));
  check(rest.marker && rest.playingNotes===0,'Playhead must continue through rests');
  for(const beat of [steps.next,steps.later]){
   await page.evaluate(beat=>{H2SApp.state.modal.cursorSec=beat*.6;},beat);
   await page.waitForFunction(()=>{const s=document.querySelector('#notationSurface'),b=s.getBoundingClientRect();return [...s.querySelectorAll('.notation-playhead')].some(e=>{const r=e.getBoundingClientRect();return e.style.display!=='none' && r.top>=b.top && r.top<b.bottom;});});
  }
  await page.waitForFunction(()=>document.querySelector('.notation-page-position').textContent.includes('2'));
  const state=await page.evaluate(()=>({page:document.querySelector('.notation-page-position').textContent,mounted:document.querySelectorAll('#notationSurface svg').length,svgExportClean:!H2SNotationView.cleanSvg(document.querySelector('#notationSurface svg')).includes('notation-playhead')}));
  check(state.mounted<=3 && state.svgExportClean,'Playback must preserve lazy pages and clean export');
  await page.evaluate(()=>{H2SApp.state.modal.isPlaying=false;H2SApp.editorRt.modalRequestDraw();H2SNotationView.render=playQA.render;});
  await page.waitForFunction(()=>!!document.querySelector('.notation-playhead:not([style*="none"])') && !document.querySelector('#notationSurface .is-playing'));
  results.push({mode,realTransport:true,rests:true,stoppedCursor:true,resumes:true,idleMarkerMutations:stopped.changes,...state});
 }
 check(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Playback changed MIDI');
 const tabs=[];
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  const gaps=await page.locator('.notation-tabs').evaluate(e=>{const bs=[...e.children].map(b=>b.getBoundingClientRect());return [bs[1].left-bs[0].right,bs[2].left-bs[1].right];});
  check(gaps.every(g=>g>=6),'Tabs visually touch');tabs.push({width,gaps});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('[data-view="staff"]').click();
 await page.waitForFunction(()=>document.querySelector('#notationSurface .vf-notehead'));
 await page.evaluate(()=>{H2SApp.state.modal.isPlaying=true;H2SApp.state.modal.cursorSec=.15;H2SApp.editorRt.modalRequestDraw();});
 await page.waitForFunction(()=>document.querySelector('.notation-playhead:not([style*="none"])'));
 await page.screenshot({path:'output/playwright/notation-playhead-staff.png'});
 await page.locator('[data-view="roll"]').click();
 check(await page.locator('#notationSurface').isHidden(),'Roll switch keeps score hidden');
 await page.locator('#btnClipStop').click();
 await page.getByRole('button',{name:/^(取消|Cancel)$/}).click();
 return {status:'PASS',results,tabs,unchangedMidi:true};
}
