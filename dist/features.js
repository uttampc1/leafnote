(async function(){
  'use strict';
  const Ink=LeafInk;
  let db=null,saveQueue=Promise.resolve(),saveVersion=0,pageIndex=0,zoom=1,renderTicket=0,renderTask=null,pdfSource=null,pdfReady=false;
  let active=null,paintFrame=0,lastPen=0,pan=null,activeText=null;
  const undoStack=[],redoStack=[];
  const original={validate,loadNote,resizePage,renderList,export:$('#export').onclick};
  const clone=x=>structuredClone(x);
  const page=()=>note()?.pdf?.pages[pageIndex];
  const strokes=()=>page()?.strokes||note()?.strokes||[];
  const annotations=()=>page()?.texts||note()?.texts||[];
  const textMeasure=document.createElement('canvas').getContext('2d');
  function textFont(t){return t.font==='monospace'?'monospace':'Arial, sans-serif';}
  function textLines(t){textMeasure.font=`${t.size}px ${textFont(t)}`;const lines=[];for(const raw of t.text.replace(/\t/g,'    ').split('\n')){let line='';for(const char of raw){if(line&&textMeasure.measureText(line+char).width>(t.width||Math.max(30,($('#canvas').viewBox.baseVal.width||800)-t.x-12))){lines.push(line);line='';}line+=char;}lines.push(line);}return lines;}
  function validTexts(list){if(!Array.isArray(list)||list.length>10000)throw Error('Invalid text data');return list.map(t=>{if(![t.x,t.y,t.size].every(Number.isFinite))throw Error('Invalid text position');return {x:t.x,y:t.y,size:Math.max(8,Math.min(72,t.size)),text:String(t.text).slice(0,100000).replace(/\t/g,'    '),color:/^#[a-f0-9]{6}$/i.test(t.color)?t.color:'#264c3d',font:t.font==='monospace'?'monospace':'sans-serif',width:Number.isFinite(t.width)?Math.max(20,Math.min(20000,t.width)):undefined,lineHeight:[1,1.5,2].includes(t.lineHeight)?t.lineHeight:1.5};});}
  function plainFromHTML(html){const d=document.createElement('div');d.innerHTML=clean(html);d.querySelectorAll('br').forEach(el=>el.replaceWith(document.createTextNode('\n')));d.querySelectorAll('p,div,h2,h3,li,blockquote').forEach(el=>el.append(document.createTextNode('\n')));return d.textContent.replace(/^\n+|\n+$/g,'');}
  function syncPlainText(){const n=note();if(!n.pdf)n.html=annotations().map(t=>'<p>'+escapeText(t.text).replace(/\n/g,'<br>')+'</p>').join('');countWords();}
  function countPaperWords(){const text=[...annotations().map(t=>t.text),...(note()?.board?.nodes||[]).map(n=>n.text)].join(' ').trim();$('#words').textContent=note()?.pdf?note().pdf.pages.length+' pages':(text?text.split(/\s+/).length:0)+' words';}
  function sizeBlank(){if(note()?.pdf)return;const b=note().board,h=b?.height||note().height||1050,w=b?.width||800;let scale;if(b){scale=window.LeafBoard?.scale()||.65;$('#sheet').style.width=w*scale+'px';}else scale=($('#surface').getBoundingClientRect().width||600)/800;$('#surface').style.height=h*scale+'px';$('#canvas').setAttribute('viewBox',`0 0 ${w} ${h}`);}
  function positionTextEditor(){if(!activeText)return;const t=activeText.item,field=$('#papertext'),vb=$('#canvas').viewBox.baseVal,scale=$('#surface').getBoundingClientRect().width/vb.width;field.style.left=t.x/vb.width*100+'%';field.style.top=(t.y-t.size*.83)/vb.height*100+'%';field.style.width=t.width*scale+'px';field.style.fontFamily=textFont(t);field.style.fontSize=t.size*scale+'px';field.style.lineHeight=String(t.lineHeight||1.5);field.style.color=t.color;field.style.height=Math.max(t.size*(t.lineHeight||1.5)*scale*textLines(t).length+5,field.scrollHeight)+'px';}
  function updateText(){if(!activeText)return;activeText.item.text=$('#papertext').value.slice(0,100000);if(!note().pdf){const t=activeText.item,bottom=t.y+textLines(t).length*t.size*(t.lineHeight||1.5)+24;if(note().board){note().board.height=Math.max(note().board.height,Math.ceil(bottom));}else note().height=Math.max(note().height||1050,Math.ceil(bottom));sizeBlank();}positionTextEditor();syncPlainText();touch();redraw();}
  function commitText(){if(!activeText)return;const editing=activeText;activeText=null;const field=$('#papertext');if(field){field.onblur=null;field.remove();}if(!editing.item.text){const list=annotations(),i=list.indexOf(editing.item);if(i>=0)list.splice(i,1);}syncPlainText();if(JSON.stringify(editing.before)!==JSON.stringify(snapshot())){remember(editing.before);touch();}redraw();}
  function textStyleTarget(){return activeText?{kind:'paper',noteId:current,page:pageIndex,item:activeText.item}:window.LeafBoard?.textStyleTarget?.()||null;}
  function setTextStyle(style,target){if(!target)return false;const patch={};if(/^#[a-f0-9]{6}$/i.test(style.color||''))patch.color=style.color;if(Number.isFinite(style.size)&&style.size>=8&&style.size<=72)patch.size=style.size;if([1,1.5,2].includes(style.lineHeight))patch.lineHeight=style.lineHeight;if(!Object.keys(patch).length)return false;if(target.kind==='board')return window.LeafBoard?.setTextStyle(patch,target)||false;if(target.noteId!==current||target.page!==pageIndex||!annotations().includes(target.item))return false;if(Object.entries(patch).every(([k,v])=>target.item[k]===v))return true;const before=snapshot();Object.assign(target.item,patch);if(activeText?.item===target.item)updateText();else{if(!note().pdf){const t=target.item,bottom=t.y+textLines(t).length*t.size*(t.lineHeight||1.5)+24;if(note().board)note().board.height=Math.max(note().board.height,Math.ceil(bottom));else note().height=Math.max(note().height||1050,Math.ceil(bottom));sizeBlank();}remember(before);touch();redraw();}return true;}
  function setTextColor(color,target){return setTextStyle({color},target);}
  function beginText(p){commitText();const list=annotations(),hit=[...list].reverse().find(t=>{const lines=textLines(t),width=Math.min(t.width||800,Math.max(20,...lines.map(line=>{textMeasure.font=`${t.size}px ${textFont(t)}`;return textMeasure.measureText(line).width;})));return p[0]>=t.x-5&&p[0]<=t.x+width+5&&p[1]>=t.y-t.size&&p[1]<=t.y+(lines.length-1)*t.size*(t.lineHeight||1.5)+8;});
    const before=snapshot(),vb=$('#canvas').viewBox.baseVal,item=hit||{x:Math.max(4,Math.min(vb.width-30,p[0])),y:Math.max(18,p[1]+14),size:Number($('#textsize').value),lineHeight:Number($('#textspacing').value),text:'',color:$('#textcolor').value,font:'monospace'};if(!item.width)item.width=Math.max(24,Math.min(note().board?900:20000,vb.width-item.x-12));if(!hit)list.push(item);activeText={item,before};const field=document.createElement('textarea');field.id='papertext';field.setAttribute('aria-label','Plain text on paper');field.setAttribute('spellcheck','false');field.value=item.text;$('#surface').append(field);positionTextEditor();field.oninput=updateText;field.onblur=commitText;field.onkeydown=e=>{e.stopPropagation();if(e.key==='Tab'){e.preventDefault();const start=field.selectionStart,end=field.selectionEnd;field.setRangeText('    ',start,end,'end');updateText();}if(e.key==='Escape'||(e.key==='Enter'&&(e.ctrlKey||e.metaKey))){e.preventDefault();commitText();}};field.focus();field.setSelectionRange(field.value.length,field.value.length);redraw();}
  const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const complete=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Storage transaction cancelled'));tx.onerror=()=>{};});
  function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('leafnote',1);req.onupgradeneeded=()=>{req.result.createObjectStore('state');req.result.createObjectStore('pdfs');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('Close other Leafnote tabs and reload to update storage.'));});}
  async function getFile(id){if(!db)throw Error('Document storage is unavailable');return request(db.transaction('pdfs').objectStore('pdfs').get(id));}
  function writeState(snapshot,files=[],prune=false){const tx=db.transaction(['state','pdfs'],'readwrite'),done=complete(tx);tx.objectStore('state').put(snapshot,'notebook');const documents=tx.objectStore('pdfs');for(const [id,file] of files)documents.put(file,id);if(prune){const keep=new Set(snapshot.notes.filter(n=>n.pdf).map(n=>n.id)),keys=documents.getAllKeys();keys.onsuccess=()=>{for(const id of keys.result)if(!keep.has(id))documents.delete(id);};}return done;}
  persist=function(){
    const version=++saveVersion,snapshot=clone(data);$('#saved').textContent='Saving…';
    saveQueue=saveQueue.catch(()=>{}).then(async()=>{try{if(db)await writeState(snapshot);else{if(snapshot.notes.some(n=>n.pdf))throw Error('PDF storage is unavailable');localStorage.setItem(KEY,JSON.stringify(snapshot));}if(version===saveVersion)$('#saved').textContent='Saved on device';return true;}catch(e){$('#saved').textContent='Not saved';toast('Could not save. Export a backup before closing this tab. '+e.message);return false;}});return saveQueue;
  };
  function validStrokes(list){if(!Array.isArray(list)||list.length>100000)throw Error('Invalid drawing data');return list.map(s=>{if(!Array.isArray(s.points)||!s.points.length||s.points.length>500000||!s.points.every(p=>Array.isArray(p)&&(p.length===2||p.length===3)&&p.every(Number.isFinite)))throw Error('Invalid ink points');return {color:/^#[a-f0-9]{6}$/i.test(s.color)?s.color:'#264c3d',width:Math.max(.5,Math.min(50,Number(s.width)||3)),opacity:s.brush==='pencil'?Math.max(.1,Math.min(1,Number(s.opacity)||.68)):s.opacity===.3?.3:1,pressure:!!s.pressure,points:s.points.map(p=>p.slice()),...(s.brush==='pencil'?{brush:'pencil',grade:Ink.pencilGrades[s.grade]?s.grade:'HB'}:{})};});}
  validate=function(value){
    const raw=value?.notes;if(!Array.isArray(raw))throw Error('Invalid backup');
    const result=original.validate({...value,notes:raw.map(n=>({...n,strokes:[]}))});delete result.files;delete result.version;
    result.notes.forEach((n,i)=>{n.strokes=validStrokes(raw[i].strokes||[]);if(Array.isArray(raw[i].texts))n.texts=validTexts(raw[i].texts);n.height=Number.isFinite(raw[i].height)?Math.max(1050,Math.min(100000,raw[i].height)):1050;n.recognitionLanguage=raw[i].recognitionLanguage==='mr'?'mr':'en';n.board=LeafBoardEngine.valid(raw[i].board);n.handwriting=LeafSearch.validIndex(raw[i].handwriting);const p=raw[i].pdf;if(!p)return;if(!Array.isArray(p.pages)||!p.pages.length||p.pages.length>1000)throw Error('Invalid PDF pages');n.pdf={name:String(p.name||'Document.pdf').slice(0,250),pages:p.pages.map(pg=>{if(!Number.isFinite(pg.width)||!Number.isFinite(pg.height)||pg.width<=0||pg.height<=0||pg.width>20000||pg.height>20000)throw Error('Invalid page dimensions');return {width:pg.width,height:pg.height,strokes:validStrokes(pg.strokes||[]),texts:validTexts(pg.texts||[]),recognitionLanguage:pg.recognitionLanguage==='mr'?'mr':'en',pdfText:typeof pg.pdfText==='string'?pg.pdfText.slice(0,1000000):undefined,handwriting:LeafSearch.validIndex(pg.handwriting)};})};});return result;
  };
  pathFor=function(s){const p=document.createElementNS(NS,'path');p.setAttribute('fill',s.color);p.setAttribute('fill-opacity',s.opacity);p.setAttribute('d',Ink.outline(s));return p;};
  function textElement(t){const el=document.createElementNS(NS,'text');el.setAttribute('x',t.x);el.setAttribute('y',t.y);el.setAttribute('font-family',textFont(t));el.setAttribute('font-size',t.size);el.setAttribute('fill',t.color);el.setAttribute('xml:space','preserve');el.style.whiteSpace='pre';textLines(t).forEach((line,i)=>{const span=document.createElementNS(NS,'tspan');span.setAttribute('x',t.x);span.setAttribute('y',t.y+i*t.size*(t.lineHeight||1.5));span.textContent=line||' ';el.append(span);});return el;}
  redraw=function(){const c=$('#canvas');c.replaceChildren();window.LeafBoard?.paint(c,note()?.board);for(const s of strokes())c.append(pathFor(s));for(const t of annotations()){const el=textElement(t);if(activeText?.item===t)el.setAttribute('visibility','hidden');c.append(el);}countPaperWords();};
  function snapshot(){return {strokes:clone(strokes()),texts:clone(annotations()),board:note()?.board?clone(note().board):undefined};}
  function applySnapshot(s,id=current,index=pageIndex){const n=data.notes.find(n=>n.id===id);if(!n)return;if(n.pdf){n.pdf.pages[index].strokes=clone(s.strokes);n.pdf.pages[index].texts=clone(s.texts);}else{n.strokes=clone(s.strokes);n.texts=clone(s.texts);n.board=s.board?clone(s.board):undefined;resizePage();syncPlainText();}redraw();touch();}
  function remember(before){undoStack.push({id:current,page:note().pdf?pageIndex:-1,before,after:snapshot()});if(undoStack.length>150)undoStack.shift();redoStack.length=0;}
  $('#undo').onclick=()=>{finishInput();const i=undoStack.findLastIndex(h=>h.id===current&&h.page===(note().pdf?pageIndex:-1));if(i<0){toast('No annotations to undo on this page');return;}const h=undoStack.splice(i,1)[0];redoStack.push(h);applySnapshot(h.before);};
  $('#redo').onclick=()=>{finishInput();const i=redoStack.findLastIndex(h=>h.id===current&&h.page===(note().pdf?pageIndex:-1));if(i<0){toast('No annotations to redo on this page');return;}const h=redoStack.splice(i,1)[0];undoStack.push(h);applySnapshot(h.after);};
  function updateInput(){
    $('#surface').classList.toggle('drawing',tool!=='text');$('#surface').classList.add('ink-active');$('#editor').contentEditable=false;$('#editor').hidden=true;$('#format').hidden=tool!=='text';
    $('#hint').textContent=tool==='text'?'Click anywhere to type · Tab indents · Enter starts a new line':'Write freely with your pen or mouse';
  }
  function setTool(value){finishInput();tool=value;$$('[data-tool]').forEach(b=>{b.classList.toggle('selected',b.dataset.tool===value);b.setAttribute('aria-pressed',b.dataset.tool===value);});updateInput();}
  document.addEventListener('click',e=>{const t=e.target.closest('[data-tool]');if(t)setTool(t.dataset.tool);});
  let preferences={pressure:true,mode:'pen'};try{preferences={...preferences,...JSON.parse(localStorage.getItem('leafnote-input')||'{}')};}catch{}
  $('#pressure').checked=preferences.pressure;$('#inputmode').value=['pen','all','stylus'].includes(preferences.mode)?preferences.mode:'pen';
  function savePreferences(){finishInput();try{localStorage.setItem('leafnote-input',JSON.stringify({pressure:$('#pressure').checked,mode:$('#inputmode').value}));}catch{}}
  $('#pressure').onchange=savePreferences;$('#inputmode').onchange=savePreferences;
  function coord(e){const vb=$('#canvas').viewBox.baseVal;return Ink.sample(e,$('#canvas').getBoundingClientRect(),vb.width,vb.height);}
  function paint(){paintFrame=0;if(active?.stroke&&active.path?.isConnected)active.path.setAttribute('d',Ink.outline(active.stroke));else redraw();}
  function queuePaint(){if(!paintFrame)paintFrame=requestAnimationFrame(paint);}
  function erase(p){const n=note(),remaining=strokes().filter(s=>!Ink.hits(s,p,10));if(n.pdf)page().strokes=remaining;else n.strokes=remaining;queuePaint();}
  function addSamples(e){const events=e.getCoalescedEvents?.()||[];for(const sample of events.length?events:[e]){const p=coord(sample),points=active.stroke.points,prev=points.at(-1);if(!prev||Math.hypot(p[0]-prev[0],p[1]-prev[1])>.25)points.push(p);}queuePaint();}
  function finishInput(cancel=false){
    window.LeafBoard?.finish();commitText();if(!active)return;const old=active;active=null;try{if($('#canvas').hasPointerCapture(old.pointerId))$('#canvas').releasePointerCapture(old.pointerId);}catch{}
    if(cancel){if(note()?.pdf){page().strokes=old.before.strokes;page().texts=old.before.texts;}else if(note()){note().strokes=old.before.strokes;note().texts=old.before.texts;}}else{remember(old.before);touch();}
    if(paintFrame){cancelAnimationFrame(paintFrame);paintFrame=0;}redraw();lastPen=Date.now();
  }
  const surface=$('#surface'),canvas=$('#canvas');
  // Replace the original pointer handlers so only the captured pointer can modify ink.
  canvas.onpointerdown=async e=>{
    if(note().pdf&&!pdfReady)return;
    const mode=$('#inputmode').value;
    if(e.pointerType==='pen'){lastPen=Date.now();$('#inputhint').textContent='Stylus connected · pressure supported when reported by your pen';}
    if(e.pointerType==='touch'&&mode!=='all'){
      if(!active&&Date.now()-lastPen>800&&!pan){pan={id:e.pointerId,x:e.clientX,y:e.clientY,top:$('.workspace').scrollTop,left:$('.workspace').scrollLeft};canvas.setPointerCapture(e.pointerId);}return;
    }
    if(mode==='stylus'&&e.pointerType!=='pen'||active||e.button!==0&&e.button!==5)return;
    if(tool==='text'){
      e.preventDefault();beginText(coord(e));return;
    }
    e.preventDefault();pan=null;canvas.setPointerCapture(e.pointerId);
    active={pointerId:e.pointerId,before:snapshot(),erase:tool==='eraser'||e.button===5||(e.buttons&32)!==0};
    if(active.erase){erase(coord(e));return;}
    const pencil=tool==='pen'&&$('#writingkind').value==='pencil',grade=$('#pencilgrade').value,profile=Ink.pencilGrades[grade]||Ink.pencilGrades.HB;active.stroke={color:$('#color').value,width:pencil?profile.width:Number($('#width').value)*(tool==='highlighter'?5:1),opacity:tool==='highlighter'?.3:pencil?profile.opacity:1,pressure:tool==='pen'&&e.pointerType==='pen'&&$('#pressure').checked,points:[coord(e)],...(pencil?{brush:'pencil',grade}:{})};strokes().push(active.stroke);active.path=pathFor(active.stroke);canvas.append(active.path);queuePaint();
  };
  canvas.onpointermove=e=>{
    if(e.pointerType==='pen')lastPen=Date.now();
    if(pan?.id===e.pointerId){if(active||Date.now()-lastPen<800)return;$('.workspace').scrollTop=pan.top+pan.y-e.clientY;$('.workspace').scrollLeft=pan.left+pan.x-e.clientX;return;}
    if(!active||e.pointerId!==active.pointerId)return;e.preventDefault();if(active.erase)erase(coord(e));else addSamples(e);
  };
  canvas.onpointerup=e=>{if(pan?.id===e.pointerId)pan=null;if(active?.pointerId!==e.pointerId)return;if(!active.erase)addSamples(e);finishInput();};
  canvas.onpointercancel=e=>{if(pan?.id===e.pointerId)pan=null;if(active?.pointerId===e.pointerId)finishInput(true);};
  canvas.onlostpointercapture=e=>{if(active?.pointerId===e.pointerId)finishInput();if(pan?.id===e.pointerId)pan=null;};
  canvas.oncontextmenu=e=>e.preventDefault();canvas.ondragstart=e=>e.preventDefault();
  document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,[contenteditable="true"],dialog'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'#redo':'#undo').click();}if(e.key.toLowerCase()==='p')setTool('pen');if(e.key.toLowerCase()==='e')setTool('eraser');});
  async function pdfLibrary(){const lib=await import('./vendor/pdf.mjs');lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',location.href).href;return lib;}
  function pdfOptions(bytes){return {data:new Uint8Array(bytes),cMapUrl:new URL('./vendor/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',location.href).href,wasmUrl:new URL('./vendor/wasm/',location.href).href,iccUrl:new URL('./vendor/iccs/',location.href).href,isEvalSupported:false,enableXfa:false};}
  function pdfBusy(text){pdfReady=false;$('#pdfstatus').textContent=text;$('#surface').classList.add('pdf-loading');}
  function updatePageControls(){if(!note()?.pdf)return;$('#pagenum').value=pageIndex+1;$('#pagenum').max=note().pdf.pages.length;$('#pagecount').textContent='of '+note().pdf.pages.length;$('#prevpage').disabled=pageIndex===0;$('#nextpage').disabled=pageIndex===note().pdf.pages.length-1;$('#zoomvalue').textContent=zoom===1?'Fit width':Math.round(zoom*100)+'%';$('#zoomout').disabled=zoom<=.5;$('#zoomin').disabled=zoom>=3;}
  function sizePDF(){const pg=page();if(!pg)return;const ws=$('.workspace'),base=Math.max(240,Math.min(860,ws.clientWidth-(ws.clientWidth<600?18:72)));$('#sheet').style.width=(base*zoom)+'px';const width=surface.getBoundingClientRect().width;surface.style.height=width*pg.height/pg.width+'px';}
  resizePage=function(){if(note()?.pdf)sizePDF();else sizeBlank();};
  async function renderPDF(){
    const id=current,index=pageIndex,ticket=++renderTicket;if(!note()?.pdf)return;pdfBusy('Rendering page…');updatePageControls();sizePDF();
    const previousTask=renderTask;if(previousTask){previousTask.cancel();await previousTask.promise.catch(()=>{});}if(ticket!==renderTicket)return;
    try{
      if(pdfSource?.id!==id){const old=pdfSource;pdfSource={id,promise:(async()=>{const [lib,blob]=await Promise.all([pdfLibrary(),getFile(id)]);if(!blob)throw Error('The original PDF is missing. Restore a full backup to recover it.');return lib.getDocument(pdfOptions(await blob.arrayBuffer())).promise;})()};if(old)old.promise.then(doc=>doc.loadingTask.destroy()).catch(()=>{});}
      const doc=await pdfSource.promise;if(ticket!==renderTicket)return;
      const pg=await doc.getPage(index+1);if(ticket!==renderTicket)return;
      const view=pg.getViewport({scale:1}),meta=page();meta.width=view.width;meta.height=view.height;canvas.setAttribute('viewBox',`0 0 ${view.width} ${view.height}`);sizePDF();redraw();
      const pixelRatio=Math.min(devicePixelRatio||1,2.5),desired=surface.getBoundingClientRect().width*pixelRatio/view.width,scale=Math.min(desired,Math.sqrt(12000000/(view.width*view.height))),viewport=pg.getViewport({scale});
      const target=$('#pdfpage');target.width=Math.ceil(viewport.width);target.height=Math.ceil(viewport.height);renderTask=pg.render({canvasContext:target.getContext('2d'),viewport});await renderTask.promise;
      if(ticket!==renderTicket)return;renderTask=null;pdfReady=true;surface.classList.remove('pdf-loading');$('#pdfstatus').textContent='Saved locally · '+doc.numPages+' pages';
    }catch(e){if(ticket!==renderTicket||e.name==='RenderingCancelledException')return;$('#pdfstatus').textContent='Could not render page';surface.classList.add('pdf-loading');toast('PDF: '+e.message);}
  }
  loadNote=function(id){finishInput();pageIndex=0;zoom=1;++renderTicket;if(renderTask){renderTask.cancel();renderTask=null;}original.loadNote(id);const n=note(),isPDF=!!n.pdf;
    $('#sheet').classList.toggle('pdf-sheet',isPDF);$('#pdfbar').hidden=!isPDF;$('#pdfpage').hidden=!isPDF;$('#editor').hidden=true;$('#paper').disabled=isPDF;$('#export').textContent=isPDF?'Export PDF':'Export';$('#sheet').style.width='';
    if(isPDF){$('#words').textContent=n.pdf.pages.length+' pages';renderPDF();}else{if(!n.texts){const text=plainFromHTML(n.html);n.texts=text?[{x:40,y:60,size:18,lineHeight:1.5,width:720,font:'monospace',color:'#264c3d',text}]:[];}pdfReady=false;surface.classList.remove('pdf-loading');sizeBlank();redraw();}updateInput();
  };
  renderList=function(){original.renderList();$$('.note').forEach(el=>{const n=data.notes.find(n=>n.id===el.dataset.id);if(n?.pdf){el.querySelector('.preview').textContent=n.pdf.name;el.querySelector('.meta span:last-child').textContent='PDF · '+n.pdf.pages.length+' pages';}});};
  async function goTo(index){if(!note()?.pdf)return;finishInput();pageIndex=Math.max(0,Math.min(note().pdf.pages.length-1,index));await renderPDF();}
  $('#prevpage').onclick=()=>goTo(pageIndex-1);$('#nextpage').onclick=()=>goTo(pageIndex+1);$('#pagenum').onchange=()=>{const n=Number($('#pagenum').value);if(Number.isInteger(n)&&n>=1&&n<=note().pdf.pages.length)goTo(n-1);else updatePageControls();};
  function changeZoom(z){finishInput();zoom=Math.max(.5,Math.min(3,z));renderPDF();}
  $('#zoomin').onclick=()=>changeZoom(zoom+.25);$('#zoomout').onclick=()=>changeZoom(zoom-.25);$('#zoomfit').onclick=()=>changeZoom(1);
  let resizeTimer;window.addEventListener('resize',()=>{finishInput();if(!note()?.pdf){sizeBlank();return;}sizePDF();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>renderPDF(),200);});
  $('#importpdf').onclick=()=>{$('#pdffile').value='';$('#pdffile').click();};
  $('#pdffile').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;if(!db){toast('PDF import requires browser document storage. Reload or allow storage for this site.');return;}if(file.size>25*1024*1024){toast('Choose a PDF up to 25 MB.');return;}
    const button=$('#importpdf');button.disabled=true;button.textContent='Importing…';let doc;
    try{finishInput();const bytes=new Uint8Array(await file.arrayBuffer());if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw Error('This file is not a PDF');const lib=await pdfLibrary();doc=await lib.getDocument(pdfOptions(bytes)).promise;if(doc.numPages>1000)throw Error('Choose a PDF with at most 1,000 pages');
      const pages=[];for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i),v=p.getViewport({scale:1});const content=await p.getTextContent();pages.push({width:v.width,height:v.height,strokes:[],texts:[],pdfText:content.items.map(t=>t.str+(t.hasEOL?'\n':' ')).join('').slice(0,1000000)});}
      const n={id:uid(),book:data.books.some(b=>b.id===filter)?filter:data.books[0].id,title:file.name.replace(/\.pdf$/i,'').slice(0,200),html:'',paper:'plain',strokes:[],star:false,created:Date.now(),updated:Date.now(),pdf:{name:file.name,pages}};
      finishInput();$('.app').inert=true;await saveQueue;const candidate=clone(data);candidate.notes.unshift(n);await writeState(candidate,[[n.id,file]]);data=candidate;++saveVersion;$('#saved').textContent='Saved on device';renderNav();loadNote(n.id);toast('PDF imported. Write, highlight, or choose Type to add text.');navigator.storage?.persist?.().catch(()=>{});
    }catch(err){toast(err.name==='PasswordException'?'Password-protected PDFs are not supported. Import an unlocked copy.':'Could not import PDF: '+err.message);}finally{if(doc)doc.loadingTask.destroy();$('.app').inert=false;button.disabled=false;button.textContent='Import PDF';}
  };
  async function overlayPNG(pg){
    const svg=document.createElementNS(NS,'svg');svg.setAttribute('xmlns',NS);svg.setAttribute('viewBox',`0 0 ${pg.width} ${pg.height}`);svg.setAttribute('width',pg.width);svg.setAttribute('height',pg.height);pg.strokes.forEach(s=>svg.append(pathFor(s)));pg.texts.forEach(t=>svg.append(textElement(t)));
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(2.5,Math.sqrt(12000000/(pg.width*pg.height))),c=document.createElement('canvas');c.width=Math.ceil(pg.width*scale);c.height=Math.ceil(pg.height*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);return new Promise((resolve,reject)=>c.toBlob(async b=>{if(b)resolve(new Uint8Array(await b.arrayBuffer()));else reject(Error('Could not export annotations'));},'image/png'));}finally{URL.revokeObjectURL(url);}
  }
  $('#export').onclick=async()=>{
    finishInput();if(!note().pdf){const n=note(),svg=canvas.cloneNode(true);svg.setAttribute('xmlns',NS);svg.removeAttribute('id');svg.setAttribute('width',n.board?.width||800);svg.setAttribute('height',n.board?.height||n.height||1050);const body=`<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(n.title||'Untitled note')}</title><style>body{margin:0 auto;max-width:800px;background:white}svg{display:block;width:100%;height:auto}button{margin:16px;padding:8px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button>${new XMLSerializer().serializeToString(svg)}</body></html>`;download(body,(n.title||'Untitled note').replace(/[^a-z0-9 _-]/gi,'').slice(0,80)+'.html','text/html');return;}const n=clone(note()),button=$('#export');button.disabled=true;
    try{const file=await getFile(n.id);if(!file)throw Error('Original PDF is missing');const doc=await PDFLib.PDFDocument.load(new Uint8Array(await file.arrayBuffer())),pages=doc.getPages();for(let i=0;i<n.pdf.pages.length;i++){const pg=n.pdf.pages[i];if(!pg.strokes.length&&!pg.texts.length)continue;button.textContent=`Exporting ${i+1}/${pages.length}`;const image=await doc.embedPng(await overlayPNG(pg)),placement=Ink.imagePlacement(pages[i].getCropBox(),pages[i].getRotation().angle);pages[i].drawImage(image,{x:placement.x,y:placement.y,width:placement.width,height:placement.height,rotate:PDFLib.degrees(placement.rotation)});}const bytes=await doc.save();download(bytes,(n.title||'Document').replace(/[^a-z0-9 _-]/gi,'').slice(0,100)+'-annotated.pdf','application/pdf');toast('Annotated PDF exported. Your original document is preserved.');
    }catch(e){toast('Could not export PDF: '+e.message);}finally{button.disabled=false;button.textContent=note()?.pdf?'Export PDF':'Export';}
  };
  function toBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
  function fromBase64(str){if(typeof str!=='string'||str.length>36*1024*1024)throw Error('Invalid PDF in backup');const raw=atob(str),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw Error('Invalid PDF in backup');return new Blob([bytes],{type:'application/pdf'});}
  $('#backup').onclick=async()=>{finishInput();const button=$('#backup');button.disabled=true;try{const copy=clone(data),files={};for(const n of copy.notes.filter(n=>n.pdf)){const file=await getFile(n.id);if(!file)throw Error('Missing original PDF: '+n.title);files[n.id]=toBase64(new Uint8Array(await file.arrayBuffer()));}download(JSON.stringify({...copy,version:2,files}),'leafnote-backup-'+new Date().toISOString().slice(0,10)+'.json','application/json');toast('Full backup exported, including PDFs and annotations.');}catch(e){toast('Backup failed: '+e.message);}finally{button.disabled=false;}};
  $('#backupfile').onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    try{if(f.size>200*1024*1024)throw Error('Backup exceeds 200 MB');const raw=JSON.parse(await f.text()),imported=validate(raw),files=[];for(const n of imported.notes.filter(n=>n.pdf)){if(!db)throw Error('PDF backups require browser document storage');const file=fromBase64(raw.files?.[n.id]);const lib=await pdfLibrary(),doc=await lib.getDocument(pdfOptions(await file.arrayBuffer())).promise;try{if(doc.numPages!==n.pdf.pages.length)throw Error('PDF page count does not match backup');}finally{doc.loadingTask.destroy();}files.push([n.id,file]);}
      const r=await modal('Import backup?','This replaces notes on this device. Export a full backup first to keep them.',false,'Replace notes');if(!r.ok)return;finishInput();$('.app').inert=true;await saveQueue;if(db)await writeState(imported,files,true);else localStorage.setItem(KEY,JSON.stringify(imported));data=imported;++saveVersion;undoStack.length=0;redoStack.length=0;filter='all';renderNav();loadNote(data.notes[0]?.id);$('#saved').textContent='Saved on device';toast('Backup imported with documents and annotations.');
    }catch(e){toast('Could not import: '+e.message);}finally{$('.app').inert=false;}
  };
  // Delete the local original only after the note deletion has saved successfully.
  $('#delete').onclick=async()=>{finishInput();const n=note(),r=await modal('Delete this note?',`“${n.title||'Untitled note'}” and its local document will be permanently removed.`,false,'Delete');if(!r.ok)return;const candidate=clone(data);candidate.notes=candidate.notes.filter(v=>v.id!==n.id);try{await saveQueue;if(db){const tx=db.transaction(['state','pdfs'],'readwrite'),done=complete(tx);tx.objectStore('state').put(candidate,'notebook');tx.objectStore('pdfs').delete(n.id);await done;}else localStorage.setItem(KEY,JSON.stringify(candidate));data=candidate;renderNav();if(data.notes.length)loadNote(data.notes[0].id);else createNote();toast('Note deleted');}catch(e){toast('Could not delete: '+e.message);}};
  // Keep notebook changes and ink transformations separate from PDF page sizing.
  const changeNotebook=$('#notebook').onchange;$('#notebook').onchange=()=>{finishInput();changeNotebook();};
  const newNote=createNote;createNote=function(){finishInput();newNote();};$('#new').onclick=createNote;$('.listbar button').onclick=createNote;
  window.addEventListener('blur',()=>finishInput());document.addEventListener('visibilitychange',()=>{if(document.hidden)finishInput();});
  window.LeafnoteApp={ready:false,textStyleTarget,setTextColor,setTextStyle,finish:finishInput,snapshot,record:before=>{if(JSON.stringify(before)!==JSON.stringify(snapshot()))remember(before);},redraw:()=>redraw(),resize:()=>resizePage(),file:getFile,pdfLibrary,pdfOptions,page:()=>page()||note(),pageIndex:()=>pageIndex,open:async(id,index)=>{loadNote(id);if(note()?.pdf)await goTo(index);}};
  $('.app').inert=true;
  try{
    try{db=await openDB();db.onversionchange=()=>{db.close();db=null;toast('Storage was updated in another tab. Reload Leafnote.');};}catch(e){toast('Using text-only storage: '+e.message);}
    const stored=db?await request(db.transaction('state').objectStore('state').get('notebook')):null;
    const legacy=localStorage.getItem(KEY);data=stored?validate(stored):legacy?validate(JSON.parse(legacy)):fresh();current=data.notes[0]?.id;
    renderNav();loadNote(current);await persist();
    // Existing localStorage notes remain as a recovery copy; IndexedDB is authoritative from now on.
  }catch(e){$('#saved').textContent='Could not load';$('#loading').textContent='Your saved notes could not be opened. Reload the app; existing storage has been preserved.';console.error(e);return;}
  $('.app').inert=false;$('#loading').remove();updateInput();window.LeafnoteApp.ready=true;document.dispatchEvent(new Event('leafnote-ready'));
})();
