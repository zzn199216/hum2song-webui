/* Engraving only. No playback, persistence, or independent score state. */
(function(root){
  'use strict';
  const NS='http://www.w3.org/2000/svg', N=root.H2SNotation;
  function el(tag,attrs,text){
    const e=document.createElementNS(NS,tag);
    for(const [k,v] of Object.entries(attrs || {})) e.setAttribute(k,String(v));
    if(text!=null) e.textContent=text;
    return e;
  }
  function text(svg,x,y,value,size,extra){
    const e=el('text',Object.assign({x,y,fill:'#253246','font-size':size || 14,'font-family':'Arial, Microsoft YaHei, sans-serif'},extra || {}),value); svg.append(e); return e;
  }
  const loading={};
  function load(name){
    const filenames={staff:'vexflow-4.2.5.js',pdf:'jspdf-4.2.1.js'};
    if(name==='staff' && root.Vex) return Promise.resolve();
    if(name==='pdf' && root.jspdf) return Promise.resolve();
    if(!loading[name]) loading[name]=new Promise((resolve,reject)=>{
      const s=document.createElement('script'); s.src='/static/pianoroll/vendor/notation/'+filenames[name];
      s.onload=resolve; s.onerror=()=>{delete loading[name];s.remove();reject(new Error('Unable to load notation library'));};document.head.append(s);
    });
    return loading[name];
  }
  function hit(svg,registry,token,x,y,w,h,ref){
    const index=registry.length;
    const refs=ref?[ref]:token.refs;
    registry.push({refs,trackId:token.trackId,beat:token.from/16,duration:token.ticks/16});
    const rect=el('rect',{x,y,width:w,height:h,rx:5,fill:'transparent',class:'notation-hit','data-hit':index,'data-note':refs.length>0,tabindex:0,role:'button',
      'aria-label':refs.length?'Note '+refs.map(r=>r.pitch).join(', ')+' · beat '+(token.from/16+1):'Rest · beat '+(token.from/16+1)});
    svg.append(rect);
  }
  // Plan without creating SVG nodes, so the editor can engrave visible pages only.
  function layout(model,options){
    const o=options || {}, mode=o.mode || 'staff';
    const screen=o.layout==='screen';
    const pageWidth=screen?Math.max(320,Math.floor(Number(o.width)||794)):794;
    const margin=screen?(pageWidth<600?20:36):46, contentWidth=pageWidth-margin*2;
    const rows=[];
    // Dense measures receive a complete line instead of squeezed symbols.
    for(let bar=0;bar<model.bars;){
      const dense=model.lanes.some(l=>(l.bars[bar] || []).length>10 || (l.bars[bar+1] || []).length>10);
      let count=dense?1:Math.min(2,model.bars-bar);
      if(screen){
        // Reflow measures at a constant glyph size; do not stretch an A4 image.
        count=0;let required=mode==='staff'?90:0;
        while(bar+count<model.bars && count<8){
          const events=Math.max(...model.lanes.map(l=>(l.bars[bar+count] || []).length));
          const measure=Math.max(180,events*(mode==='staff'?26:30)+36);
          if(count && required+measure>contentWidth)break;
          required+=measure;count++;
        }
      }
      for(const lane of model.lanes){
        if(lane.index && !lane.bars.slice(bar,bar+count).some(events=>events.some(e=>!e.rest))) continue;
        rows.push({lane,bar,count});
      }
      bar+=count;
    }
    if(rows.length>320) throw new Error('Too many score pages. Split this clip before exporting.');
    const pageRowsList=[[]];let nextY=146;
    for(const row of rows){
      const events=row.lane.bars.slice(row.bar,row.bar+row.count).flat();
      row.offset=0;row.noteBase=85;row.height=174;
      if(mode==='staff'){
        const low=model.pref.clef==='bass'?18:30;
        const ys=events.flatMap(e=>e.refs.map(r=>{const s=N.spelling(r.pitch,model.pref.key).key.split('/');return 87-('cdefgab'.indexOf(s[0])+Number(s[1])*7-low)*5;}));
        const high=ys.length?Math.min(...ys):40, bottom=ys.length?Math.max(...ys):100;
        row.offset=Math.max(0,28-high);row.height+=row.offset+Math.max(0,bottom-120);
      }else{
        const chord=Math.max(1,...events.map(e=>e.refs.length));
        row.noteBase+=(chord-1)*30;row.height+=(chord-1)*30;
      }
      if(row.height>880)throw new Error('This chord is too large to fit a score page. Use the piano roll to split it.');
      if(nextY+row.height>1050 && pageRowsList[pageRowsList.length-1].length){pageRowsList.push([]);nextY=146;}
      row.y=nextY;pageRowsList[pageRowsList.length-1].push(row);nextY+=row.height;
    }
    return {pageWidth,margin,contentWidth,screen,mode,pages:pageRowsList.map(rows=>({rows,height:screen?Math.max(300,...rows.map(r=>r.y+r.height+64)):1123}))};
  }
  function render(model,options){
    const o=options || {}, plan=o.plan || layout(model,o), pages=[],registry=[];
    const {pageWidth,margin,contentWidth,screen,mode}=plan,pageCount=plan.pages.length;
    const first=o.pageIndex==null?0:o.pageIndex,end=o.pageIndex==null?pageCount:first+1;
    for(let pageIndex=first;pageIndex<end;pageIndex++){
      const pageHeight=plan.pages[pageIndex].height;
      let svg,ctx,VF;
      if(mode==='staff'){
        VF=root.Vex.Flow;
        const host=document.createElement('div'), r=new VF.Renderer(host,VF.Renderer.Backends.SVG);
        r.resize(pageWidth,pageHeight);ctx=r.getContext();ctx.setFillStyle('#253246');ctx.setStrokeStyle('#253246');svg=host.querySelector('svg');
      }else svg=el('svg',{xmlns:NS,width:pageWidth,height:pageHeight});
      svg.setAttribute('viewBox','0 0 '+pageWidth+' '+pageHeight);svg.setAttribute('class','notation-page'+(screen?' notation-screen':''));svg.setAttribute('aria-label',(o.title || 'Clip')+' · '+(pageIndex+1));
      svg.prepend(el('rect',{width:pageWidth,height:pageHeight,fill:'#fffefa'}));
      text(svg,margin,43,'HUM2SONG  /  '+(mode==='staff'?'STAFF':'NUMBERED NOTATION'),10,{'letter-spacing':2,fill:'#718096'});
      const title=String(o.title || 'Untitled clip');
      const titleLimit=screen?Math.max(14,Math.floor(contentWidth/16)):48;
      text(svg,margin,81,title.length>titleLimit?title.slice(0,titleLimit-1)+'…':title,26,{'font-weight':600});
      text(svg,margin,109,(mode==='jianpu'?'1 = '+model.pref.key+'    ':'')+model.meter.text+'    ♩ = '+o.bpm,13);
      text(svg,pageWidth-margin,109,(pageIndex+1)+' / '+pageCount,12,{'text-anchor':'end',fill:'#718096'});
      const pageRows=plan.pages[pageIndex].rows;
      for(const [ri,row] of pageRows.entries()){
        const y=row.y+row.offset;
        text(svg,margin,row.y-6,row.lane.name+(row.lane.index?' · '+(row.lane.index+1):''),10,{fill:'#718096'});
        let previous=null,previousNumberX=null;
        for(let bi=0;bi<row.count;bi++){
          const bar=row.bar+bi,tokens=row.lane.bars[bar],x=margin+bi*(contentWidth/row.count),width=contentWidth/row.count;
          text(svg,x+4,y+10,bar+1,10,{fill:'#8994a3'});
          if(mode==='staff'){
            const stave=new VF.Stave(x,y+7,width).setContext(ctx);
            if(bi===0) stave.addClef(model.pref.clef).addKeySignature(model.pref.key).addTimeSignature(model.meter.text);
            stave.draw();
            const keyAlters={};
            [0,2,4,5,7,9,11].forEach(step=>{const s=N.spelling(60+N.KEYS[model.pref.key]+step,model.pref.key);keyAlters[s.key[0]]=s.alter;});
            const accidentalState=new Map();
            const notes=tokens.map(token=>{
              const spell=token.refs.map(r=>N.spelling(r.pitch,model.pref.key));
              const note=new VF.StaveNote({clef:model.pref.clef,keys:token.rest?[model.pref.clef==='bass'?'d/3':'b/4']:spell.map(s=>s.key),duration:token.duration+(token.rest?'r':''),dots:token.dots,auto_stem:true});
              if(!token.rest) spell.forEach((s,i)=>{
                const current=accidentalState.has(s.key)?accidentalState.get(s.key):(keyAlters[s.key[0]] || 'n');
                if(s.alter!==current)note.addModifier(new VF.Accidental(s.alter),i);
                accidentalState.set(s.key,s.alter);
              });
              if(token.dots) VF.Dot.buildAndAttach([note],{all:true});
              return note;
            });
            const voice=new VF.Voice({num_beats:model.meter.n,beat_value:model.meter.d}).setStrict(false).addTickables(notes);
            // Beam generation can rebuild noteheads when assigning stem direction.
            // Do it before drawing; otherwise the new heads still have x=0 while
            // the SVG contains the old heads at their formatted positions.
            const beams=VF.Beam.generateBeams(notes);
            new VF.Formatter().joinVoices([voice]).format([voice],Math.max(60,stave.getNoteEndX()-stave.getNoteStartX()-28));
            voice.draw(ctx,stave);
            beams.forEach(b=>b.setContext(ctx).draw());
            notes.forEach((note,i)=>{
              const token=tokens[i], xx=note.getAbsoluteX(), ys=note.getYs();
              if(token.tieIn && previous){
                new VF.StaveTie({first_note:previous,last_note:note,first_indices:token.refs.map((_,i)=>i),last_indices:token.refs.map((_,i)=>i)}).setContext(ctx).draw();
              }else if(token.tieIn){
                // VexFlow defaults the omitted side to [0], even for partial ties.
                // Both index arrays must cover the chord at a system/page boundary.
                const indices=token.refs.map((_,i)=>i);
                new VF.StaveTie({last_note:note,first_indices:indices,last_indices:indices}).setContext(ctx).draw();
              }
              if(token.tieOut && i===tokens.length-1 && bi===row.count-1){
                const indices=token.refs.map((_,i)=>i);
                new VF.StaveTie({first_note:note,first_indices:indices,last_indices:indices}).setContext(ctx).draw();
              }
              if(token.rest) hit(svg,registry,token,xx-6,y+38,22,35);
              else token.refs.forEach((ref,j)=>{
                // Adjacent chord tones are only half a staff-space apart. Keep
                // their hit areas separate and follow displaced noteheads.
                const height=Math.min(16,...ys.filter(v=>v!==ys[j]).map(v=>Math.abs(v-ys[j])));
                const head=note.noteHeads.find(h=>h.getY()===ys[j]);
                hit(svg,registry,token,(head?head.getAbsoluteX():xx)-5,ys[j]-height/2,22,height,ref);
              });
              previous=token.tieOut?note:null;
            });
          }else{
            const left=x+20,usable=width-42;
            svg.append(el('line',{x1:x+width,y1:y+27,x2:x+width,y2:y+row.height-55,stroke:'#8994a3','stroke-width':1}));
            const weights=tokens.map(token=>Math.max(1,token.ticks/16));
            const weightTotal=weights.reduce((a,b)=>a+b,0);let consumed=0;
            tokens.forEach((token,i)=>{
              // Readable proportional spacing, shared rhythmic model with the staff renderer.
              const xx=left+(consumed+0.35)*usable/weightTotal,base=y+row.noteBase;
              consumed+=weights[i];
              const refs=token.rest?[null]:[...token.refs].sort((a,b)=>b.pitch-a.pitch);
              refs.forEach((ref,j)=>{
                const yy=base-(refs.length-1-j)*30;
                const sp=ref?N.spelling(ref.pitch,model.pref.key):null;
                text(svg,xx,yy,sp?String(sp.degree):'0',22,{'text-anchor':'middle','font-weight':500});
                if(sp && sp.accidental) text(svg,xx-12,yy-5,sp.accidental==='b'?'♭':'♯',13,{'text-anchor':'end'});
                if(sp) for(let k=0;k<Math.abs(sp.octave);k++) svg.append(el('circle',{cx:xx,cy:sp.octave>0?yy-24-k*5:yy+15+k*5,r:1.5,fill:'#253246'}));
                const lines=token.duration==='8'?1:token.duration==='16'?2:token.duration==='32'?3:token.duration==='64'?4:0;
                for(let k=0;k<lines;k++)svg.append(el('line',{x1:xx-7,y1:yy+5+k*4,x2:xx+7,y2:yy+5+k*4,stroke:'#253246','stroke-width':1.2}));
                if(token.dots && token.ticks<32)text(svg,xx+10,yy,'·',19);
                if(token.ticks>=32){
                  const dashes=Math.floor(token.ticks/16)-1;
                  for(let k=0;k<dashes;k++)text(svg,xx+20+k*13,yy,'–',18);
                }
                hit(svg,registry,token,xx-13,yy-25,27,48,ref);
              });
              if(token.tieIn){const begin=previousNumberX==null?xx-23:previousNumberX;
                svg.append(el('path',{d:'M '+begin+' '+(y+28)+' Q '+((begin+xx)/2)+' '+(y+9)+' '+xx+' '+(y+28),fill:'none',stroke:'#253246','stroke-width':1.2}));}
              if(token.tieOut && i===tokens.length-1 && bi===row.count-1)svg.append(el('path',{d:'M '+xx+' '+(y+28)+' q 13 -15 27 0',fill:'none',stroke:'#253246','stroke-width':1.2}));
              previousNumberX=token.tieOut?xx:null;
            });
          }
        }
      }
      text(svg,margin,pageHeight-40,o.footer || '',10,{fill:'#718096'});
      if(screen)text(svg,pageWidth/2,pageHeight-18,(pageIndex+1)+' / '+pageCount,12,{'text-anchor':'middle',fill:'#718096'});
      // Ties and later voices must not cover interaction targets.
      svg.querySelectorAll('.notation-hit').forEach(h=>svg.append(h));
      pages.push(svg);
    }
    return {pages,registry};
  }
  function cleanSvg(svg){
    const copy=svg.cloneNode(true);copy.querySelectorAll('.notation-hit').forEach(e=>e.remove());
    copy.setAttribute('xmlns',NS);return new XMLSerializer().serializeToString(copy);
  }
  async function pdf(pages){
    await load('pdf');await document.fonts.ready;
    const doc=new root.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
    for(let i=0;i<pages.length;i++){
      const url=URL.createObjectURL(new Blob([cleanSvg(pages[i])],{type:'image/svg+xml'}));
      try{
        const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
        const canvas=document.createElement('canvas');canvas.width=1588;canvas.height=2246;
        canvas.getContext('2d').drawImage(img,0,0,1588,2246);
        if(i)doc.addPage();doc.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297);
        canvas.width=canvas.height=1;
      }finally{URL.revokeObjectURL(url);}
    }
    return doc.output('blob');
  }
  root.H2SNotationView={render,layout,load,pdf,cleanSvg};
})(window);
