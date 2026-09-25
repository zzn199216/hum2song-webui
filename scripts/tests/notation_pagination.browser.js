/* Run in an isolated local QA project with a clip available. Never writes a project. */
async page=>{
 const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
 await page.setViewportSize({width:1920,height:1080});
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 await page.locator('#btnModalMaximize').click();
 await page.evaluate(()=>{
  const rt=H2SApp.editorRt;rt.state.modal.draftScore={time_signature:'4/4',tracks:[{id:'dense',name:'Dense regression',notes:Array.from({length:943},(_,i)=>({id:'n'+i,pitch:48+i%24,start:Math.floor(i/4)*.45,duration:(i%17===0?3:.625)*.6,velocity:90}))}]};
  window.pageQA={calls:0,original:H2SNotationView.render};H2SNotationView.render=function(...args){pageQA.calls++;return pageQA.original(...args);};
 });
 const original=await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v));
 await page.locator('[data-view="staff"]').click();
 await page.locator('#notationSurface .vf-notehead path').first().waitFor();
 const initial=await page.evaluate(()=>({pages:document.querySelectorAll('.notation-page-slot').length,mounted:document.querySelectorAll('#notationSurface svg').length,calls:pageQA.calls}));
 assert(initial.pages>1 && initial.mounted<initial.pages,'Must only engrave visible pages');
 // The previous implementation wrote every note class on every idle animation frame.
 const idle=await page.evaluate(async()=>{let changes=0;const ob=new MutationObserver(ms=>changes+=ms.length);ob.observe(document.querySelector('#notationSurface'),{subtree:true,attributes:true,attributeFilter:['class']});await new Promise(r=>setTimeout(r,500));ob.disconnect();return changes;});
 assert(idle===0,'Idle notation changes DOM every frame');
 await page.locator('.notation-pager button').last().click();
 await page.locator('[data-page="2"] svg').waitFor();
 assert((await page.locator('.notation-page-position').innerText()).includes('2'),'Bottom page indicator did not follow navigation');
 const callsBeforeReturn=await page.evaluate(()=>pageQA.calls);
 await page.locator('.notation-pager button').first().click();
 await page.locator('[data-page="1"] svg').waitFor();
 assert(await page.evaluate(()=>pageQA.calls)===callsBeforeReturn,'Unchanged cached page was re-engraved');
 await page.evaluate(()=>{H2SApp.state.modal.isPlaying=true;H2SApp.state.modal.cursorSec=0;H2SApp.editorRt.modalRequestDraw();});
 await page.waitForFunction(()=>document.querySelector('#notationSurface .is-playing'));
 await page.evaluate(()=>{H2SApp.state.modal.isPlaying=false;H2SApp.editorRt.modalRequestDraw();});
 await page.waitForFunction(()=>!document.querySelector('#notationSurface .is-playing'));
 await page.locator('.notation-pager button').last().click();
 await page.locator('[data-page="2"] svg').waitFor();
 const hit=page.locator('[data-page="2"] [data-note="true"]').first();
 await hit.scrollIntoViewIfNeeded();
 const point=await hit.evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,step:e.ownerSVGElement.getScreenCTM().d*5};});
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y-point.step*2);await page.mouse.up();
 const after=await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v));
 assert(after!==original,'Dragging a later page did not update MIDI');
 await page.getByRole('button',{name:/^(撤销|Undo)$/}).click();
 assert(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Undo failed after lazy page drag');
 await page.getByRole('button',{name:/^(重做|Redo)$/}).click();
 assert(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===after,'Redo failed');
 await page.getByRole('button',{name:/^(撤销|Undo)$/}).click();
 const widths=[];
 for(const mode of ['staff','jianpu']){
  await page.locator('[data-view="'+mode+'"]').click();
  for(const width of [390,1000,1920]){
   await page.setViewportSize({width,height:1080});
   await page.waitForFunction(()=>{const s=document.querySelector('#notationSurface'),svg=s.querySelector('svg');if(!svg)return false;const css=getComputedStyle(s);return svg.viewBox.baseVal.width===Math.max(320,Math.floor(s.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)));});
   const state=await page.evaluate(()=>{const s=document.querySelector('#notationSurface');return {overflow:s.scrollWidth-s.clientWidth,pages:s.children.length,mounted:s.querySelectorAll('svg').length};});
   assert(state.overflow<=1,'Horizontal overflow');assert(state.mounted<=3,'Too many pages mounted');widths.push({mode,width,...state});
  }
  await page.evaluate(()=>{const s=document.querySelector('#notationSurface');s.scrollTop=s.scrollHeight;});
  await page.waitForFunction(()=>{const s=document.querySelector('#notationSurface');return s.lastElementChild.querySelector('svg');});
  const atEnd=await page.evaluate(()=>({text:document.querySelector('.notation-page-position').textContent,pages:document.querySelector('#notationSurface').children.length,disabled:document.querySelector('.notation-pager button:last-child').disabled}));
  assert(atEnd.disabled && atEnd.text.includes(String(atEnd.pages)),'Last page indicator incorrect');
  await page.screenshot({path:'output/playwright/pagination-'+mode+'.png'});
 }
 assert(await page.evaluate(()=>JSON.stringify(H2SApp.state.modal.draftScore,(k,v)=>k.startsWith('_')?undefined:v))===original,'Navigation or reflow modified MIDI');
 await page.locator('[data-view="staff"]').click();
 await page.getByRole('button',{name:/^(取消|Cancel)$/}).click();
 await page.evaluate(()=>{H2SNotationView.render=pageQA.original;delete window.pageQA;});
 return {status:'PASS',notes:943,initial,idleClassMutations:idle,cachedPageReuse:true,playbackHighlight:true,latePageDragUndoRedo:true,widths};
}
