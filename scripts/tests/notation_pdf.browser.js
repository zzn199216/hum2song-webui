/* playwright-cli run-code --filename=... in an isolated local Studio profile.
 * Synthetic score only. No server requests, cloud saves or processing jobs. */
async page=>{
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 await page.waitForFunction(()=>window.H2SApp && H2SApp.editorRt);
 await page.evaluate(()=>{
  const score={version:2,tracks:[{id:'melody',name:'旋律 Melody',notes:Array.from({length:720},(_,i)=>({id:'n'+i,pitch:60+i%12,startBeat:i*.5,durationBeat:.4,velocity:80}))}]};
  H2SApp.setProjectFromV2({version:2,timebase:'beat',bpm:120,tracks:[{id:'t',trackId:'t',name:'PDF QA',instrument:'piano',gainDb:0,muted:false}],clips:{qa:{id:'qa',name:'乐谱导出 · PDF regression',revisionId:'qa-revision',parentRevisionId:null,revisions:{},score,meta:{}}},clipOrder:['qa'],instances:[{id:'i',clipId:'qa',trackId:'t',startBeat:0,transpose:0,gainDb:0}],ui:{pxPerBeat:60,playheadBeat:0}});
  window.pdfQA={source:JSON.stringify(H2SApp.getProjectV2()),calls:0,aborts:0,pages:0,progress:0};
  const original=H2SNotationView.exportPdf;
  H2SNotationView.exportPdf=function(model,options){pdfQA.calls++;const onPage=options.onPage;return original(model,{...options,onPage(...args){pdfQA.pages++;if(onPage)onPage(...args);},onProgress(){pdfQA.progress++;}}).catch(e=>{if(e.name==='AbortError')pdfQA.aborts++;throw e;});};
 });
 await page.getByRole('button',{name:/^(编辑|Edit)$/}).first().click();
 const open=page.getByRole('button',{name:/^(导出乐谱|Export score)$/}),dialog=page.locator('dialog.notation-export');
 const pdf=dialog.getByRole('button',{name:/^(下载 PDF|Download PDF)$/}),back=dialog.getByRole('button',{name:/^(返回编辑|Back to editing)$/});
 const ready=()=>page.waitForFunction(()=>{const d=document.querySelector('dialog.notation-export');return d.open && d.querySelector('a') && ![...d.querySelectorAll('button')].find(b=>/^(下载 PDF|Download PDF)$/.test(b.textContent)).disabled;});
 const times=[];
 for(const mode of ['staff','jianpu']){
  if(!(await dialog.isVisible()))await open.click();
  await dialog.locator('select').selectOption(mode);const start=Date.now();await ready();
  assert(await dialog.locator('.notation-export-pages > svg').count()===12,'Missing pages');
  const downloadEvent=page.waitForEvent('download');await pdf.click();const download=await downloadEvent;
  assert(!(await download.failure()),'Browser download failed');
  await download.saveAs('output/playwright/notation-pdf-'+mode+'.pdf');
  times.push({mode,ms:Date.now()-start});
 }
 await back.click();
 // Editor default is staff, so cache its completed export and reopen it unchanged.
 await open.click();await ready();const cachedCalls=await page.evaluate(()=>pdfQA.calls);
 await back.click();await open.click();await ready();
 assert(await page.evaluate(()=>pdfQA.calls)===cachedCalls,'Unchanged export regenerated');
 // Changing a source note invalidates the cache and exports current draft data.
 await back.click();await page.evaluate(()=>{H2SApp.state.modal.draftScore.tracks[0].notes[0].pitch=72;});
 await open.click();await ready();assert(await page.evaluate(()=>pdfQA.calls)===cachedCalls+1,'Edited draft reused stale PDF');
 await back.click();
 // A failed vector converter must expose retry; no partial PDF can download.
 await page.evaluate(()=>{H2SApp.state.modal.draftScore.tracks[0].notes[0].pitch=73;window.originalSvg=jspdf.jsPDF.API.svg;jspdf.jsPDF.API.svg=()=>Promise.reject(new DOMException('Injected internal conversion abort','AbortError'));});
 await open.click();const retry=dialog.getByRole('button',{name:/^(重试|Retry)$/});await retry.waitFor({state:'visible'});
 assert(await pdf.isDisabled(),'Partial PDF downloadable');
 await page.evaluate(()=>{jspdf.jsPDF.API.svg=originalSvg;});await retry.click();await ready();
 // Force cancellation between pages; reopen and switch mode without stale results.
 await back.click();await page.evaluate(()=>{H2SApp.state.modal.draftScore.tracks[0].notes[0].pitch=74;jspdf.jsPDF.API.svg=function(...args){return new Promise(resolve=>setTimeout(resolve,150)).then(()=>originalSvg.apply(this,args));};});
 await open.click();await page.waitForFunction(()=>document.querySelector('.notation-export-pages svg'));
 const abortsBeforeClose=await page.evaluate(()=>pdfQA.aborts);
 await back.click();await page.waitForFunction(n=>pdfQA.aborts>n,abortsBeforeClose);
 await page.evaluate(()=>{jspdf.jsPDF.API.svg=originalSvg;});
 await open.click();await dialog.locator('select').selectOption('jianpu');await ready();
 assert(await dialog.locator('.notation-export-pages > svg').count()===12,'Stale export appended extra pages');
 assert((await dialog.locator('.notation-export-pages > svg').first().textContent()).includes('NUMBERED NOTATION'),'Wrong format won race');
 const sourceIntact=await page.evaluate(()=>JSON.stringify(H2SApp.getProjectV2())===pdfQA.source);
 assert(sourceIntact,'Export changed canonical project');
 await page.screenshot({path:'output/playwright/notation-pdf-preview.png'});
 await back.click();
 return {status:'PASS',times,cacheReuse:true,draftInvalidation:true,retry:true,cancel:true,formatRace:true,sourceIntact,...await page.evaluate(()=>({calls:pdfQA.calls,aborts:pdfQA.aborts,pages:pdfQA.pages,progress:pdfQA.progress}))};
}
