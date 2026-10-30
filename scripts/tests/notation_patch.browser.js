/* Compare incremental ink with complete real-renderer output, including ties. */
async page=>page.evaluate(async()=>{
 const N=H2SNotation,V=H2SNotationView;await V.load('staff');
 const score={version:2,tracks:[{id:'t',notes:[60,64,67].map((pitch,i)=>({id:'chord'+i,pitch,startBeat:0,durationBeat:44,velocity:90})).concat(Array.from({length:64},(_,i)=>({id:'tail'+i,pitch:60+i%5,startBeat:44+i,durationBeat:1,velocity:90})))}]};
 const edited=N.edit(score,[{trackId:'t',noteId:'chord0'}],{pitch:62},120);
 const ink=svg=>{const copy=svg.cloneNode(true);copy.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));copy.querySelectorAll('.notation-hit').forEach(e=>e.remove());return new XMLSerializer().serializeToString(copy);};
 const cases=[];
 for(const clef of ['treble','bass'])for(const mode of ['staff','jianpu'])for(const width of [360,1700]){
  const model=N.project(score,120,{clef}),next=N.project(edited,120,{clef}),options={mode,layout:'screen',width,bpm:120},plan=V.layout(model,options);
  const rebound={...plan,pages:plan.pages.map(p=>({...p,rows:p.rows.map(r=>({...r,lane:next.lanes.find(l=>l.trackId===r.lane.trackId && l.index===r.lane.index)}))}))};
  let preserved=0,changed=0;
  for(let pageIndex=0;pageIndex<plan.pages.length;pageIndex++){
   const original=V.render(model,{...options,plan,pageIndex}).pages[0],rows=[...original.querySelectorAll('[data-notation-row]')];
   const patched=V.render(next,{...options,plan:rebound,pageIndex,reusePage:original});
   const full=V.render(next,{...options,plan:rebound,pageIndex});
   if(patched.pages[0]!==original)throw Error('Page root replaced');
   if(ink(patched.pages[0])!==ink(full.pages[0]))throw Error('Incremental ink differs: '+JSON.stringify({clef,mode,width,pageIndex}));
   if(JSON.stringify(patched.registry)!==JSON.stringify(full.registry))throw Error('Incremental source identities differ');
   for(const row of rows){if(row.parentNode===original)preserved++;else changed++;}
  }
  if(!preserved || !changed)throw Error('Fixture must cover changed ties and unchanged tail');
  cases.push({clef,mode,width,pages:plan.pages.length,preserved,changed});
 }
 return {status:'PASS',cases};
})
