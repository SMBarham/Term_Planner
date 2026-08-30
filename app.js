const TOTAL_PAGES=145;
const PAGE_PATH=n=>PAGE_DATA[n-1];
let currentPage=Number(localStorage.getItem('planner-current-page')||1);
let spreadMode=localStorage.getItem('planner-spread')==='true';
let currentTool='pen';
let activeView=null;
const host=document.getElementById('pagesHost');
const viewport=document.getElementById('viewport');
const pageInput=document.getElementById('pageInput');
const spreadBtn=document.getElementById('spreadBtn');
const penColor=document.getElementById('penColor');
const penSize=document.getElementById('penSize');
const textOptions=document.getElementById('textOptions');
const textFont=document.getElementById('textFont');
const textSize=document.getElementById('textSize');
const textBold=document.getElementById('textBold');
let textBoldOn=false;
const FONT_MAP={centaur:'Centaur, \"Times New Roman\", Georgia, serif',caveat:'\"Caveat\", cursive',darker:'\"Darker Grotesque\", sans-serif'};

// IndexedDB
const dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('term-planner-db',1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('annotations')) db.createObjectStore('annotations',{keyPath:'page'});};
  req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
});
async function getData(page){const db=await dbPromise;return new Promise(r=>{const tx=db.transaction('annotations');const q=tx.objectStore('annotations').get(page);q.onsuccess=()=>r(q.result||{page,strokes:[],texts:[]});q.onerror=()=>r({page,strokes:[],texts:[]});});}
async function putData(data){const db=await dbPromise;return new Promise((r,j)=>{const tx=db.transaction('annotations','readwrite');tx.objectStore('annotations').put(data);tx.oncomplete=()=>r();tx.onerror=()=>j(tx.error);});}
async function deleteData(page){const db=await dbPromise;return new Promise(r=>{const tx=db.transaction('annotations','readwrite');tx.objectStore('annotations').delete(page);tx.oncomplete=()=>r();});}
async function allData(){const db=await dbPromise;return new Promise(r=>{const tx=db.transaction('annotations');const q=tx.objectStore('annotations').getAll();q.onsuccess=()=>r(q.result||[]);});}
async function replaceAll(records){const db=await dbPromise;return new Promise((r,j)=>{const tx=db.transaction('annotations','readwrite');const s=tx.objectStore('annotations');s.clear();for(const x of records)s.put(x);tx.oncomplete=()=>r();tx.onerror=()=>j(tx.error);});}

class PageView{
  constructor(page){
    this.page=page;this.data={page,strokes:[],texts:[]};this.history=[];this.drawing=false;this.stroke=null;
    this.groupDrag=null;this.lasso=null;
    this.el=document.createElement('div');this.el.className='page-view';
    this.img=document.createElement('img');this.img.src=PAGE_PATH(page);this.img.alt=`Planner page ${page}`;
    this.canvas=document.createElement('canvas');this.canvas.className='ink-layer';
    this.textLayer=document.createElement('div');this.textLayer.className='text-layer';
    this.selectionOutline=document.createElement('div');this.selectionOutline.className='selection-outline';this.selectionOutline.hidden=true;
    this.el.append(this.img,this.canvas,this.textLayer,this.selectionOutline);this.ctx=this.canvas.getContext('2d');this.bind();
  }
  async init(){this.data=await getData(this.page);this.img.addEventListener('load',()=>this.resize(),{once:true});if(this.img.complete)this.resize();this.renderTexts();return this;}
  resize(){const r=this.img.getBoundingClientRect();const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.ctx.setTransform(dpr,0,0,dpr,0,0);this.redraw();this.renderTexts();this.updateSelectionVisual();}
  coords(e){const r=this.canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height,px:e.clientX-r.left,py:e.clientY-r.top,w:r.width,h:r.height};}
  isInkPointer(e){return e.pointerType==='pen'||e.pointerType==='mouse'||e.pointerType==='touch';}
  snapshot(){this.history.push(JSON.stringify(this.data));if(this.history.length>30)this.history.shift();}
  bind(){
    this.el.addEventListener('pointerdown',e=>{
      activeView=this;
      if(currentTool==='text'){
        if(e.target.closest('.text-note'))return;
        clearSelection();
        const p=this.coords(e);this.snapshot();
        this.data.texts.push({id:crypto.randomUUID(),x:p.x,y:p.y,text:'Type here',font:textFont.value,size:Number(textSize.value||12),bold:textBoldOn,color:penColor.value});
        this.renderTexts(true);this.save();return;
      }
      if(!this.isInkPointer(e))return;
      if(currentTool==='select'){
        if(e.target.closest('.text-note'))return;
        e.preventDefault();const p=this.coords(e);const idx=this.hitStroke(p.x,p.y);
        if(idx>=0){
          if(!selectionHasStroke(this,idx))setSelection(this,[idx],[]);
          this.beginGroupDrag(e,p);this.canvas.setPointerCapture?.(e.pointerId);return;
        }
        clearSelection();
        this.lasso={points:[[p.x,p.y]],pointerId:e.pointerId};this.canvas.setPointerCapture?.(e.pointerId);this.redraw();return;
      }
      clearSelection();
      if(currentTool==='pen'){
        e.preventDefault();this.snapshot();const p=this.coords(e);this.drawing=true;
        this.stroke={color:penColor.value,width:Number(penSize.value)/1000,points:[[p.x,p.y]]};
        this.data.strokes.push(this.stroke);this.canvas.setPointerCapture?.(e.pointerId);
      }else if(currentTool==='eraser'){
        e.preventDefault();this.snapshot();this.drawing=true;this.eraseAt(e);this.canvas.setPointerCapture?.(e.pointerId);
      }
    });
    this.el.addEventListener('pointermove',e=>{
      if(this.groupDrag&&this.isInkPointer(e)){
        e.preventDefault();const p=this.coords(e);this.moveGroupTo(p);return;
      }
      if(this.lasso&&this.isInkPointer(e)){
        e.preventDefault();const p=this.coords(e);const last=this.lasso.points.at(-1);
        if(!last||Math.hypot(p.x-last[0],p.y-last[1])>.004)this.lasso.points.push([p.x,p.y]);
        this.redraw();return;
      }
      if(!this.drawing||!this.isInkPointer(e))return;e.preventDefault();
      if(currentTool==='pen'){const p=this.coords(e);this.stroke.points.push([p.x,p.y]);this.redraw();}
      else if(currentTool==='eraser')this.eraseAt(e);
    });
    const end=e=>{
      if(this.groupDrag){const changed=this.groupDrag.snapshotted;this.groupDrag=null;if(changed)this.save();this.updateSelectionVisual();return;}
      if(this.lasso){const pts=this.lasso.points;this.lasso=null;if(pts.length>3)this.selectByLasso(pts);else clearSelection();this.redraw();return;}
      if(!this.drawing)return;this.drawing=false;this.stroke=null;this.save();
    };
    this.el.addEventListener('pointerup',end);this.el.addEventListener('pointercancel',end);
  }
  hitStroke(x,y){
    const threshold=.025;
    for(let i=this.data.strokes.length-1;i>=0;i--){const s=this.data.strokes[i];if(s.points.some(([px,py])=>Math.hypot(px-x,py-y)<=threshold))return i;}
    return -1;
  }
  beginGroupDrag(e,p){
    if(selection.view!==this||selectionCount()===0)return;
    const strokeOriginals=new Map();for(const i of selection.strokeIndexes)strokeOriginals.set(i,this.data.strokes[i].points.map(q=>[q[0],q[1]]));
    const textOriginals=new Map();for(const id of selection.textIds){const t=this.data.texts.find(x=>x.id===id);if(t)textOriginals.set(id,[t.x,t.y]);}
    this.groupDrag={startX:p.x,startY:p.y,strokeOriginals,textOriginals,snapshotted:false};
  }
  moveGroupTo(p){
    const g=this.groupDrag;if(!g)return;const dx=p.x-g.startX,dy=p.y-g.startY;
    if(!g.snapshotted&&Math.hypot(dx,dy)>.003){this.snapshot();g.snapshotted=true;}
    for(const [i,pts] of g.strokeOriginals){const s=this.data.strokes[i];if(s)s.points=pts.map(([x,y])=>[clamp01(x+dx),clamp01(y+dy)]);}
    for(const [id,[x,y]] of g.textOriginals){const t=this.data.texts.find(v=>v.id===id);if(t){t.x=clamp01(x+dx);t.y=clamp01(y+dy);const n=this.textLayer.querySelector(`[data-id="${CSS.escape(id)}"]`);if(n){n.style.left=(t.x*100)+'%';n.style.top=(t.y*100)+'%';n.classList.add('dragging');}}}
    this.redraw();this.updateSelectionVisual();
  }
  selectByLasso(poly){
    const strokeIndexes=[];
    this.data.strokes.forEach((s,i)=>{
      if(!s.points.length)return;const inside=s.points.filter(([x,y])=>pointInPolygon(x,y,poly)).length;
      const cx=s.points.reduce((a,p)=>a+p[0],0)/s.points.length,cy=s.points.reduce((a,p)=>a+p[1],0)/s.points.length;
      if(inside>0||pointInPolygon(cx,cy,poly))strokeIndexes.push(i);
    });
    const textIds=[];const layerRect=this.textLayer.getBoundingClientRect();
    for(const t of this.data.texts){const n=this.textLayer.querySelector(`[data-id="${CSS.escape(t.id)}"]`);if(!n)continue;const r=n.getBoundingClientRect();const cx=(r.left+r.width/2-layerRect.left)/layerRect.width,cy=(r.top+r.height/2-layerRect.top)/layerRect.height;if(pointInPolygon(cx,cy,poly))textIds.push(t.id);}
    setSelection(this,strokeIndexes,textIds);
  }
  eraseAt(e){const p=this.coords(e);const radius=0.025;this.data.strokes=this.data.strokes.filter(s=>!s.points.some(([x,y])=>Math.hypot(x-p.x,y-p.y)<radius));clearSelection();this.redraw();}
  redraw(){
    const r=this.canvas.getBoundingClientRect();this.ctx.clearRect(0,0,r.width,r.height);this.ctx.lineCap='round';this.ctx.lineJoin='round';
    for(const s of this.data.strokes){if(!s.points.length)continue;this.ctx.strokeStyle=s.color;this.ctx.lineWidth=Math.max(1,s.width*r.width);this.ctx.beginPath();const [x0,y0]=s.points[0];this.ctx.moveTo(x0*r.width,y0*r.height);for(const [x,y] of s.points.slice(1))this.ctx.lineTo(x*r.width,y*r.height);if(s.points.length===1)this.ctx.lineTo(x0*r.width+.01,y0*r.height+.01);this.ctx.stroke();}
    if(this.lasso?.points?.length){this.ctx.save();this.ctx.strokeStyle='rgba(109,58,168,.95)';this.ctx.lineWidth=2;this.ctx.setLineDash([7,5]);this.ctx.beginPath();const [x0,y0]=this.lasso.points[0];this.ctx.moveTo(x0*r.width,y0*r.height);for(const [x,y] of this.lasso.points.slice(1))this.ctx.lineTo(x*r.width,y*r.height);this.ctx.stroke();this.ctx.restore();}
  }
  renderTexts(focusNewest=false){
    this.textLayer.innerHTML='';
    for(const t of this.data.texts){
      const d=document.createElement('div');d.className='text-note';d.tabIndex=0;d.dataset.id=t.id;d.style.left=(t.x*100)+'%';d.style.top=(t.y*100)+'%';d.textContent=t.text;applyTextStyle(d,t);
      d.addEventListener('pointerdown',e=>{
        activeView=this;e.stopPropagation();
        if(d.contentEditable==='true')return;
        if(e.pointerType==='mouse'&&e.button!==0)return;
        if(currentTool==='select'){
          if(!selectionHasText(this,t.id))setSelection(this,[],[t.id]);
          const p=this.coords(e);this.beginGroupDrag(e,p);d.setPointerCapture?.(e.pointerId);return;
        }
        if(currentTool==='text'){setSelection(this,[],[t.id]);syncTextControlsFromSelection();}
      });
      d.addEventListener('click',e=>{e.stopPropagation();if(currentTool==='select'||currentTool==='text'){setSelection(this,[],[t.id]);syncTextControlsFromSelection();}});
      d.addEventListener('dblclick',e=>{e.stopPropagation();setSelection(this,[],[t.id]);syncTextControlsFromSelection();beginTextEdit(d,t,this);});
      d.addEventListener('input',()=>{t.text=d.innerText;});
      d.addEventListener('blur',()=>{if(d.contentEditable==='true'){t.text=d.innerText;d.contentEditable='false';this.save();}});
      d.addEventListener('keydown',e=>{if(e.key==='Escape'){d.contentEditable='false';d.blur();}});
      this.textLayer.appendChild(d);
    }
    this.updateSelectionVisual();
    if(focusNewest){const last=this.textLayer.lastElementChild;const t=this.data.texts.at(-1);if(last&&t){setSelection(this,[],[t.id]);syncTextControlsFromSelection();beginTextEdit(last,t,this,true);}}
  }
  updateSelectionVisual(){
    this.textLayer.querySelectorAll('.text-note').forEach(n=>n.classList.toggle('selected',selection.view===this&&selection.textIds.has(n.dataset.id)));
    this.textLayer.querySelectorAll('.text-note.dragging').forEach(n=>{if(!this.groupDrag)n.classList.remove('dragging');});
    if(selection.view!==this||selectionCount()===0){this.selectionOutline.hidden=true;return;}
    const boxes=[];
    for(const i of selection.strokeIndexes){const s=this.data.strokes[i];if(!s?.points?.length)continue;const xs=s.points.map(p=>p[0]),ys=s.points.map(p=>p[1]);boxes.push([Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]);}
    const lr=this.textLayer.getBoundingClientRect();
    for(const id of selection.textIds){const n=this.textLayer.querySelector(`[data-id="${CSS.escape(id)}"]`);if(!n)continue;const r=n.getBoundingClientRect();boxes.push([(r.left-lr.left)/lr.width,(r.top-lr.top)/lr.height,(r.right-lr.left)/lr.width,(r.bottom-lr.top)/lr.height]);}
    if(!boxes.length){this.selectionOutline.hidden=true;return;}
    const pad=.008;const x1=Math.max(0,Math.min(...boxes.map(b=>b[0]))-pad),y1=Math.max(0,Math.min(...boxes.map(b=>b[1]))-pad),x2=Math.min(1,Math.max(...boxes.map(b=>b[2]))+pad),y2=Math.min(1,Math.max(...boxes.map(b=>b[3]))+pad);
    Object.assign(this.selectionOutline.style,{left:(x1*100)+'%',top:(y1*100)+'%',width:((x2-x1)*100)+'%',height:((y2-y1)*100)+'%'});this.selectionOutline.hidden=false;
  }
  undo(){if(!this.history.length)return;this.data=JSON.parse(this.history.pop());clearSelection();this.redraw();this.renderTexts();this.save();}
  async save(){await putData(this.data);}
}

let views=[];
const selection={view:null,strokeIndexes:new Set(),textIds:new Set()};
function clamp01(v){return Math.max(0,Math.min(1,v));}
function pointInPolygon(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const hit=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);if(hit)inside=!inside;}return inside;}
function selectionCount(){return selection.strokeIndexes.size+selection.textIds.size;}
function selectionHasStroke(view,index){return selection.view===view&&selection.strokeIndexes.has(index);}
function selectionHasText(view,id){return selection.view===view&&selection.textIds.has(id);}
function clearSelection(){const old=selection.view;selection.view=null;selection.strokeIndexes.clear();selection.textIds.clear();old?.updateSelectionVisual();refreshToolOptions();}
function setSelection(view,strokeIndexes=[],textIds=[]){const old=selection.view;selection.view=view;selection.strokeIndexes=new Set(strokeIndexes);selection.textIds=new Set(textIds);if(old&&old!==view)old.updateSelectionVisual();view?.updateSelectionVisual();activeView=view||activeView;syncTextControlsFromSelection();refreshToolOptions();}
function selectedTexts(){if(!selection.view)return[];return selection.view.data.texts.filter(t=>selection.textIds.has(t.id));}
function syncTextControlsFromSelection(){const ts=selectedTexts();if(!ts.length)return;const t=ts[0];textFont.value=t.font||'caveat';textSize.value=String(t.size||12);textBoldOn=!!t.bold;penColor.value=t.color||'#34223f';textBold.classList.toggle('active',textBoldOn);}

async function render(){currentPage=Math.max(1,Math.min(TOTAL_PAGES,currentPage));localStorage.setItem('planner-current-page',currentPage);pageInput.value=currentPage;spreadBtn.textContent=spreadMode?'Single':'Spread';host.classList.toggle('spread',spreadMode);clearSelection();host.innerHTML='';views=[];let pages;
  if(!spreadMode||currentPage===1){pages=[currentPage];}else{const left=currentPage%2===0?currentPage:currentPage-1;pages=[left,left+1].filter(p=>p>=1&&p<=TOTAL_PAGES);}
  for(const p of pages){const v=new PageView(p);host.appendChild(v.el);views.push(v);await v.init();}
  activeView=views.find(v=>v.page===currentPage)||views[0];requestAnimationFrame(()=>views.forEach(v=>v.resize()));
}
function go(page){currentPage=Math.max(1,Math.min(TOTAL_PAGES,Number(page)||1));document.getElementById('viewport').scrollTo({top:0,left:0,behavior:'instant'});render();}

document.getElementById('prevBtn').onclick=()=>go(currentPage-(spreadMode&&currentPage>1?2:1));
document.getElementById('nextBtn').onclick=()=>go(currentPage+(spreadMode&&currentPage>1?2:1));
pageInput.onchange=()=>go(pageInput.value);
spreadBtn.onclick=()=>{spreadMode=!spreadMode;localStorage.setItem('planner-spread',spreadMode);render();};
window.addEventListener('resize',()=>views.forEach(v=>v.resize()));

function applyTextStyle(note,t){note.style.fontFamily=FONT_MAP[t.font||'caveat'];note.style.fontSize=(t.size||12)+'px';note.style.fontWeight=t.bold?'700':'400';note.style.color=t.color||'#34223f';}
function beginTextEdit(note,t,view,selectAll=false){note.contentEditable='true';note.focus();if(selectAll){const r=document.createRange();r.selectNodeContents(note);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);}}
function applyControlsToSelected(){const ts=selectedTexts();if(!ts.length)return;const view=selection.view;for(const t of ts){t.font=textFont.value;t.size=Math.max(6,Math.min(72,Number(textSize.value)||12));t.bold=textBoldOn;t.color=penColor.value;const n=view.textLayer.querySelector(`[data-id="${CSS.escape(t.id)}"]`);if(n)applyTextStyle(n,t);}textSize.value=ts[0].size;view.save();}
async function deleteSelected(){if(!selection.view||selectionCount()===0)return;const view=selection.view;view.snapshot();const ids=new Set(selection.textIds);view.data.texts=view.data.texts.filter(t=>!ids.has(t.id));const idxs=[...selection.strokeIndexes].sort((a,b)=>b-a);for(const i of idxs)view.data.strokes.splice(i,1);clearSelection();view.redraw();view.renderTexts();await view.save();}
function refreshToolOptions(){textOptions.hidden=!(currentTool==='text'||selection.textIds.size>0);document.getElementById('deleteSelectionBtn').hidden=selectionCount()===0;document.querySelectorAll('.pen-only').forEach(x=>x.style.display=currentTool==='pen'?'':'none');}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{currentTool=b.dataset.tool;if(currentTool!=='select'&&currentTool!=='text')clearSelection();document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));refreshToolOptions();});

// Two-finger touch gesture: pan the planner regardless of the active annotation tool.
// A single touch/stylus pointer is left to the current tool.
const touchPointers=new Map();
let twoFingerPan=null;

function touchCentre(){
  const pts=[...touchPointers.values()];
  if(pts.length<2)return null;
  return {x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
}
function beginTwoFingerPan(){
  const c=touchCentre();if(!c)return;
  // Cancel any one-finger annotation that began before the second finger landed.
  for(const v of views){
    if(v.drawing){
      if(v.stroke && v.data.strokes.at(-1)===v.stroke)v.data.strokes.pop();
      if(v.history.length)v.history.pop();
      v.drawing=false;v.stroke=null;v.redraw();
    }
    if(v.lasso){v.lasso=null;v.redraw();}
    if(v.groupDrag){v.groupDrag=null;v.renderTexts();v.redraw();v.updateSelectionVisual();}
  }
  twoFingerPan={x:c.x,y:c.y,left:viewport.scrollLeft,top:viewport.scrollTop};
  viewport.classList.add('two-finger-panning');
}
viewport.addEventListener('pointerdown',e=>{
  if(e.pointerType!=='touch')return;
  touchPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(touchPointers.size===2)beginTwoFingerPan();
},{capture:true});
viewport.addEventListener('pointermove',e=>{
  if(e.pointerType!=='touch'||!touchPointers.has(e.pointerId))return;
  touchPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(!twoFingerPan||touchPointers.size<2)return;
  const c=touchCentre();if(!c)return;
  e.preventDefault();e.stopPropagation();
  viewport.scrollLeft=twoFingerPan.left-(c.x-twoFingerPan.x);
  viewport.scrollTop=twoFingerPan.top-(c.y-twoFingerPan.y);
},{capture:true,passive:false});
function endTouchPointer(e){
  if(e.pointerType!=='touch')return;
  touchPointers.delete(e.pointerId);
  if(touchPointers.size<2){twoFingerPan=null;viewport.classList.remove('two-finger-panning');}
}
viewport.addEventListener('pointerup',endTouchPointer,{capture:true});
viewport.addEventListener('pointercancel',endTouchPointer,{capture:true});

textBold.onclick=()=>{textBoldOn=!textBoldOn;textBold.classList.toggle('active',textBoldOn);applyControlsToSelected();};
[textFont,textSize,penColor].forEach(el=>el.addEventListener('change',applyControlsToSelected));textSize.addEventListener('input',applyControlsToSelected);
document.getElementById('textSizeDown').onclick=()=>{textSize.value=Math.max(6,(Number(textSize.value)||12)-1);applyControlsToSelected();};
document.getElementById('textSizeUp').onclick=()=>{textSize.value=Math.min(72,(Number(textSize.value)||12)+1);applyControlsToSelected();};
refreshToolOptions();
document.getElementById('undoBtn').onclick=()=>activeView?.undo();
document.getElementById('deleteSelectionBtn').onclick=deleteSelected;
window.addEventListener('keydown',e=>{const editing=document.activeElement?.isContentEditable||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName);if((e.key==='Delete'||e.key==='Backspace')&&selectionCount()>0&&!editing){e.preventDefault();deleteSelected();}});

const sectionDialog=document.getElementById('sectionDialog');
document.getElementById('sectionBtn').onclick=()=>sectionDialog.showModal();
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=e=>{e.preventDefault();sectionDialog.close();go(b.dataset.page);});
const moreDialog=document.getElementById('moreDialog');
document.getElementById('moreBtn').onclick=()=>moreDialog.showModal();document.getElementById('closeMoreBtn').onclick=()=>moreDialog.close();

document.getElementById('clearPageBtn').onclick=async()=>{if(!activeView)return;if(confirm(`Clear handwriting and typed notes on page ${activeView.page}?`)){await deleteData(activeView.page);moreDialog.close();render();}};

document.getElementById('exportBtn').onclick=async()=>{const data=await allData();const blob=new Blob([JSON.stringify({version:1,exported:new Date().toISOString(),records:data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='term-planner-annotations.json';a.click();URL.revokeObjectURL(a.href);};
document.getElementById('importInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!Array.isArray(obj.records))throw new Error('Invalid backup');if(confirm('Replace annotations on this device with this backup?')){await replaceAll(obj.records);moreDialog.close();render();}}catch(err){alert('Could not import that backup.');}finally{e.target.value='';}};

document.getElementById('offlineBtn').onclick=()=>{document.getElementById('offlineStatus').textContent='All 145 planner pages are bundled into the app and cached automatically.';};

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));}
render();
