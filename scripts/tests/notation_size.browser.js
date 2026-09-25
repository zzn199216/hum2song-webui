/* Local isolated project only: time-system grouping, zoom geometry and editing. */
async page=>{
 const check=(v,s)=>{if(!v)throw Error(s);};
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 await page.evaluate(()=>{H2SApp.state.modal.draftScore={tracks:Array.from({length:7},(_,v)=>({id:'v'+v,name:'Voice '+(v+1),notes:Array.from({length:48},(_,i)=>({id:'n'+v+'-'+i,pitch:60+v,start:i*.6,duration:.45,velocity:80}))}))};});
 const original=await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v));
 const results=[];
 for(const mode of ['staff','jianpu']){
  await page.locator('[data-view="'+mode+'"]').click();
  await page.locator('#notationSize').selectOption('100');
  await page.waitForFunction(()=>document.querySelector('#notationSurface svg .notation-system-label'));
  await page.waitForFunction(()=>Math.abs(document.querySelector('#notationSurface svg').getScreenCTM().d-1)<.02);
  const before=await page.locator('#notationSurface svg').first().evaluate(svg=>({height:svg.getBoundingClientRect().height,scale:svg.getScreenCTM().d,rows:[...svg.querySelectorAll('[data-notation-row]')].map(e=>JSON.parse(e.dataset.notationRow)),label:svg.querySelector('.notation-system-label').textContent}));
  check(before.rows.length===7 && before.rows.every(r=>r[2]===before.rows[0][2]),'Seven simultaneous voices must share one screen page');
  await page.locator('#notationSize').selectOption('50');
  await page.waitForFunction(()=>{const svg=document.querySelector('#notationSurface svg');return svg && Math.abs(svg.getScreenCTM().d-.5)<.02;});
  const after=await page.locator('#notationSurface svg').first().evaluate(svg=>({height:svg.getBoundingClientRect().height,slot:svg.parentElement.getBoundingClientRect().height}));
  check(after.height<before.height*.65 && Math.abs(after.height-after.slot)<2,'Zoom must shrink score and its page slot together');
  await page.screenshot({path:'output/playwright/system-size-'+mode+'.png'});
  // Scaled coordinate mapping must still select and edit exactly one pitch.
  const glyph=page.locator('#notationSurface '+(mode==='staff'?'.vf-notehead path':'.notation-degree')).first();
  await glyph.scrollIntoViewIfNeeded();
  const point=await glyph.evaluate((e,mode)=>{const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,step:e.ownerSVGElement.getScreenCTM().d*(mode==='staff'?5:12)};},mode);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y-point.step*2);await page.mouse.up();
  await page.waitForFunction(()=>H2SApp.state.modal.draftScore.tracks[0].notes[0].pitch===64);
  await page.getByRole('button',{name:/^(撤销|Undo)$/}).click();
  check(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Zoom/edit undo changed other MIDI');
  const seek=await page.locator('#notationSurface svg').first().evaluate(svg=>{const row=H2SNotationView.playbackRows(svg)[0],a=row.anchors.find(a=>a.beat>=2),p=new DOMPoint(a.x,row.top-9).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y,sec:a.beat*.6};});
  await page.mouse.click(seek.x,seek.y);
  check(await page.evaluate(sec=>Math.abs(H2SApp.state.modal.cursorSec-sec)<.03,seek.sec),'Zoom broke seek coordinates');
  results.push({mode,before,after});
  await page.locator('#notationSize').selectOption('100');
 }
 await page.locator('#notationSize').selectOption('75');
 await page.getByRole('button',{name:/^(取消|Cancel)$/}).click();
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 check(await page.locator('#notationSize').inputValue()==='75','Size lost between clips');
 await page.locator('[data-view="staff"]').click();
 await page.locator('#notationSize').selectOption('100');
 await page.getByRole('button',{name:/^(取消|Cancel)$/}).click();
 return {status:'PASS',results,zoomEditing:true,zoomSeeking:true,sizeRemembered:true};
}
