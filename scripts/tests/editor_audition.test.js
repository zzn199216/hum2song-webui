const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
// Exercise asynchronous audio startup and gesture cancellation without devices.
const element=()=>({setAttribute(){},append(){},addEventListener(){},querySelectorAll(){return [];}});
const pending=[],voices=[],errors=[];
const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}});
const context={currentTime:1,destination:{},createOscillator(){const o={frequency:param(),connect(){},disconnect(){},start(){o.started=true;},stop(){o.stopped=true;}};voices.push(o);return o;},createGain(){return {gain:param(),connect(){},disconnect(){}};}};
const root={addEventListener(){},Tone:{start:()=>new Promise(resolve=>pending.push(resolve)),getContext:()=>({rawContext:context})}};
const document={querySelector:element,createElement:element};
const rt={state:{modal:{show:true,mode:'none'}},modalPointerDown(){},modalPointerMove(){},modalPointerUp(){},modalStop(){}};
vm.runInNewContext(fs.readFileSync('static/pianoroll/ui/editor_audition.js','utf8'),{window:root,document});
(async()=>{
  const api=root.H2SEditorAudition.create(rt,e=>errors.push(e));
  const first=api.play(60,90);api.stop();pending.shift()();await first;
  assert.equal(voices.length,0,'released gesture cannot play late after audio unlock');
  const old=api.play(60,90),latest=api.play(62,90);pending.shift()();pending.shift()();await Promise.all([old,latest]);
  assert.equal(voices.length,1,'only latest pitch plays during async startup');
  assert.equal(voices[0].started,true);
  await api.play(62,90);assert.equal(pending.length,0,'same pitch is not retriggered');
  api.setEnabled(false);await api.play(64,90);assert.equal(pending.length,0,'muted audition never starts audio');
  api.setEnabled(true);const closing=api.play(65,90);api.dispose();pending.shift()();await closing;
  assert.equal(voices.length,1,'closed editor cannot produce delayed preview');
  assert.equal(errors.length,0);
  console.log('PASS editor audition: async cancellation, last pitch wins, deduplication, mute, disposal');
})().catch(e=>{console.error(e);process.exitCode=1;});
