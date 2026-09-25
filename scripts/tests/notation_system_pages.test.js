const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const N=require('../../static/pianoroll/core/notation.js');
const window={H2SNotation:N};
vm.runInNewContext(fs.readFileSync(require.resolve('../../static/pianoroll/ui/notation_view.js'),'utf8'),{window});
for(const mode of ['staff','jianpu'])for(const voices of [1,3,7,12]){
 const score={version:2,tracks:Array.from({length:voices},(_,v)=>({id:'v'+v,notes:Array.from({length:48},(_,i)=>({id:'n'+v+'-'+i,pitch:48+v,startBeat:i,durationBeat:.75,velocity:80}))}))};
 const original=JSON.stringify(score),model=N.project(score,120,{});
 for(const width of [360,900,1700]){
  const plan=window.H2SNotationView.layout(model,{mode,layout:'screen',width});
  const owners=new Map();
  plan.pages.forEach((p,index)=>{
   for(const row of p.rows){
    if(owners.has(row.bar))assert.equal(owners.get(row.bar),index,'A time system was split across screen pages');
    owners.set(row.bar,index);assert.ok(row.y+row.height<p.height);
   }
  });
  assert.equal(plan.pages.flatMap(p=>p.rows).length,owners.size*voices,'Missing voice');
  if(voices>=7)assert.ok(plan.pages.some(p=>p.height>1123),'Tall system should expand screen page');
 }
 const print=window.H2SNotationView.layout(model,{mode});
 print.pages.forEach(p=>{assert.equal(p.height,1123);p.rows.forEach(r=>assert.ok(r.y+r.height<=1050));});
 if(voices>=7){
  const labels=print.pages.flatMap(p=>p.rows.filter(r=>r.systemLabel).map(r=>r.systemLabel));
  assert.ok(labels.some(l=>l.parts>1),'Oversized A4 system must identify continuation');
  for(const p of print.pages)assert.ok(p.rows.every(r=>r.bar===p.rows[0].bar),'Continuation mixed with new system');
 }
 assert.equal(JSON.stringify(score),original);
}
console.log('PASS complete time-system pagination, tall screen pages and explicit A4 continuations');
