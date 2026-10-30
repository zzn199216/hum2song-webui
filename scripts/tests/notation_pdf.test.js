'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../static/pianoroll/ui/notation_view.js'),'utf8');
function setup({vectorError=false,vectorHang=false,loadError=false,loadHang=false,fontError=false,fontHang=false,needsExtended=false}={}){
 const stats={pages:1,vectors:0,outputs:0,scripts:0,fonts:[],fontFetches:0};
 class PDF {
  constructor(){this.internal={pageSize:{getWidth:()=>595.28,getHeight:()=>841.89}};}
  addPage(){stats.pages++;}addImage(){throw Error('Score PDF must never contain raster images');}
  addFileToVFS(){}addFont(file,family){stats.fonts.push(family);}getFont(family){return {metadata:{characterToGlyph:()=>needsExtended&&family==='H2SScoreCommon'?0:1}};}
  svg(svg){assert(svg);if(vectorHang)return new Promise(()=>{});if(vectorError)return Promise.reject(new Error('vector failed'));stats.vectors++;return Promise.resolve();}
  output(){stats.outputs++;return new Blob(['%PDF-test']);}
 }
 const document={fonts:{ready:new Promise(()=>{}),add(){}},head:{append(script){stats.scripts++;if(loadHang)return;setTimeout(()=>{if(loadError)script.onerror();else{window.jspdf={jsPDF:PDF};window.svg2pdf={};script.onload();}},0);}},createElement(tag){assert.equal(tag,'script','No raster canvas may be created by exporter');return {remove(){}};}};
 const window={H2SNotation:{},...(loadError||loadHang?{}:{jspdf:{jsPDF:PDF},svg2pdf:{}})};
 class FontFace {constructor(family){this.family=family;}load(){return Promise.resolve(this);}}
 async function fetch(){stats.fontFetches++;if(fontHang)return new Promise(()=>{});if(fontError)throw Error('font failed');return {ok:true,arrayBuffer:()=>Promise.resolve(new Uint8Array([0,1,2]).buffer)};}
 vm.runInNewContext(source,{window,document,FontFace,fetch,Blob,Uint8Array,DOMException,setTimeout(fn,ms){return setTimeout(fn,ms>=15000?10:ms);},clearTimeout,AbortController});
 const text={textContent:'Score',setAttribute(){},style:{}};
 const page={querySelectorAll(){return [text];},cloneNode(){return {querySelectorAll(selector){return selector==='text,tspan'?[{...text,style:{},getAttribute(){return '600';}}]:[];}};}};
 return {V:window.H2SNotationView,stats,page};
}
(async()=>{
 const ok=setup(),progress=[];
 const blob=await ok.V.pdf(Array(3).fill(ok.page),{onProgress:(n,total)=>progress.push([n,total])});
 assert(blob.size>0);assert.deepEqual(progress,[[1,3],[2,3],[3,3]]);assert.equal(ok.stats.vectors,3);assert.equal(ok.stats.fontFetches,1);
 await ok.V.pdf([ok.page]);assert.equal(ok.stats.fontFetches,1,'Font bytes should be reused by later exports');
 const warmed=setup();await warmed.V.preparePdf();assert.equal(warmed.stats.fontFetches,1);
 await warmed.V.pdf([warmed.page]);assert.equal(warmed.stats.fontFetches,1,'Editor prewarm must be reused by export');
 const early=setup(),aborted=new AbortController();aborted.abort();
 await assert.rejects(early.V.pdf([early.page],{signal:aborted.signal}),{name:'AbortError'});assert.equal(early.stats.vectors,0);
 const mid=setup(),cancel=new AbortController();
 await assert.rejects(mid.V.pdf(Array(9).fill(mid.page),{signal:cancel.signal,onProgress(){cancel.abort();}}),{name:'AbortError'});
 assert.equal(mid.stats.vectors,1);assert.equal(mid.stats.outputs,0);
 for(const options of [{vectorError:true},{vectorHang:true},{fontError:true},{fontHang:true}]){
  const bad=setup(options);await assert.rejects(bad.V.pdf([bad.page]));assert.equal(bad.stats.outputs,0);
 }
 const rare=setup({needsExtended:true});await rare.V.pdf([rare.page]);assert.equal(rare.stats.fontFetches,2);assert(rare.stats.fonts.includes('H2SScoreExtended'));
 for(const options of [{loadError:true},{loadHang:true}]){
  const bad=setup(options);await assert.rejects(bad.V.pdf([bad.page]));await assert.rejects(bad.V.pdf([bad.page]));assert.equal(bad.stats.scripts,2,'Failed library request must be retryable');
 }
 await assert.rejects(ok.V.pdf([]),/No score pages/);
 console.log('PASS vector PDF export: no raster path, progress, cancellation, converter/font/library failures, bounded waits, retry and font cache/fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
