const TOTAL_PAGES=145;
const PAGE_PATH=n=>PAGE_DATA[n-1];
let currentPage=Number(localStorage.getItem('planner-current-page')||1);
let spreadMode=localStorage.getItem('planner-spread')==='true';
let currentTool='pen';
let activeView=null;
const host=document.getElementById('pagesHost');
const pageInput=document.getElementById('pageInput');
const spreadBtn=document.getElementById('spreadBtn');
const penColor=document.getElementById('penColor');
const penSize=document.getElementById('penSize');
const textOptions=document.getElementById('textOptions');
const textFont=document.getElementById('textFont');
const textSize=document.getElementById('textSize');
const textBold=document.getElementById('textBold');
let textBoldOn=false;
let selectedText=null;
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
  constructor(page){this.page=page;this.data={page,strokes:[],texts:[]};this.history=[];this.drawing=false;this.stroke=null;this.el=document.createElement('div');this.el.className='page-view';this.img=document.createElement('img');this.img.src=PAGE_PATH(page);this.img.alt=`Planner page ${page}`;this.canvas=document.createElement('canvas');this.canvas.className='ink-layer';this.textLayer=document.createElement('div');this.textLayer.className='text-layer';this.el.append(this.img,this.canvas,this.textLayer);this.ctx=this.canvas.getContext('2d');this.bind();}
  async init(){this.data=await getData(this.page);this.img.addEventListener('load',()=>this.resize(),{once:true});if(this.img.complete)this.resize();this.renderTexts();return this;}
  resize(){const r=this.img.getBoundingClientRect();const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.ctx.setTransform(dpr,0,0,dpr,0,0);this.redraw();this.renderTexts();}
  coords(e){const r=this.canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height,px:e.clientX-r.left,py:e.clientY-r.top,w:r.width,h:r.height};}
  isInkPointer(e){return e.pointerType==='pen'||e.pointerType==='mouse';}
  snapshot(){this.history.push(JSON.stringify(this.data));if(this.history.length>30)this.history.shift();}
  bind(){
    this.el.addEventListener('pointerdown',e=>{activeView=this;if(!e.target.closest('.text-note')&&selectedText){selectedText.note?.classList.remove('selected');selectedText=null;refreshToolOptions();}if(currentTool==='text'){if(e.target.closest('.text-note'))return;const p=this.coords(e);this.snapshot();this.data.texts.push({id:crypto.randomUUID(),x:p.x,y:p.y,text:'Type here',font:textFont.value,size:Number(textSize.value||12),bold:textBoldOn,color:penColor.value});this.renderTexts(true);this.save();return;}if(!this.isInkPointer(e))return;if(currentTool==='pen'){e.preventDefault();this.snapshot();const p=this.coords(e);this.drawing=true;this.stroke={color:penColor.value,width:Number(penSize.value)/1000,points:[[p.x,p.y]]};this.data.strokes.push(this.stroke);this.canvas.setPointerCapture(e.pointerId);}else if(currentTool==='eraser'){e.preventDefault();this.snapshot();this.drawing=true;this.eraseAt(e);this.canvas.setPointerCapture(e.pointerId);}});
    this.el.addEventListener('pointermove',e=>{if(!this.drawing||!this.isInkPointer(e))return;e.preventDefault();if(currentTool==='pen'){const p=this.coords(e);this.stroke.points.push([p.x,p.y]);this.redraw();}else if(currentTool==='eraser')this.eraseAt(e);});
    const end=e=>{if(!this.drawing)return;this.drawing=false;this.stroke=null;this.save();};
    this.el.addEventListener('pointerup',end);this.el.addEventListener('pointercancel',end);
  }
  eraseAt(e){const p=this.coords(e);const radius=0.025;this.data.strokes=this.data.strokes.filter(s=>!s.points.some(([x,y])=>Math.hypot(x-p.x,y-p.y)<radius));this.redraw();}
  redraw(){const r=this.canvas.getBoundingClientRect();this.ctx.clearRect(0,0,r.width,r.height);this.ctx.lineCap='round';this.ctx.lineJoin='round';for(const s of this.data.strokes){if(!s.points.length)continue;this.ctx.strokeStyle=s.color;this.ctx.lineWidth=Math.max(1,s.width*r.width);this.ctx.beginPath();const [x0,y0]=s.points[0];this.ctx.moveTo(x0*r.width,y0*r.height);for(const [x,y] of s.points.slice(1))this.ctx.lineTo(x*r.width,y*r.height);if(s.points.length===1)this.ctx.lineTo(x0*r.width+.01,y0*r.height+.01);this.ctx.stroke();}}
  renderTexts(focusNewest=false){
    this.textLayer.innerHTML='';
    for(const t of this.data.texts){
      const d=document.createElement('div');
      d.className='text-note'; d.tabIndex=0; d.dataset.id=t.id;
      d.style.left=(t.x*100)+'%'; d.style.top=(t.y*100)+'%'; d.textContent=t.text;
      applyTextStyle(d,t);
      const select=()=>selectText(this,t,d);
      d.addEventListener('pointerdown',e=>{
        e.stopPropagation();
        select();
        if(d.contentEditable==='true') return;
        if(e.pointerType==='mouse'&&e.button!==0) return;

        const r=this.textLayer.getBoundingClientRect();
        const startX=e.clientX, startY=e.clientY;
        const originalX=t.x, originalY=t.y;
        let moving=false, snapshotted=false;
        d.setPointerCapture?.(e.pointerId);

        const move=ev=>{
          const dxPx=ev.clientX-startX, dyPx=ev.clientY-startY;
          if(!moving&&Math.hypot(dxPx,dyPx)>3) moving=true;
          if(!moving) return;
          ev.preventDefault();
          if(!snapshotted){this.snapshot();snapshotted=true;}
          t.x=Math.max(0,Math.min(.98,originalX+dxPx/r.width));
          t.y=Math.max(0,Math.min(.98,originalY+dyPx/r.height));
          d.style.left=(t.x*100)+'%';
          d.style.top=(t.y*100)+'%';
          d.classList.add('dragging');
        };
        const up=async ev=>{
          d.removeEventListener('pointermove',move);
          d.removeEventListener('pointerup',up);
          d.removeEventListener('pointercancel',up);
          d.classList.remove('dragging');
          if(moving){
            ev.preventDefault();
            await this.save();
          }
        };
        d.addEventListener('pointermove',move);
        d.addEventListener('pointerup',up);
        d.addEventListener('pointercancel',up);
      });
      d.addEventListener('click',e=>{e.stopPropagation();select();});
      d.addEventListener('dblclick',e=>{e.stopPropagation();select();beginTextEdit(d,t,this);});
      d.addEventListener('input',()=>{t.text=d.innerText;});
      d.addEventListener('blur',()=>{if(d.contentEditable==='true'){t.text=d.innerText;d.contentEditable='false';this.save();}});
      d.addEventListener('keydown',e=>{
        if(e.key==='Escape'){d.contentEditable='false';d.blur();}
        if((e.key==='Delete'||e.key==='Backspace')&&d.contentEditable!=='true'){
          e.preventDefault(); this.snapshot(); this.data.texts=this.data.texts.filter(x=>x.id!==t.id); selectedText=null; this.renderTexts(); refreshToolOptions(); this.save();
        }
      });
      this.textLayer.appendChild(d);
    }
    if(focusNewest){
      const last=this.textLayer.lastElementChild;
      const t=this.data.texts[this.data.texts.length-1];
      if(last&&t){selectText(this,t,last);beginTextEdit(last,t,this,true);}
    }
  }
  undo(){if(!this.history.length)return;this.data=JSON.parse(this.history.pop());this.redraw();this.renderTexts();this.save();}
  async save(){await putData(this.data);}
}

let views=[];
async function render(){currentPage=Math.max(1,Math.min(TOTAL_PAGES,currentPage));localStorage.setItem('planner-current-page',currentPage);pageInput.value=currentPage;spreadBtn.textContent=spreadMode?'Single':'Spread';host.classList.toggle('spread',spreadMode);host.innerHTML='';views=[];let pages;
  if(!spreadMode||currentPage===1){pages=[currentPage];}
  else{const left=currentPage%2===0?currentPage:currentPage-1;pages=[left,left+1].filter(p=>p>=1&&p<=TOTAL_PAGES);}
  for(const p of pages){const v=new PageView(p);host.appendChild(v.el);views.push(v);await v.init();}
  activeView=views.find(v=>v.page===currentPage)||views[0];
  requestAnimationFrame(()=>views.forEach(v=>v.resize()));
}
function go(page){currentPage=Math.max(1,Math.min(TOTAL_PAGES,Number(page)||1));document.getElementById('viewport').scrollTo({top:0,left:0,behavior:'instant'});render();}

document.getElementById('prevBtn').onclick=()=>go(currentPage-(spreadMode&&currentPage>1?2:1));
document.getElementById('nextBtn').onclick=()=>go(currentPage+(spreadMode&&currentPage>1?2:1));
pageInput.onchange=()=>go(pageInput.value);
spreadBtn.onclick=()=>{spreadMode=!spreadMode;localStorage.setItem('planner-spread',spreadMode);render();};
window.addEventListener('resize',()=>views.forEach(v=>v.resize()));

function applyTextStyle(note,t){
  note.style.fontFamily=FONT_MAP[t.font||'caveat'];
  note.style.fontSize=(t.size||12)+'px';
  note.style.fontWeight=t.bold?'700':'400';
  note.style.color=t.color||'#34223f';
}
function selectText(view,t,note){
  activeView=view; selectedText={view,t,note};
  document.querySelectorAll('.text-note.selected').forEach(x=>x.classList.remove('selected'));
  note.classList.add('selected');
  textFont.value=t.font||'caveat'; textSize.value=String(t.size||12); textBoldOn=!!t.bold; penColor.value=t.color||'#34223f';
  textBold.classList.toggle('active',textBoldOn); refreshToolOptions();
}
function beginTextEdit(note,t,view,selectAll=false){
  note.contentEditable='true'; note.focus();
  if(selectAll){const r=document.createRange();r.selectNodeContents(note);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);}
}
function applyControlsToSelected(){
  if(!selectedText)return;
  const {view,t,note}=selectedText;
  t.font=textFont.value; t.size=Math.max(6,Math.min(72,Number(textSize.value)||12)); t.bold=textBoldOn; t.color=penColor.value;
  textSize.value=t.size; applyTextStyle(note,t); view.save();
}
function refreshToolOptions(){
  textOptions.hidden=!(currentTool==='text'||selectedText);
  document.querySelectorAll('.pen-only').forEach(x=>x.style.display=currentTool==='pen'?'':'none');
}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{
  currentTool=b.dataset.tool;
  if(currentTool!=='text'&&selectedText){selectedText.note?.classList.remove('selected');selectedText=null;}
  document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b)); refreshToolOptions();
});
textBold.onclick=()=>{textBoldOn=!textBoldOn;textBold.classList.toggle('active',textBoldOn);applyControlsToSelected();};
[textFont,textSize,penColor].forEach(el=>el.addEventListener('change',applyControlsToSelected));
textSize.addEventListener('input',applyControlsToSelected);
document.getElementById('textSizeDown').onclick=()=>{textSize.value=Math.max(6,(Number(textSize.value)||12)-1);applyControlsToSelected();};
document.getElementById('textSizeUp').onclick=()=>{textSize.value=Math.min(72,(Number(textSize.value)||12)+1);applyControlsToSelected();};
refreshToolOptions();
document.getElementById('undoBtn').onclick=()=>activeView?.undo();

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
