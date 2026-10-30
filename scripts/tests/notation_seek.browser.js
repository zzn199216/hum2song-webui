/* Local isolated project only. Exercise real score gestures and shared transport. */
async page=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg);};
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 const original=await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v));
 const results=[];
 for(const mode of ['staff','jianpu']){
  await page.locator('[data-view="'+mode+'"]').click();
  await page.waitForFunction(()=>document.querySelector('#notationSurface .notation-playhead'));
  await page.evaluate(()=>{document.querySelector('#notationSurface').scrollTop=0;});
  const target=await page.locator('#notationSurface svg').first().evaluate(svg=>{
   const row=H2SNotationView.playbackRows(svg)[0],a=row.anchors.find(a=>a.beat>=2),m=svg.getScreenCTM();
   const p=new DOMPoint(a.x,row.top-9).matrixTransform(m);
   return {x:p.x,y:p.y,sec:a.beat*60/H2SApp.getProjectV2().bpm};
  });
  await page.mouse.click(target.x,target.y);
  check(await page.evaluate(s=>Math.abs(H2SApp.state.modal.cursorSec-s)<.025,target.sec),'Blank score click must seek to engraved beat');
  const cap=page.locator('.notation-playhead:not([style*="none"]) .notation-seek-handle').first();
  const box=await cap.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(target.x+80,target.y,{steps:5});await page.mouse.up();
  const sought=await page.evaluate(()=>H2SApp.state.modal.cursorSec);
  check(sought>target.sec,'Drag cap must move shared cursor');
  await page.locator('#btnClipPlay').click();
  await page.waitForFunction(()=>H2SApp.state.modal.isPlaying && document.querySelector('#btnClipPlay').textContent==='Ⅱ',null,{timeout:5000}).catch(()=>{throw Error(mode+' Play did not enter playing state');});
  await page.mouse.click(target.x,target.y);
  await page.waitForFunction(s=>H2SApp.state.modal.isPlaying && H2SApp.state.modal.cursorSec>=s && H2SApp.state.modal.cursorSec<s+.5,target.sec,{timeout:5000}).catch(()=>{throw Error(mode+' live seek did not restart at target');});
  await page.locator('#btnClipPlay').click();
  const paused=await page.evaluate(()=>H2SApp.state.modal.cursorSec);
  await page.waitForTimeout(180);
  check(await page.evaluate(s=>!H2SApp.state.modal.isPlaying && H2SApp.state.modal.cursorSec===s,paused),'Pause retains exact position');
  await page.locator('#btnClipStop').click();
  check(await page.evaluate(()=>H2SApp.state.modal.cursorSec===0),'Stop while paused resets cursor');
  results.push({mode,seek:target.sec,drag:sought,pause:paused});
 }
 await page.locator('[data-view="roll"]').click();
 // Fast asynchronous starts, seek, and Stop must invalidate old audio sessions.
 await page.evaluate(()=>{const r=H2SApp.editorRt;r.modalPlay();r.modalStop(true);});
 await page.waitForTimeout(200);
 check(await page.evaluate(()=>!H2SApp.state.modal.isPlaying && H2SApp.state.modal.cursorSec===0),'Stop cancels a pending start');
 await page.evaluate(()=>{const r=H2SApp.editorRt;r.modalSeek(1);r.modalPlay();});
 await page.waitForFunction(()=>H2SApp.state.modal.isPlaying);
 await page.evaluate(()=>{H2SApp.editorRt.modalSeek(2);H2SApp.editorRt.modalSeek(3);H2SApp.editorRt.modalSeek(4);});
 await page.waitForFunction(()=>H2SApp.state.modal.isPlaying && H2SApp.state.modal.cursorSec>=4);
 await page.waitForTimeout(200);
 check(await page.evaluate(()=>H2SApp.state.modal.cursorSec>=4 && H2SApp.state.modal.cursorSec<5),'Only latest seek clock survives');
 await page.locator('#btnClipPlay').click();
 check(await page.evaluate(()=>!H2SApp.state.modal.isPlaying),'Roll Play toggles Pause');
 await page.locator('#btnClipStop').click();
 check(await page.evaluate(()=>H2SApp.state.modal.cursorSec===0),'Roll Stop resets');
 check(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Seeking changed MIDI');
 await page.getByRole('button',{name:/^(取消|Cancel)$/}).click();
 return {status:'PASS',results,rapidSeek:true,pendingStop:true,unchangedMidi:true};
}
