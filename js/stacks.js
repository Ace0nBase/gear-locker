/* ---------- v12: stricter kit matching, one magazine slot, split / merge stacks ---------- */
// one "Magazines" slot for rifle and pistol mags
S.mags=["Magazines (rifle & pistol)",["Mags & Ammo Storage"],["pmag","magazine","mags","mag ","lancer","gen m3","glock mag","p320 mag","pistol mag","rifle mag","ar mag","ak mag","stanag","magpul","etsgroup","ets "],"Enough loaded mags for the day: rifle, pistol or both.",["pouch","loader","holster","case","carrier","coupler"]];
delete S.pistolmags;
KITS.forEach(k=>{k.req=[...new Set(k.req.map(s=>s==="pistolmags"?"mags":s))];k.opt=[...new Set(k.opt.map(s=>s==="pistolmags"?"mags":s))].filter(s=>!k.req.includes(s))});
Object.keys(kits).forEach(id=>{const p=kits[id]?.picks;if(p&&p.pistolmags){if(!p.mags)p.mags=p.pistolmags;delete p.pistolmags}});
// gear only fills a slot in its own category (no more suppressors as magazines)
var NEVER_SLOT=new Set(["Firearms","Suppressors"]);
score=function(kit,slotId,i){
  const def=S[slotId];if(!def)return 0;const [, cats, kws, , ex]=def;const t=itemText(i);
  if(NEVER_SLOT.has(i.category))return 0;
  if(!cats.includes(i.category))return 0;
  if(ex.some(k=>t.includes(k)))return 0;
  if(!kws.some(k=>hasKw(t,k)))return 0;
  let sc=7+colorFit(kit,i,slotId)*2;
  if(i.condition==="New"||i.condition==="Good")sc+=1;if(i.condition==="Needs-repair")sc-=3;
  return Math.max(sc,0.5);
};

/* split a stack: move some of a quantity somewhere else */
var normTxt=s=>String(s||"").toLowerCase().replace(/rounds?|rnds?|rd\b/g,"rd").replace(/magazines?|mags?\b/g,"mag").replace(/[^a-z0-9]/g,"").replace(/s$/,"");
var twinKey=i=>[normTxt(i.name),normTxt(i.brand),i.category||"",normTxt(i.nick)].join("|");
var colorOk=(a,b)=>!a.color||!b.color||normTxt(a.color)===normTxt(b.color);
var isSpare=i=>!i.mountedOn&&!i.setupOn;
var at=x=>x.mountedOn||"";
function mergeIntoSpare(it){
  if(!it||it.deleted||it.serial||it.armId||onLoan(it.id))return it;
  const twin=live().find(x=>x.id!==it.id&&at(x)===at(it)&&!x.serial&&!x.armId&&!onLoan(x.id)&&twinKey(x)===twinKey(it)&&colorOk(x,it)&&!GearLogic.mergeFieldConflict(x,it));
  if(!twin)return it;
  twin.qty=(+twin.qty||0)+(+it.qty||0);if(!twin.color&&it.color)twin.color=it.color;if(!String(twin.location||"").trim()&&String(it.location||"").trim())twin.location=it.location;if(!String(twin.notes||"").trim()&&String(it.notes||"").trim())twin.notes=it.notes;if(!String(twin.setupOn||"").trim()&&String(it.setupOn||"").trim())twin.setupOn=it.setupOn;if(!+twin.value&&+it.value)twin.value=it.value;if(!+twin.paid&&+it.paid)twin.paid=it.paid;if((twin.weight==null||twin.weight==="")&&it.weight!=null)twin.weight=it.weight;twin.updatedAt=now();
  all=all.map(x=>x.id===it.id?{id:it.id,deleted:true,updatedAt:now()}:x);
  Object.values(kits).forEach(k=>{if(k&&k.picks)Object.keys(k.picks).forEach(s=>{if(k.picks[s]===it.id)k.picks[s]=twin.id});if(k&&Array.isArray(k.extras))k.extras=k.extras.map(x=>x===it.id?twin.id:x)});
  return twin;
}
function splitOff(it,n,dest){
  n=Math.max(1,Math.min(+it.qty||1,Math.round(n)));const t=now();
  if(n>=(+it.qty||1)){Object.assign(it,dest,{updatedAt:t});return mergeIntoSpare(it)}
  it.qty=(+it.qty||1)-n;it.updatedAt=t;
  const copy={...it,...dest,id:uid(),qty:n,createdAt:t,updatedAt:t};delete copy.armId;delete copy.serial;delete copy.lookupError;
  all.push(copy);return mergeIntoSpare(copy);
}
var moveState=null;
function openMove(id,opts={}){
  const it=itemById(id);if(!it)return;
  moveState={id,qty:+it.qty||1,n:opts.n??1,dest:opts.dest||"",mode:opts.mode||"move",fromMount:opts.fromMount,fromSetup:opts.fromSetup};renderMove();
}
function renderMove(){
  const el=$("moveSheet");const m=moveState;if(!m){el.hidden=true;syncLock();return}
  const it=itemById(m.id);if(!it){moveState=null;renderMove();return}
  const here=it.mountedOn&&itemById(it.mountedOn)?`on ${itemById(it.mountedOn).name}`:"spare";
  const body=m.mode==="after"
    ?`<h2>How many moved?</h2><p>You moved <b>${esc(it.name)}</b> (×${m.qty}) ${it.mountedOn&&itemById(it.mountedOn)?`onto <b>${esc(itemById(it.mountedOn).name)}</b>`:"back to spare"}. Did all ${m.qty} go, or just some?</p>
      <div class="qtyPick"><button class="btn ghost" type="button" data-mv="dec" aria-label="Fewer">−</button><b id="mvN">${m.n}</b><span>of ${m.qty}</span><button class="btn ghost" type="button" data-mv="inc" aria-label="More">+</button></div>
      <p class="hint">The rest stay where they were${m.fromMount&&itemById(m.fromMount)?` (on ${esc(itemById(m.fromMount).name)})`:m.fromSetup?` (${esc(m.fromSetup)})`:" (spare)"}.</p>
      <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-mv="all">All ${m.qty}</button><button class="btn" type="button" data-mv="go">Just ${m.n}</button></div>`
    :`<h2>Move some</h2><p><b>${esc(it.name)}</b> · you have ${m.qty}, now ${esc(here)}.</p>
      <div class="qtyPick"><button class="btn ghost" type="button" data-mv="dec" aria-label="Fewer">−</button><b id="mvN">${m.n}</b><span>of ${m.qty}</span><button class="btn ghost" type="button" data-mv="inc" aria-label="More">+</button></div>
      <div class="f"><label for="mvDest">Move them to</label><select id="mvDest"><option value="">Spare (back in inventory)</option>${mountOpts(it.id).replace('<option value="">— not mounted —</option>','')}</select></div>
      <p class="hint">They become their own line so you can see exactly where each one is. Spares of the same thing stack back together automatically.</p>
      <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-mv="close">Cancel</button><button class="btn" type="button" data-mv="go">Move ${m.n}</button></div>`;
  el.querySelector(".panel").innerHTML=body;if($("mvDest"))$("mvDest").value=m.dest;el.hidden=false;syncLock();
}
$("moveSheet").addEventListener("change",e=>{if(e.target.id==="mvDest"&&moveState)moveState.dest=e.target.value});
$("moveSheet").addEventListener("click",async e=>{
  const b=e.target.closest("[data-mv]");if(!b||!moveState)return;const m=moveState;const a=b.dataset.mv;
  if(a==="close"){moveState=null;renderMove();return}
  if(a==="inc"||a==="dec"){m.n=Math.max(1,Math.min(m.mode==="after"?m.qty:m.qty,m.n+(a==="inc"?1:-1)));renderMove();return}
  const it=itemById(m.id);if(!it){moveState=null;renderMove();return}
  if(a==="all"){moveState=null;renderMove();const r=mergeIntoSpare(it);render();await persist();if(r)openDetail(r,true);return}
  if(a==="go"){
    let r;
    if(m.mode==="after"){
      // it already sits at the new spot with the full qty: leave m.n there, put the rest back where they were
      const stay=m.qty-m.n;if(stay>0){it.qty=m.n;it.updatedAt=now();const back={...it,id:uid(),qty:stay,mountedOn:m.fromMount||"",setupOn:m.fromSetup||"",createdAt:now(),updatedAt:now()};delete back.armId;delete back.serial;all.push(back);mergeIntoSpare(back)}
      r=mergeIntoSpare(it);
    }else{
      const host=m.dest?itemById(m.dest):null;r=splitOff(it,m.n,{mountedOn:m.dest||"",setupOn:host?(host.setupOn||""):""});
    }
    moveState=null;renderMove();render();await persist();if(r&&!r.deleted)openDetail(itemById(r.id)||r,true);toast(r&&(+r.qty||1)>m.n&&m.mode!=="after"?`Moved. Now ${r.qty} there`:"Moved");return}
});
// detail: "Move some" when there's more than one
{const _od=openDetail;openDetail=function(i,quiet){_od(i,quiet);if(!i||(+i.qty||1)<2)return;const v=$("detail").querySelector(".dh .vbtns");if(v&&!v.querySelector('[data-dact="move"]'))v.insertAdjacentHTML("beforeend",`<button class="btn ghost" type="button" data-dact="move">Move some</button>`)}}
detailClickers.push(function(b){if(b.dataset.dact==="move"&&viewing){openMove(viewing.id);return true}});
{const _od2=openDetail;openDetail=function(i,quiet){_od2(i,quiet);if(!i)return;
  const sib=live().filter(x=>twinKey(x)===twinKey(i)&&!x.serial&&!x.armId);if(sib.length<2)return;
  const tot=sib.reduce((a,x)=>a+(+x.qty||1),0);
  const where=x=>x.mountedOn&&itemById(x.mountedOn)?`on ${itemById(x.mountedOn).name}`:"spare";
  const html=`<div class="sect"><h3>You have ${tot} total</h3><div class="links">${sib.sort((a,b)=>where(a).localeCompare(where(b))).map(x=>x.id===i.id?`<span class="lnk cur">${+x.qty||1} ${esc(where(x))} (this)</span>`:`<button class="lnk" type="button" data-dview="${esc(x.id)}">${+x.qty||1} ${esc(where(x))}</button>`).join("")}</div></div>`;
  const dl=$("detail").querySelector("dl");if(dl)dl.insertAdjacentHTML("afterend",html)}}
// form: moving a stack asks "all or just some?"
{const _sc=saveCurrent;saveCurrent=async function(extra){const before=editing?{...editing}:null;const rec=await _sc(extra);
  if(rec&&!extra&&before&&(+before.qty||1)>1&&(+rec.qty||1)===(+before.qty||1)&&((rec.mountedOn||"")!==(before.mountedOn||"")||(rec.setupOn||"")!==(before.setupOn||"")))
    setTimeout(()=>openMove(rec.id,{mode:"after",n:+rec.qty-1||1,fromMount:before.mountedOn||"",fromSetup:before.setupOn||""}),380);
  else if(rec&&!extra&&before&&((rec.mountedOn||"")!==(before.mountedOn||"")||(rec.setupOn||"")!==(before.setupOn||""))){const r=mergeIntoSpare(itemById(rec.id));if(r&&r.id!==rec.id){render();await persist();toast(`Added to the ${r.name} already there (now ${r.qty})`);if(viewing)openDetail(r,true)}}
  return rec}}
// swap prompt "Move off" → stack with matching spares
{const _ms=$("swapSheet");_ms.addEventListener("click",e=>{const b=e.target.closest('[data-swap="move"]');if(!b)return;setTimeout(async()=>{let n=0;live().filter(isSpare).forEach(i=>{if(!all.some(x=>x.id===i.id&&!x.deleted))return;const r=mergeIntoSpare(i);if(r&&r.id!==i.id)n++});if(n){render();await persist()}},250)},true)}
// show counts in kits
function migrateMags(){Object.keys(kits).forEach(id=>{const p=kits[id]?.picks;if(p&&p.pistolmags){if(!p.mags)p.mags=p.pistolmags;delete p.pistolmags}})}
{const _rk=renderKits;renderKits=function(){migrateMags();_rk();document.querySelectorAll("#kitDetail select[data-slot]").forEach(sel=>{const sid=sel.dataset.slot;const kit=KITS.find(k=>k.id===curKit);if(!kit)return;const it=coverage(kit).a[sid];if(it&&(+it.qty||1)>1){const meta=sel.parentElement.querySelector(".meta");if(meta&&!meta.dataset.q){meta.dataset.q=1;meta.insertAdjacentHTML("afterbegin",`<b>×${+it.qty}</b> · `)}}})}}

/* combine duplicate lines that sit in the same spot, only after a confirmed tap */
function mergeKeptBlanks(keep, other){
  const kept=[];
  if(!String(keep.location||"").trim()&&String(other.location||"").trim()){keep.location=other.location;kept.push("place")}
  if(!String(keep.notes||"").trim()&&String(other.notes||"").trim()){keep.notes=other.notes;kept.push("notes")}
  if(!String(keep.color||"").trim()&&String(other.color||"").trim()){keep.color=other.color;kept.push("color")}
  if(!String(keep.setupOn||"").trim()&&String(other.setupOn||"").trim())keep.setupOn=other.setupOn;
  const set=v=>v!=null&&String(v).trim()!=="";
  if(!set(keep.paid)&&set(other.paid)){keep.paid=other.paid;kept.push("what you paid")}
  if(!set(keep.value)&&set(other.value)){keep.value=other.value;kept.push("value")}
  return kept;
}
{const _od3=openDetail;openDetail=function(i,quiet){_od3(i,quiet);if(!i||i.serial||i.armId)return;
  const sameModel=x=>normTxt(x.name)===normTxt(i.name)&&normTxt(x.brand||"")===normTxt(i.brand||"");
  const near=live().filter(x=>x.id!==i.id&&at(x)===at(i)&&x.category===i.category&&sameModel(x)&&!x.serial&&!x.armId&&!onLoan(x.id)&&!GearLogic.mergeFieldConflict(i,x));if(!near.length)return;
  const html=`<div class="sect"><h3>Same make and model</h3><p class="hint" style="margin:0 0 6px">These match. Combining adds their counts onto this line and removes the other line.</p><div class="links">${near.map(x=>`<button class="lnk" type="button" data-combine="${esc(x.id)}">Combine with ${esc(x.name)}${x.brand?` · ${esc(x.brand)}`:""}${x.color?` (${esc(x.color)})`:""} ×${+x.qty||1}</button>`).join("")}</div></div>`;
  const dl=$("detail").querySelector("dl");if(dl)dl.insertAdjacentHTML("afterend",html)}}
detailClickers.push(async function(b){if(!b.dataset.combine||!viewing)return;const keep=all.find(x=>x.id===viewing.id&&!x.deleted),other=all.find(x=>x.id===b.dataset.combine&&!x.deleted);if(!keep||!other)return;
  if(normTxt(keep.name)!==normTxt(other.name)||normTxt(keep.brand||"")!==normTxt(other.brand||""))return true;
  if(GearLogic.mergeFieldConflict(keep,other))return true;
  if(b.dataset.armed!=="1"){const q=(+keep.qty||1)+(+other.qty||1);const kept=mergeKeptBlanks({...keep},other);b.dataset.armed="1";b.textContent=`Merge ${+other.qty||1}× ${other.name} into ${+keep.qty||1}× ${keep.name}? That removes the ${other.name} line and leaves ${q}× ${keep.name}.${kept.length?` This line keeps the other line's ${kept.join(", ")}.`:""} Tap again.`;return true}
  mergeKeptBlanks(keep,other);keep.qty=(+keep.qty||1)+(+other.qty||1);keep.updatedAt=now();
  all=all.map(x=>x.id===other.id?{id:other.id,deleted:true,updatedAt:now()}:x);
  Object.values(kits).forEach(k=>{if(k&&k.picks)Object.keys(k.picks).forEach(s=>{if(k.picks[s]===other.id)k.picks[s]=keep.id});if(k&&Array.isArray(k.extras))k.extras=k.extras.map(x=>x===other.id?keep.id:x)});
  render();await persist();openDetail(itemById(keep.id),true);toast(`Combined: ${keep.qty} ${keep.name}`);return true});

