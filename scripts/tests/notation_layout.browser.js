/* Run with playwright-cli run-code --filename=... against a local Studio preview.
 * Uses the real VexFlow renderer: partial chord ties used to throw across systems.
 */
async page=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const results=await page.evaluate(async()=>{
    const N=H2SNotation,V=H2SNotationView;await V.load('staff');
    const note=(id,pitch,startBeat,durationBeat)=>({id,pitch,startBeat,durationBeat,velocity:90});
    const score=notes=>({version:2,time_signature:'4/4',tracks:[{id:'t',name:'Regression',notes}]});
    const cases=[
      score([60,64,67].map((p,i)=>note('cross'+i,p,7,3))),
      score([48,60,64,67].map((p,i)=>note('long'+i,p,0,44))),
      score([60,62,64].map((p,i)=>note('adjacent'+i,p,3.5,9))),
      score(Array.from({length:256},(_,i)=>[0,4,7,11].map((d,j)=>note('dense'+i+'-'+j,48+i%12+d,i*1.5,i%13===0?9.25:1.125))).flat()),
    ];
    const result=[];
    for(const [i,input] of cases.entries())for(const clef of ['treble','bass']){
      const before=JSON.stringify(input),model=N.project(input,120,{clef});
      for(const mode of ['staff','jianpu'])for(const width of [null,360,900,1700]){
        const options={mode,bpm:120,title:'Chord regression',...(width?{layout:'screen',width}:{})};
        const rendered=V.render(model,options);
        const ids=new Set(rendered.registry.flatMap(h=>h.refs.map(r=>r.noteId)));
        if(ids.size!==input.tracks[0].notes.length)throw Error('Dropped source notes');
        if(rendered.pages.some(p=>p.outerHTML.includes('NaN')))throw Error('Invalid SVG coordinates');
        const vb=rendered.pages[0].viewBox.baseVal;
        if(width && rendered.pages.some(p=>p.viewBox.baseVal.width!==width))throw Error('Screen pagination does not use available width');
        const plan=V.layout(model,options),last=V.render(model,{...options,plan,pageIndex:plan.pages.length-1});
        if(last.pages.length!==1 || last.pages[0].getAttribute('aria-label')!==rendered.pages.at(-1).getAttribute('aria-label'))throw Error('Lazy page differs from complete export');
        const idsOnLast=JSON.stringify(last.registry),lastHits=rendered.pages.at(-1).querySelectorAll('[data-hit]');
        if(idsOnLast!==JSON.stringify([...lastHits].map(h=>rendered.registry[Number(h.dataset.hit)])))throw Error('Lazy page lost source identities');
        if(!width && (vb.width!==794 || vb.height!==1123))throw Error('Print layout changed');
        if(JSON.stringify(input)!==before)throw Error('Projection or engraving mutated MIDI');
        result.push({case:i,clef,mode,width:width||'A4',pages:rendered.pages.length,notes:ids.size,height:vb.height});
      }
    }
    const input=score(Array.from({length:64},(_,i)=>note('flow'+i,60,i,1))),model=N.project(input,120,{});
    const narrow=V.render(model,{mode:'staff',layout:'screen',width:600}),wide=V.render(model,{mode:'staff',layout:'screen',width:1700});
    const height=r=>r.pages.reduce((n,p)=>n+p.viewBox.baseVal.height,0);
    if(height(wide)>=height(narrow))throw Error('Wider viewport must reflow to fewer systems');
    return {cases:result,narrowHeight:narrow.pages[0].viewBox.baseVal.height,wideHeight:wide.pages[0].viewBox.baseVal.height};
  });
  assert(results.cases.length===64,'Missing regression cases');
  return {status:'PASS',...results};
}
