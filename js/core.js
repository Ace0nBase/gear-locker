var CATS=GearLogic.GEAR_CATEGORIES;
var FACTOR={"New":0.9,"Good":0.7,"Used":0.55,"Worn":0.4,"Needs-repair":0.2};
var FILE="gear.json", LS="gearLocker.items", LSK="gearLocker.kits";
var kits={};
var COLS=["ammo","sessions","dope","maint","wish","loans","freqs","pace"], LSD="gearLocker.db";
var db={ammo:[],sessions:[],dope:[],maint:[],wish:[],loans:[],freqs:[],pace:[]};
var emptyDb=()=>Object.fromEntries(COLS.map(c=>[c,[]]));
var $=id=>document.getElementById(id);
var esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
var money=n=>"$"+Math.round(+n||0).toLocaleString();
var now=()=>new Date().toISOString();
function localISODate(d){const x=d instanceof Date?d:new Date();return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")}
function localDateTime(d){const x=d instanceof Date?d:new Date();return localISODate(x)+"T"+String(x.getHours()).padStart(2,"0")+":"+String(x.getMinutes()).padStart(2,"0")}
var today=()=>GearLogic.localDay();
function lookupFailMessage(msg,what){const raw=String(msg||"").replace(/^Market check:\s*/,"").trim();const reach=what?`Couldn't reach ${what}. You can try again.`:"Couldn't reach the price check. You can still save without a price.";const name=what?what.charAt(0).toUpperCase()+what.slice(1):"The lookup";const fail=`${name} didn't finish. Try again in a little while.`;if(/^Couldn't reach /.test(raw))return raw;if(!raw||/failed to fetch|networkerror|load failed|network request failed|appears to be offline|network error/i.test(raw))return reach;if(/claude api error|internal server error|^error \d|unexpected token|syntaxerror|typeerror|^bad |invalid token/i.test(raw))return fail;if(/daily lookup limit|confirm your email|sign in again|turned off|isn't set up|aren't switched on|lookups are paused|price alerts aren't|send a photo|skips |under 2 MB|set an alert price|couldn't read the|no items|missing name|photo id isn't available|choose a category before photo id|this month's lookups|today's price alerts/i.test(raw)&&raw.length<180)return raw;return fail}
function publicAppUrl(){
  var path=location.pathname.replace(/index\.html$/,"");
  var host=location.hostname;
  if(location.protocol==="https:"&&host.endsWith("github.io"))return location.origin+path;
  if((location.protocol==="http:"||location.protocol==="https:")&&(host==="localhost"||host==="127.0.0.1"))return location.origin+path;
  return "https://ace0nbase.github.io/gear-locker/";
}
function withAppQuery(pairs){
  var q=new URLSearchParams();
  if(window.GEAR_QA)q.set("env","emulator");
  Object.keys(pairs||{}).forEach(function(k){q.set(k,pairs[k])});
  var s=q.toString();
  return publicAppUrl()+(s?"?"+s:"");
}
var all=[], filter="All", editing=null, delArmed=false, dir=null, retailDirty=false, valueDirty=false;
var categoryAnswers={};
var categoryAnswersReady=typeof window==="undefined"||!window.FIREBASE_CONFIG;
var live=()=>all.filter(i=>!i.deleted);
$("fCat").innerHTML=`<option value="">Choose a category</option>`+CATS.map(c=>`<option>${esc(c)}</option>`).join("");
function toast(t,ms){
  if(typeof swReloadPending!=="undefined"&&swReloadPending){toast.q=t;if(typeof showUpdateToast==="function")showUpdateToast();return}
  const el=$("toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,ms||2200);
}

/* ---------- storage: gear.json in the chosen folder, plus a local mirror ---------- */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("gearLocker",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function kv(op,key,val){const db=await idb();return new Promise((res,rej)=>{const tx=db.transaction("kv",op==="get"?"readonly":"readwrite");const st=tx.objectStore("kv");const r=op==="get"?st.get(key):st.put(val,key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function mirror(){try{localStorage.setItem(LS,JSON.stringify(all));localStorage.setItem(LSK,JSON.stringify(kits));localStorage.setItem(LSD,JSON.stringify(db))}catch{}}
function mergeKits(a,b){const o={...a};for(const k in (b||{})){if(!o[k]||(b[k].updatedAt||"")>(o[k].updatedAt||""))o[k]=b[k]}return o}
function merge(a,b){const m=new Map();[...a,...b].forEach(i=>{if(!i||!i.id)return;const p=m.get(i.id);if(!p){m.set(i.id,i);return}const winner=(i.updatedAt||"")>(p.updatedAt||"")?i:p;m.set(i.id,GearLogic.keepMovedCategory(winner,p,i))});return [...m.values()]}
async function readFile(){
  if(!dir)return null;
  try{const fh=await dir.getFileHandle(FILE);const txt=await (await fh.getFile()).text();const j=JSON.parse(txt||"{}");return {items:Array.isArray(j.items)?j.items:[],kits:(j.kits&&typeof j.kits==="object")?j.kits:{},db:Object.fromEntries(COLS.map(c=>[c,Array.isArray(j[c])?j[c]:[]]))}}
  catch(e){if(e.name==="NotFoundError")return {items:[],kits:{},db:emptyDb()};throw e}
}
async function writeFile(){
  if(!dir)return;
  const disk=await readFile().catch(()=>null);
  if(disk){all=merge(all,disk.items);kits=mergeKits(kits,disk.kits);COLS.forEach(c=>db[c]=merge(db[c],disk.db[c]))}
  const fh=await dir.getFileHandle(FILE,{create:true});
  const w=await fh.createWritable();
  await w.write(JSON.stringify({app:"War Box",version:1,savedAt:now(),items:all,kits,...db},null,2));
  await w.close();
}
async function syncFromDisk(){
  if(!dir)return;
  try{const disk=await readFile();if(disk){const before=JSON.stringify([all,kits,db]);all=merge(all,disk.items);kits=mergeKits(kits,disk.kits);COLS.forEach(c=>db[c]=merge(db[c],disk.db[c]));const migrated=applyCategoryMigration();if(JSON.stringify([all,kits,db])!==before||migrated){mirror();render();pushCloudSoon();if(migrated)persist();if(editing){const fresh=all.find(i=>i.id===editing.id);if(fresh){editing=fresh;showPrice(fresh)}}}}}
  catch{}
}
async function persist(){
  mirror();
  try{await pushCloudSoon()}catch{}
  if(!dir){$("status").textContent=cloudUser?"":"Saved on this device only.";return}
  try{await writeFile();mirror();$("status").textContent=`Saved to ${dir.name}\\${FILE} · ${new Date().toLocaleTimeString()}`}
  catch{$("status").textContent="Couldn't write to the save folder. Choose folder again to reconnect.";showConnect(true)}
}
function appleHandheld(){return /iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)}
function showConnect(reconnect){if(window.FIREBASE_CONFIG)return;
  if(!window.showDirectoryPicker||appleHandheld()){$("connect").hidden=true;return}
  try{if(!reconnect&&localStorage.getItem("gearLocker.noFolder")==="1")return}catch{}
  $("connect").hidden=false;
  $("connectBtn").textContent=reconnect?"Reconnect folder":"Choose folder";
  $("connectMsg").innerHTML=reconnect?"War Box needs your OK to open its save file in the <b>War Box</b> folder again. Choose Reconnect folder.":"Optional: keep a backup file of your gear in a folder on this computer. On the computer that runs the price and weight lookups, pick the <b>War Box</b> folder.";
}
$("connectLater").onclick=()=>{try{localStorage.setItem("gearLocker.noFolder","1")}catch{};$("connect").hidden=true};
$("connectBtn").onclick=async()=>{
  try{
    let h=await kv("get","dir").catch(()=>null);
    if(h&&(await h.requestPermission({mode:"readwrite"}))==="granted"){dir=h}
    else{ if(!window.showDirectoryPicker){$("connectMsg").textContent="This browser can't save to a folder.";return}
      dir=await window.showDirectoryPicker({id:"gearlocker",mode:"readwrite"}); await kv("put","dir",dir); }
    $("connect").hidden=true;
    // A folder saved under the previous name still turns lookups on. The picker id above stays so the browser keeps that permission.
    if(dir.name==="War Box"||dir.name==="Gear Locker")kits={...kits,_settings:{...(kits._settings||{}),lookups:true,updatedAt:now()}};
    await syncFromDisk(); await persist(); render();
    toast("Connected to "+dir.name);
  }catch(e){if(e?.name!=="AbortError")toast("Couldn't open that folder. Try again.")}
};
function magShelfRows(){
  const rows=[];
  const take=list=>{(list||[]).forEach(r=>{if(r&&!r.deleted&&GearLogic.magShelfPending(r))rows.push(r)})};
  take(all);COLS.forEach(c=>take(db[c]));
  return rows;
}
function showMagShelfPrompt(){
  const el=$("magSheet");if(!el)return;
  const rows=magShelfRows();
  if(!rows.length){el.hidden=true;if(typeof showBeltRigPrompt==="function")showBeltRigPrompt();else if(typeof syncLock==="function")syncLock();return}
  el.querySelector(".panel").innerHTML=`<h2>These were on Mags &amp; Ammo Storage</h2>
    <p class="hint">They are now under Ammo Storage &amp; Loaders. Prices and store links stay off until you answer. Move a magazine or a belt to Magazines &amp; Belts if it belongs there. That shelf does not look up prices or stores. Nothing moves because of its name. Dismiss keeps them on Ammo Storage &amp; Loaders, with prices and store links on.</p>
    <div class="links">${rows.map(r=>`<div class="pk"><span class="pkn"><b>${esc(r.name||"Untitled")}</b><small>${esc([r.brand,r.category].filter(Boolean).join(" · "))}</small></span><button class="btn ghost" type="button" data-mag="move" data-id="${esc(r.id)}">Move to Magazines &amp; Belts</button></div>`).join("")}</div>
    <div class="actions"><button class="btn ghost" type="button" data-mag="dismiss">Dismiss</button><button class="btn" type="button" data-mag="move-all">Move all to Magazines &amp; Belts</button></div>`;
  el.hidden=false;if(typeof syncLock==="function")syncLock();
}
async function applyMagShelfAnswer(action,id){
  const stamp=now();
  const pending=magShelfRows();
  const entries=[];
  if(action==="dismiss")pending.forEach(r=>entries.push({id:r.id,prompt:"storage",action:"dismiss",category:GearLogic.STORAGE_CATEGORY,at:stamp}));
  else if(action==="move-all")pending.forEach(r=>entries.push({id:r.id,prompt:"storage",action:"move",category:GearLogic.MAGAZINES_CATEGORY,at:stamp}));
  else if(action==="move"&&id)entries.push({id,prompt:"storage",action:"move",category:GearLogic.MAGAZINES_CATEGORY,at:stamp});
  rememberCategoryAnswers(entries);
  const take=list=>GearLogic.answerMagShelf(list,action,id,stamp).records;
  all=take(all);COLS.forEach(c=>{db[c]=take(db[c])});
  await persist();render();showMagShelfPrompt();
}
document.addEventListener("click",e=>{
  const b=e.target.closest("#magSheet [data-mag]");if(!b)return;
  e.preventDefault();applyMagShelfAnswer(b.dataset.mag,b.dataset.id||"");
});
function loadCategoryAnswers(){
  try{categoryAnswers=JSON.parse(localStorage.getItem("gearLocker.categoryAnswers")||"{}")||{}}catch{categoryAnswers={}}
  if(!categoryAnswers||typeof categoryAnswers!=="object")categoryAnswers={};
}
function rememberCategoryAnswers(entries){
  if(!categoryAnswers||typeof categoryAnswers!=="object")categoryAnswers={};
  (entries||[]).forEach(e=>{if(!e||!e.id)return;categoryAnswers[e.id]={prompt:e.prompt,action:e.action,category:e.category||"",at:e.at||now()}});
  try{localStorage.setItem("gearLocker.categoryAnswers",JSON.stringify(categoryAnswers))}catch{}
  if(typeof pushCategoryAnswers==="function")pushCategoryAnswers();
}
function taggedRows(match,list,wish){
  const rows=[];
  (list||[]).forEach(r=>{if(r&&!r.deleted&&match(r))rows.push({...r,_wish:!!wish})});
  return rows;
}
function beltRigRows(){
  const rows=taggedRows(GearLogic.beltRigPending,all,false);
  COLS.forEach(c=>taggedRows(GearLogic.beltRigPending,db[c],c==="wish").forEach(r=>rows.push(r)));
  return rows;
}
function magazinesBeltRows(){
  const rows=taggedRows(GearLogic.magazinesBeltPending,all,false);
  COLS.forEach(c=>taggedRows(GearLogic.magazinesBeltPending,db[c],c==="wish").forEach(r=>rows.push(r)));
  return rows;
}
function promptLine(r,buttons){
  const meta=[r._wish?"Wishlist":"",r.brand,r.category].filter(Boolean).join(" · ");
  return `<div class="pk"><span class="pkn"><b>${esc(r.name||"Untitled")}</b><small>${esc(meta)}</small></span><span class="pkbtns">${buttons}</span></div>`;
}
function showBeltRigPrompt(){
  const el=$("beltSheet");if(!el)return;
  const mag=$("magSheet");
  if(mag&&!mag.hidden){el.hidden=true;if(typeof syncLock==="function")syncLock();return}
  const belts=beltRigRows();
  const mags=magazinesBeltRows();
  if(!belts.length&&!mags.length){el.hidden=true;if(typeof syncLock==="function")syncLock();return}
  const beltHtml=belts.length?`<h2>These were on Belts &amp; Rigs</h2>
    <p class="hint">They are now under Belts. That shelf is battle belts, duty belts, and rigger's belts, and prices stay on. Move a chest rig or a plate carrier to Armor &amp; Carriers if it belongs there. Nothing moves because of its name.</p>
    <div class="links">${belts.map(r=>promptLine(r,`<button class="btn ghost" type="button" data-belt="move" data-id="${esc(r.id)}">Move to Armor &amp; Carriers</button>`)).join("")}</div>`:"";
  const magHtml=mags.length?`<h2>These were on Magazines &amp; Belts</h2>
    <p class="hint">They are now under Magazines. That shelf is magazines only, such as a PMAG or a Glock mag, and it does not keep a price. Move a mag pouch to Pouches, or move something else to Belts or to Ammo Storage &amp; Loaders if it belongs there. Nothing moves because of its name.</p>
    <div class="links">${mags.map(r=>promptLine(r,`<button class="btn ghost" type="button" data-belt="move-belts" data-id="${esc(r.id)}">Move to Belts</button><button class="btn ghost" type="button" data-belt="move-pouches" data-id="${esc(r.id)}">Move to Pouches</button><button class="btn ghost" type="button" data-belt="move-storage" data-id="${esc(r.id)}">Move to Ammo Storage &amp; Loaders</button>`)).join("")}</div>`:"";
  el.querySelector(".panel").innerHTML=`${beltHtml}${magHtml}<div class="actions"><button class="btn ghost" type="button" data-belt="dismiss">Dismiss</button></div>`;
  el.hidden=false;if(typeof syncLock==="function")syncLock();
}
async function applyBeltRigAnswer(action,id){
  const stamp=now();
  if(action==="move-belts"||action==="move-storage"||action==="move-pouches"){
    const dest=action==="move-belts"?GearLogic.BELTS_CATEGORY:action==="move-storage"?GearLogic.STORAGE_CATEGORY:"Pouches";
    rememberCategoryAnswers([{id,prompt:"magazines",action:"move",category:dest,at:stamp}]);
    const take=list=>GearLogic.answerMagazinesBelt(list,action,id,stamp).records;
    all=take(all);COLS.forEach(c=>{db[c]=take(db[c])});
  }else if(action==="move"){
    rememberCategoryAnswers([{id,prompt:"belt",action:"move",category:GearLogic.ARMOR_CATEGORY,at:stamp}]);
    const take=list=>GearLogic.answerBeltRig(list,"move",id,stamp).records;
    all=take(all);COLS.forEach(c=>{db[c]=take(db[c])});
  }else if(action==="dismiss"){
    const entries=[];
    beltRigRows().forEach(r=>entries.push({id:r.id,prompt:"belt",action:"dismiss",category:GearLogic.BELTS_CATEGORY,at:stamp}));
    magazinesBeltRows().forEach(r=>entries.push({id:r.id,prompt:"magazines",action:"dismiss",category:GearLogic.MAGAZINES_CATEGORY,at:stamp}));
    rememberCategoryAnswers(entries);
    const dropBelt=list=>GearLogic.answerBeltRig(list,"dismiss","",stamp).records;
    const dropMag=list=>GearLogic.answerMagazinesBelt(list,"dismiss","",stamp).records;
    all=dropMag(dropBelt(all));COLS.forEach(c=>{db[c]=dropMag(dropBelt(db[c]))});
  }
  await persist();render();showBeltRigPrompt();
}
document.addEventListener("click",e=>{
  const b=e.target.closest("#beltSheet [data-belt]");if(!b)return;
  e.preventDefault();applyBeltRigAnswer(b.dataset.belt,b.dataset.id||"");
});
function applyCategoryMigration(){
  if(typeof window!=="undefined"&&window.FIREBASE_CONFIG&&typeof cloudUser!=="undefined"&&cloudUser&&!categoryAnswersReady)return false;
  const stamp=now();
  let changed=false;
  const book=categoryAnswers&&typeof categoryAnswers==="object"?categoryAnswers:null;
  const touch=rows=>{const out=GearLogic.migrateRecordCategories(rows,stamp,book);if(out.changed)changed=true;return out.records};
  all=touch(all);
  COLS.forEach(c=>{db[c]=touch(db[c])});
  if(categoryAnswersReady&&typeof showMagShelfPrompt==="function")showMagShelfPrompt();
  return changed;
}
async function boot(){
  if(window.GEAR_QA_BLOCKED)return;
  if(SHARE_ID&&window.FIREBASE_CONFIG){showSharedPage();return}
  if(window.FIREBASE_CONFIG&&!cloudUser){startCloud();return}
  loadCategoryAnswers();
  try{all=JSON.parse(localStorage.getItem(LS)||"[]")}catch{all=[]}
  try{kits=JSON.parse(localStorage.getItem(LSK)||"{}")||{}}catch{kits={}}
  try{const d=JSON.parse(localStorage.getItem(LSD)||"{}")||{};COLS.forEach(c=>db[c]=Array.isArray(d[c])?d[c]:[])}catch{db=emptyDb()}
  if(applyCategoryMigration())await persist();
  render();
  if(!window.showDirectoryPicker)return;
  try{
    const h=await kv("get","dir");
    if(!h){showConnect(false);return}
    const p=await h.queryPermission({mode:"readwrite"});
    if(p==="granted"){dir=h;await syncFromDisk();render();$("status").textContent=`Saving to ${dir.name}\\${FILE}`}
    else showConnect(true);
  }catch{showConnect(false)}
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncFromDisk()});
window.addEventListener("focus",syncFromDisk);
setInterval(()=>{if(!document.hidden)syncFromDisk()},60000);

/* ---------- list ---------- */
function render(){
  if(typeof afterRender==="function")afterRender();
  const items=live();
  const q=$("q").value.trim().toLowerCase(), sort=$("sort").value;
  const totQty=items.reduce((a,i)=>a+(+i.qty||0),0), totVal=items.reduce((a,i)=>a+(+i.qty||0)*GearLogic.countedValue(i),0);
  $("sItems").textContent=items.length;$("sQty").textContent=totQty;$("sCats").textContent=new Set(items.map(i=>i.category)).size;$("sVal").textContent=money(totVal);{const pd=items.reduce((a,i)=>a+(+i.qty||0)*(+i.paid||0),0);$("sPaid").textContent=pd?` · paid ${money(pd)}`:""}
  const queued=window.LOOKUP_URL?0:items.filter(i=>i.marketCheck==="requested").length;
  $("sub").textContent=`KIT INVENTORY · ${items.length} LINE ITEMS${queued?` · ${queued} QUEUED FOR MARKET CHECK`:""}`;
  const counts={};items.forEach(i=>counts[i.category]=(counts[i.category]||0)+1);
  if(filter!=="All"&&!counts[filter])filter="All";
  $("chips").innerHTML=["All",...CATS.filter(c=>counts[c])].map(c=>`<button type="button" class="chip" aria-pressed="${c===filter}" data-c="${esc(c)}">${esc(c)}<small>${c==="All"?items.length:counts[c]}</small></button>`).join("");
  $("locations").innerHTML=[...new Set(items.map(i=>i.location).filter(Boolean))].map(v=>`<option>${esc(v)}</option>`).join("");
  let rows=items.filter(i=>(filter==="All"||i.category===filter)&&(!q||[i.name,i.brand,i.color,i.location,i.notes,i.category,i.serial,i.armId].join(" ").toLowerCase().includes(q)));
  const sortKey=sort==="on"?"name":sort;
  const key={name:i=>(i.name||"").toLowerCase(),loc:i=>(i.location||"~").toLowerCase()}[sortKey]||(i=>(i.name||"").toLowerCase());
  rows.sort(sortKey==="val"?(a,b)=>(b.qty*GearLogic.countedValue(b)||0)-(a.qty*GearLogic.countedValue(a)||0):(a,b)=>key(a).localeCompare(key(b)));
  if(!items.length){$("list").innerHTML=`<div class="empty"><b>Locker's empty</b>Add your first item with <em>+ Add item</em>. Work through one area at a time: carrier, belt, pouches, med, packs.</div>`;return}
  if(!rows.length){$("list").innerHTML=`<div class="empty">No items match that search.</div>`;return}
  $("list").innerHTML=CATS.filter(c=>rows.some(r=>r.category===c)).map(c=>{const g=rows.filter(r=>r.category===c);const gq=g.reduce((a,i)=>a+(+i.qty||0),0),gv=g.reduce((a,i)=>a+(+i.qty||0)*GearLogic.countedValue(i),0);
    return `<section class="group"><div class="ghead"><h3>${esc(c)}</h3><span>${gq} pcs${gv?` · ${money(gv)}`:""}</span></div>
    <div class="row colhead" aria-hidden="true"><span>Qty</span><span>Item</span><span>Stored</span><span>Cond.</span><span style="text-align:right">Value</span></div>
    ${g.map(i=>`<button type="button" class="row" data-id="${esc(i.id)}"><span class="qty">${+i.qty||0}×</span>
      <span class="nm">${esc(i.name)}${i.nick?` <span class="tag">${esc(i.nick)}</span>`:""}<small>${esc([i.brand,i.color,i.category==="Firearms"?(i.caliber?i.caliber+" · ":"")+roundsFired(i.id).toLocaleString()+" rds":"",wtText(i)].filter(Boolean).join(" · "))}</small><small class="where">${esc(i.category)}${i.mountedOn&&itemById(i.mountedOn)?" · on "+esc(itemById(i.mountedOn).name):""}${onLoan(i.id)?" · on loan":""}</small></span>
      <span class="meta">${esc(i.location||"—")}</span>
      <span class="cond ${esc(i.condition)}">${esc((i.condition||"").replace("-"," "))}</span>
      <span class="val">${GearLogic.countedValue(i)?money(i.qty*GearLogic.countedValue(i)):"—"}${lookingUp.has(i.id)?`<span class="tag">looking up…</span>`:GearLogic.saleRestricted(i)||GearLogic.magShelfPending(i)?"":(i.marketCheck==="requested"&&!window.LOOKUP_URL)?`<span class="tag">check queued</span>`:i.priceSource==="market"?`<span class="tag">market</span>`:""}</span></button>`).join("")}</section>`}).join("");
}

/* ---------- pricing ---------- */
function saleDraft(){
  return {name:$("fName").value,brand:$("fBrand").value,category:$("fCat").value,caliber:$("fCal")?.value||"",arm:$("fArm")?.value||""};
}
function restrictedRetailShown(item){
  if(!item||item.priceSource==="market"||item.priceSource==="auto")return false;
  return item.priceSource==="manual"||+item.retailNew>0;
}
function restrictedValueShown(item){
  if(!item||item.priceSource==="market"||item.priceSource==="auto")return !!(item&&item.valueSource==="manual");
  return item.valueSource==="manual"||+item.value>0;
}
function syncSaleFields(){
  const restricted=GearLogic.saleRestricted(saleDraft());
  const retail=$("fRetail").closest(".f");if(retail)retail.hidden=false;
  const lab=$("fVal").closest(".f")?.querySelector("label");if(lab)lab.textContent=restricted?"Insured value ($)":"Value each ($)";
  $("fVal").placeholder=restricted?"What you insure it for":"Auto from retail";
  if($("mktBtn")&&!lookingUp.has(editing?.id))$("mktBtn").textContent=restricted?"Look up weight":"Market check";
  if(restricted&&!retailDirty&&!valueDirty){
    if(!restrictedRetailShown(editing))$("fRetail").value="";
    else if(editing&&$("fRetail").value==="")$("fRetail").value=editing.retailNew||"";
    if(!restrictedValueShown(editing))$("fVal").value="";
    else if(editing&&$("fVal").value==="")$("fVal").value=editing.value||"";
  }else if(!restricted&&!retailDirty&&!valueDirty&&editing){
    if($("fRetail").value===""&&editing.retailNew)$("fRetail").value=editing.retailNew;
    if($("fVal").value===""&&editing.value)$("fVal").value=editing.value;
  }
  if(restricted)showPrice(editing||saleDraft());
  syncCatHint();
}
function syncCatHint(){
  const el=$("fCatHint");if(!el)return;
  const t=(GearLogic.CATEGORY_HINTS||{})[$("fCat").value]||"";
  el.hidden=!t;el.textContent=t;
}
function autoValue(){
  if(valueDirty)return;
  if(GearLogic.saleRestricted(saleDraft()))return;
  if(editing&&+editing.value>0)return;
  const r=parseFloat($("fRetail").value);
  if(r>0)$("fVal").value=Math.round(r*(FACTOR[$("fCond").value]??0.6));
}
$("fRetail").oninput=()=>{retailDirty=true;autoValue()};$("fCond").onchange=()=>{autoValue();syncSaleFields()};
["fName","fBrand","fCat","fCal","fArm"].forEach(id=>{const el=$(id);if(!el)return;el.addEventListener("input",syncSaleFields);el.addEventListener("change",syncSaleFields)});
$("fVal").oninput=()=>{valueDirty=true};
function marketSourceText(item){
  if(GearLogic.saleRestricted(item)||GearLogic.magShelfPending(item))return "";
  const rows=GearLogic.stripGunMarketSources(item&&item.marketSources);
  return rows.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label||"source")}</a>`).join(" · ");
}
function showPrice(i){
  const out=$("priceOut");
  if(i&&GearLogic.saleRestricted(i)){
    if(lookingUp.has(i.id)){out.innerHTML=`<span class="tag">Looking up weight…</span><br>This does not search stores or prices.`;return}
    out.textContent="Type the price and the insured value yourself. They are saved with the item. Look up weight does not search stores.";
    return;
  }
  if(i&&GearLogic.magShelfPending(i)){out.textContent="Prices and store links stay off until you answer the shelf question.";return}
  if(i&&lookingUp.has(i.id)){out.innerHTML=`<span class="tag">Looking up…</span><br>Checking eBay, TacSwap and store prices plus the weight.`;return}
  if(i?.marketCheck==="requested"&&!window.LOOKUP_URL){out.innerHTML=`<span class="tag">Market check queued</span><br>Real eBay, TacSwap and store prices fill in on the next check run.`;return}
  if(i?.priceSource==="market"){
    const links=marketSourceText(i);
    out.innerHTML=`<span class="tag">Market check ${esc(i.priceDate||"")}</span><br>${i.retailNew?`New retail <b>${money(i.retailNew)}</b> · `:""}${(i.usedLow||i.usedHigh)?`Used <b>${money(i.usedLow)}–${money(i.usedHigh)}</b> · `:""}This one <b>${money(i.value)}</b>${i.priceNote?`<br>${esc(i.priceNote)}`:""}${links?`<br>${links}`:""}`;return}
  out.textContent="Enter the new retail price and Value each fills in for your condition. Market check looks up real eBay, TacSwap and store prices.";
}

/* ---------- form ---------- */
var formFrom=null;
function openForm(item){
  formFrom=item&&viewing&&!$("detail").hidden?item.id:null;
  $("detail").hidden=true;
  const blocked=!!(item&&GearLogic.saleRestricted(item));
  editing=item||null;delArmed=false;retailDirty=false;valueDirty=false;
  $("formTitle").textContent=item?"Edit item":"Add item";
  $("fName").value=item?.name||"";$("fBrand").value=item?.brand||"";$("fCat").value=item? (GearLogic.migrateCategoryName(item.category)||item.category||"") : (filter!=="All"?filter:"Pouches");
  $("fQty").value=item?.qty??1;$("fColor").value=item?.color||"";$("fCond").value=item?.condition||"Good";
  $("fRetail").value=!item?"":(blocked&&!restrictedRetailShown(item)?"":(item.retailNew||""));$("fVal").value=!item?"":(blocked&&!restrictedValueShown(item)?"":(item.value||""));$("fLoc").value=item?.location||"";$("fNotes").value=item?.notes||"";
  $("delBtn").hidden=!item;$("delBtn").className="btn ghost";$("delBtn").textContent="Delete";
  if(window.LOOKUP_URL){const busy=!!item&&lookingUp.has(item.id);$("mktBtn").disabled=busy;$("mktBtn").textContent=busy?"Looking up…":"Market check"}else{$("mktBtn").disabled=item?.marketCheck==="requested";$("mktBtn").textContent=item?.marketCheck==="requested"?"Check queued":"Market check"}
  $("fMount").innerHTML=mountOpts(item?.id);$("fMount").value=item?.mountedOn||"";
  $("fGun").innerHTML=gunOpts();$("fGun").value=item?.forGun||"";$("fNick").value=item?.nick||"";
  $("fWt").value=item?.weight??"";$("fCal").value=item?.caliber||"";$("fBase").value=item?.baseRounds??"";fireFields();
  showPrice(item);syncSaleFields();
  $("saveMoreBtn").hidden=!!item;$("saveBtn").textContent=item?"Save changes":"Save";
  $("form").hidden=false;resetSheetScroll("formSheet");if(!item)setTimeout(()=>$("fName").focus(),60);syncLock();
}
function closeForm(){$("form").hidden=true;editing=null;syncLock()}
function cancelForm(){const back=formFrom;closeForm();formFrom=null;if(back){const it=all.find(i=>i.id===back&&!i.deleted);if(it)openDetail(it,true)}}
function readForm(){
  return {name:$("fName").value.trim(),brand:$("fBrand").value.trim(),category:$("fCat").value,qty:Math.max(0,parseInt($("fQty").value)||0),
    color:$("fColor").value.trim(),condition:$("fCond").value,retailNew:Math.max(0,Math.round(parseFloat($("fRetail").value)||0)),value:Math.max(0,Math.round(parseFloat($("fVal").value)||0)),
    setupOn:(editing&&editing.setupOn)||"",location:$("fLoc").value.trim(),notes:$("fNotes").value.trim(),
    weight:$("fWt").value===""?null:Math.max(0,+$("fWt").value),mountedOn:$("fMount").value,caliber:$("fCal").value.trim(),
    baseRounds:$("fBase").value===""?"":Math.max(0,parseInt($("fBase").value)||0),
    nick:$("fNick").value.trim(),forGun:$("fCat").value==="Firearms"?"":$("fGun").value};
}
async function saveCurrent(extra){
  const data={...readForm(),...(extra||{}),updatedAt:now()};
  if(!data.name){$("fName").focus();return null}
  if(!data.category){$("fCat").focus();toast("Choose a category");return null}
  let rec;
  if(editing){
    const cur=all.find(i=>i.id===editing.id)||editing;
    rec={...cur,...data};
    all=all.map(i=>i.id===rec.id?rec:i);
  }else{
    rec={id:(crypto.randomUUID?crypto.randomUUID():"g"+Date.now()+Math.random().toString(36).slice(2)),createdAt:data.updatedAt,...data};
    all.push(rec);
  }
  if(rec.weight==null){const renamed=editing&&(editing.name!==rec.name||editing.brand!==rec.brand);if(rec.weightStatus!=="notfound"||renamed){rec.weightStatus="pending";delete rec.weightSource}}
  else if(!editing||+editing.weight!==+rec.weight){rec.weightSource="manual";rec.weightStatus="done"}
  const beforeSnap=editing?{...editing}:null;
  const stamped=GearLogic.stampManualPrices(rec,beforeSnap,{retail:!!retailDirty,value:!!valueDirty});
  Object.keys(rec).forEach(k=>{if(!(k in stamped))delete rec[k]});
  Object.assign(rec,stamped);
  all=all.map(i=>i.id===rec.id?rec:i);
  const choice=GearLogic.explicitCategoryChoice(beforeSnap&&categoryAnswers&&categoryAnswers[rec.id],beforeSnap&&beforeSnap.category,rec.category,rec.updatedAt);
  if(choice){rec.movedAt=choice.movedAt;rememberCategoryAnswers([{id:rec.id,...choice.answer}]);all=all.map(i=>i.id===rec.id?rec:i)}
  render();await persist();return rec;
}
$("addBtn").onclick=()=>openForm();
$("cancelBtn").onclick=cancelForm;
$("q").oninput=render;$("sort").onchange=render;
$("chips").onclick=e=>{const b=e.target.closest(".chip");if(!b)return;filter=b.dataset.c;render()};
$("list").onclick=e=>{const r=e.target.closest(".row[data-id]");if(!r)return;openDetail(all.find(i=>i.id===r.dataset.id))};
$("form").onsubmit=async e=>{
  e.preventDefault();
  const wasEdit=!!editing;
  const rec=await saveCurrent();if(!rec)return;
  toast(wasEdit?"Saved":"Added "+rec.name);
  closeForm();formFrom=null;openDetail(all.find(i=>i.id===rec.id),true);
};
$("saveMoreBtn").onclick=async()=>{
  if(!$("form").reportValidity())return;
  const rec=await saveCurrent();if(!rec)return;
  toast("Added "+rec.name);
  const k={c:rec.category,l:rec.location,o:rec.setupOn,m:rec.mountedOn,g:rec.forGun};
  openForm();$("fCat").value=k.c;fireFields();$("fLoc").value=k.l;$("fMount").value=k.m||"";$("fGun").value=k.g||"";
};
$("delBtn").onclick=async()=>{
  if(!editing)return;
  if(!delArmed){delArmed=true;$("delBtn").className="btn danger";$("delBtn").textContent="Confirm delete";return}
  all=all.map(i=>i.id===editing.id?{id:i.id,deleted:true,updatedAt:now()}:i);
  closeForm();formFrom=null;viewing=null;$("detail").hidden=true;syncLock();render();await persist();toast("Deleted");
};
if(!window.LOOKUP_URL){$("mktBtn").onclick=async()=>{
  if(GearLogic.saleRestricted(saleDraft())){toast("Weight lookup needs a connection");return}
  const rec=await saveCurrent({marketCheck:"requested",marketCheckAt:now()});if(!rec)return;
  editing=rec;$("mktBtn").disabled=true;$("mktBtn").textContent="Check queued";showPrice(rec);
  toast(dir?"Market check queued":"Queued. Choose your folder so the check can find it.");
};
$("bulkMktBtn").onclick=async()=>{
  const t=now();let n=0;
  all=all.map(i=>{if(i.marketCheck==="requested"||!GearLogic.lookupPlan(i).price||i.priceSource==="market"||i.priceSource==="auto")return i;n++;return{...i,marketCheck:"requested",marketCheckAt:t,updatedAt:t}});
  if(!n){toast("Everything is already market-checked or queued");return}
  render();await persist();toast(`Queued ${n} item${n===1?"":"s"} for a market check`);
};}

/* ---------- print + export ---------- */
function buildPrint(){
  const items=live(),totQty=items.reduce((a,i)=>a+(+i.qty||0),0),totVal=items.reduce((a,i)=>a+(+i.qty||0)*GearLogic.countedValue(i),0);
  let h=`<div class="ph"><div><h1>WAR BOX — INVENTORY</h1><small>Printed ${new Date().toLocaleDateString()} · ${items.length} line items · ${totQty} pieces · Value ${money(totVal)}</small></div><small>PRIVATE — PERSONAL PROPERTY RECORD</small></div>`;
  CATS.forEach(c=>{const g=items.filter(i=>i.category===c).sort((a,b)=>(a.name||"").localeCompare(b.name||""));if(!g.length)return;
    const gq=g.reduce((a,i)=>a+(+i.qty||0),0),gv=g.reduce((a,i)=>a+(+i.qty||0)*GearLogic.countedValue(i),0);
    h+=`<table><thead><tr class="cat"><th colspan="8">${esc(c.toUpperCase())} — ${gq} pcs${gv?" · "+money(gv):""}</th></tr><tr><th>✓</th><th>Qty</th><th>Item</th><th>Brand / model</th><th>Color</th><th>Stored</th><th>Cond.</th><th class="r">Value</th></tr></thead><tbody>`+
      g.map(i=>{const v=GearLogic.countedValue(i);return `<tr><td><span class="box"></span></td><td class="r">${+i.qty||0}</td><td>${esc(i.name)}</td><td>${esc(i.brand)}</td><td>${esc(i.color)}</td><td>${esc(i.location)}</td><td>${esc((i.condition||"").replace("-"," "))}</td><td class="r">${v?money(i.qty*v):"—"}</td></tr>`}).join("")+`</tbody></table>`});
  h+=`<p class="sign">Verified by: ______________________________ &nbsp;&nbsp; Date: ______________</p>`;
  $("printSheet").innerHTML=h;
}
$("printBtn").onclick=()=>{if(!live().length){toast("Add some gear first");return}buildPrint();window.print()};
var printingKit=false;
window.addEventListener("beforeprint",()=>{if(!printingKit)buildPrint()});
window.addEventListener("afterprint",()=>{printingKit=false});
$("csvBtn").onclick=()=>{
  const items=live();if(!items.length){toast("Add some gear first");return}
  const cols=["category","qty","name","brand","color","condition","retailNew","value","paid","weight","location","notes","priceSource","priceDate"];
  const q=v=>GearLogic.csvCell(v);
  const sorted=CATS.flatMap(c=>items.filter(i=>i.category===c).sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
  const csv="﻿"+[["Category","Qty","Item","Brand/Model","Color","Condition","New retail","Value each","Paid each","Weight (oz)","Stored","Notes","Price source","Price date"].map(q).join(","),...sorted.map(i=>cols.map(k=>q(GearLogic.csvExportField(i,k))).join(","))].join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`war-box-inventory-${today()}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
};

/* ---------- kits ---------- */
var S={ // slot library: [label, categories, keywords, tip, exclude]
 carrier:["Plate carrier / chest rig",["Armor & Carriers","Belts","Belts & Rigs"],["plate carrier","carrier","jpc","avs","apc","chest rig","spc","fcpc","lv-119","slickster","micro rig","mk3","mk4"],"A plate carrier or chest rig, filed under Armor & Carriers.",["belt"]],
 plates:["Armor plates",["Armor & Carriers"],["plates","plate set","level iii","level iv","lvl iii","lvl iv","iiia","sapi","esapi","armor insert","hesco","rmr"],"Rifle-rated plates sized for your carrier.",["carrier","bag","pouch"]],
 belt:["Battle belt",["Belts","Belts & Rigs"],["belt"],"A battle belt, duty belt, or rigger's belt for a holster, pistol mags, and a TQ.",[]],
 riflemag:["Rifle mag pouches",["Pouches","Ammo Storage & Loaders","Mags & Ammo Storage","Magazines","Magazines & Belts","Armor & Carriers"],["m4","5.56","556","rifle mag","ar mag","ar-15","kywi","mag pouch","magazine pouch","triple mag","double mag","7.62","308","placard","tacos"],"Pouches for at least 3 rifle mags.",["pistol"]],
 pistolmag:["Pistol mag pouch",["Pouches","Ammo Storage & Loaders","Mags & Ammo Storage","Magazines","Magazines & Belts"],["pistol mag","pistol","9mm","handgun","glock"],"One or two pistol mag pouches on the belt.",[]],
 mags:["Rifle magazines",["Magazines","Magazines & Belts","Ammo Storage & Loaders","Mags & Ammo Storage"],["pmag","magazine","mags","lancer","gen m3","5.56","556","ar-15","ar15","m4","7.62","308"],"Enough loaded mags to fill your pouches.",["pouch","pistol","glock","9mm","handgun","p320","sig 365","m&p","loader"]],
 ifak:["IFAK / trauma kit",["Medical","Pouches"],["ifak","trauma","med kit","medical kit","blowout","first aid","medical pouch"],"A stocked IFAK: gauze, pressure dressing, chest seals.",[]],
 tq:["Tourniquet",["Medical"],["tourniquet","tq","cat gen","sof-t","sof t","sam xt","rmt"],"At least one TQ reachable with either hand.",["holder","pouch"]],
 helmet:["Helmet",["Helmet & Head"],["helmet","ops-core","opscore","high cut","bump","team wendy"],"Ballistic or bump helmet.",["cover","mount","bag"]],
 headset:["Hearing protection / headset",["Comms & Radios","Helmet & Head"],["headset","comtac","amp","peltor","sordin","ear pro","earpro","muffs","earplug","ear plug","walker"],"Electronic ear pro or a comms headset.",[]],
 radio:["Radio",["Comms & Radios"],["radio","baofeng","prc","mbitr","handheld","uv-5r","yaesu","kenwood","motorola","icom"],"A handheld radio with a charged battery.",["pouch"]],
 nvg:["Night vision / thermal",["NVG & Optics"],["nvg","pvs","bnvd","night vision","nod","thermal","mum","ps31","gpnvg","rpnvg","1431","dtnvs"],"A night vision device or thermal.",["mount","shroud"]],
 mount:["NVG mount",["Helmet & Head","NVG & Optics"],["mount","shroud","wilcox","g24","l4g24","dovetail","j-arm","j arm","bridge"],"Helmet shroud and mount for your NODs.",[]],
 wlight:["Weapon light",["Lights & Lasers"],["surefire","modlite","cloud defensive","streamlight","weapon light","scout","m600","m300","rein","owl","ok1","tlr"],"A weapon-mounted white light.",["headlamp"]],
 laser:["IR laser / aiming device",["Lights & Lasers"],["peq","dbal","ngal","laser","ir aiming","perst","mawl","ld-ir"],"An IR aiming laser for use under NODs.",[]],
 headlamp:["Headlamp",["Lights & Lasers","Helmet & Head"],["headlamp","head lamp","manta","petzl","signal light"],"Hands-free light, ideally with red mode.",[]],
 pack:["Assault pack / ruck",["Packs & Bags"],["pack","ruck","backpack","assault","daypack","3 day","3-day","satl","mystery ranch","eberlestock","goruck"],"A pack sized for the mission length.",["range bag","dry bag","fanny","case","range backpack"]],
 water:["Hydration",["Packs & Bags","Misc"],["hydration","camelbak","bladder","canteen","water bottle","nalgene","source","bottle","reservoir"],"Carry at least 2–3 L of water.",[]],
 sling:["Rifle sling",["Holsters & Slings"],["sling","vcas","blue force"],"A two-point sling.",[]],
 holster:["Pistol holster",["Holsters & Slings"],["holster","safariland","bravo","tier 1","t.rex","phlster"],"A retention holster for your pistol.",[]],
 knife:["Fixed blade knife",["Knives & Tools"],["knife","fixed blade","ka-bar","kabar","esee","benchmade","dagger","machete","blade"],"A sturdy fixed blade.",[]],
 tool:["Multitool",["Knives & Tools"],["multitool","multi-tool","leatherman","gerber"],"A multitool for repairs.",[]],
 gloves:["Gloves",["Clothing & Boots"],["glove","mechanix","pig","hwi"],"Shooting or work gloves.",[]],
 boots:["Boots",["Clothing & Boots"],["boot","salomon","merrell","danner","lowa","garmont","crispi","altama","nike sfb"],"Boots suited to the terrain.",[]],
 camo:["Uniform / combat clothing",["Clothing & Boots"],["combat shirt","combat pant","uniform","g3","g4","ubacs","field shirt","field pant","pants","shirt","blouse"],"A uniform in a pattern that fits the terrain.",["boot","glove"]],
 rain:["Rain / wind shell",["Clothing & Boots"],["rain","shell","hardshell","softshell","windbreaker","poncho","gore-tex","goretex","wind shirt"],"A waterproof or windproof outer layer.",["liner","notebook","rite in the rain","paper","pen"]],
 insul:["Insulation layer",["Clothing & Boots"],["fleece","puffy","insulated","parka","primaloft","alpha","down jacket","grid","level 7","level 3","base layer","thermal","woobie hoodie"],"A warm layer for cold mornings and nights.",[]],
 coldhead:["Cold-weather headwear",["Clothing & Boots","Helmet & Head"],["beanie","balaclava","watch cap","gaiter","neck warmer"],"Beanie or balaclava.",[]],
 eyepro:["Eye protection",["Helmet & Head","Clothing & Boots","Misc"],["eye pro","eyepro","glasses","goggles","oakley","revision","esp","wiley","smith optics"],"Ballistic glasses or goggles.",[]],
 drybag:["Dry bags / waterproofing",["Packs & Bags","Misc"],["dry bag","drybag","dry sack","waterproof","roll top","sealline","pack liner"],"Dry bags or a pack liner for electronics and clothes.",[]],
 pfd:["Flotation / PFD",["Misc","Armor & Carriers"],["pfd","life vest","life jacket","flotation","float"],"Inflatable or foam flotation.",[]],
 bug:["Insect protection",["Misc","Clothing & Boots"],["bug","insect","mosquito","head net","permethrin","deet"],"Head net and repellent.",[]],
 sun:["Sun protection / headwear",["Clothing & Boots","Helmet & Head"],["boonie","hat","cap","shemagh","sun hoodie","gaiter","buff","sunscreen"],"Boonie or cap plus a shemagh or gaiter.",["beanie"]],
 nav:["Navigation",["Misc","Knives & Tools","Comms & Radios"],["compass","gps","map","garmin","cammenga","suunto","inreach"],"Compass and map at minimum.",[]],
 shelter:["Shelter / sleep system",["Misc","Packs & Bags"],["tarp","bivy","poncho liner","woobie","sleeping bag","tent","hammock","emergency blanket"],"Tarp, bivy or poncho liner.",[]],
 fire:["Fire starting",["Misc","Knives & Tools"],["ferro rod","fire starter","firestarter","fire steel","firesteel","lighter","matches","tinder","bic "],"Lighter plus a ferro rod.",[]],
 filter:["Water filter",["Misc"],["filter","sawyer","lifestraw","katadyn","purif","grayl","aquatab"],"Filter or purification tablets.",[]],
 clean:["Cleaning kit",["Cleaning & Maintenance"],["clean","otis","bore","lube","cleaning","brush","rod"],"Field cleaning kit and lube.",[]],
 rangebag:["Range bag",["Cases & Bags","Packs & Bags"],["range bag","range backpack","shooting bag"],"A bag for ammo, targets and tools.",[]],
 guncase:["Rifle case / bag",["Cases & Bags"],["rifle case","rifle bag","gun case","gun bag","soft case","hard case","double rifle","sbr bag","discreet","long gun","pelican 1700","pelican 1720","pelican 1750","rifle"],"A padded case or bag to transport the long gun.",["pistol","range bag"]],
 pistolcase:["Pistol case",["Cases & Bags"],["pistol case","handgun case","pistol rug","pistol bag","pistol"],"A lockable pistol case or rug.",["holster","mag","rifle"]],
 ammocan:["Ammo can / ammo bag",["Ammo Storage & Loaders","Mags & Ammo Storage","Magazines","Magazines & Belts","Cases & Bags"],["ammo can","ammo box","ammo bag","ammo crate","ammo"],"Ammo for the day, plus extra.",[]],
 pistolmags:["Pistol magazines",["Magazines","Magazines & Belts","Ammo Storage & Loaders","Mags & Ammo Storage"],["pistol","glock","9mm","handgun","p320","sig 365","m&p","45 acp",".45"],"At least 3–4 pistol mags.",["pouch","loader","case","holster"]],
 timer:["Shot timer",["Misc","Knives & Tools"],["shot timer","timer","pact","amg","ced7000","special pie","competition electronics"],"A shot timer to measure drills.",[]],
 targets:["Targets & stapler",["Misc"],["target","stapler","pasters","staple","steel","ipsc","uspsa","b-8","b8"],"Targets, pasters and a stapler or clips.",[]],
 loader:["Mag loader",["Ammo Storage & Loaders","Mags & Ammo Storage","Magazines","Magazines & Belts","Knives & Tools"],["loader","uplula","maglula","lula","speed loader","stripper"],"A mag loader saves your thumbs.",[]],
 notebook:["Data book / notebook",["Misc"],["data book","databook","dope","notebook","rite in the rain","log book","logbook","notepad"],"Something to log drills, dope or frequencies.",[]],
 bipod:["Bipod / rear bag",["NVG & Optics","Misc","Cases & Bags"],["bipod","rear bag","squeeze bag","harris","atlas","game changer","shooting pillow","tripod"],"Stable support for precision shooting.",[]],
 mat:["Shooting mat",["Misc","Cases & Bags"],["shooting mat","mat","drag bag"],"A mat for prone positions.",[]],
 toolkit:["Armorer / optic tools",["Knives & Tools","Cleaning & Maintenance"],["torque","wrench","armorer","fix it sticks","fix-it sticks","hex","allen","screwdriver","tool kit","toolkit","bit set","real avid"],"Torque driver and bits to fix or re-zero on the line.",[]],
 kneepads:["Knee / elbow pads",["Clothing & Boots","Misc"],["knee pad","kneepad","elbow pad","knee pads","arc'teryx pad"],"Pads for kneeling and prone work.",[]],
 simgear:["FoF mask / protection",["Helmet & Head","Misc"],["sim","fof","force on force","force-on-force","paint","utm","simunition","fof mask","neck protector","groin"],"Sim mask, neck and groin protection.",[]],
 trainer:["Training weapon",["Misc"],["blue gun","rings","sirt","training pistol","trainer","airsoft","gbb","laser trainer","dummy gun","inert"],"A training or sim gun.",[]],
 snapcaps:["Snap caps / dummy rounds",["Ammo Storage & Loaders","Mags & Ammo Storage","Magazines","Magazines & Belts","Misc"],["snap cap","dummy round","dummy rounds","a-zoom","azoom","inert round"],"For malfunction drills and dry fire.",[]],
 traumabag:["Trauma bag / med kit",["Medical","Cases & Bags","Packs & Bags"],["trauma bag","med bag","aid bag","medic","first aid kit","stomp","jump kit"],"A larger med bag for the team.",[]],
 antenna:["Spare / upgraded antenna",["Comms & Radios"],["antenna","whip","nagoya","diamond","yagi","j-pole","jpole","roll-up","slim jim"],"A better antenna is the cheapest range boost.",[]],
 ptt:["PTT / radio cables",["Comms & Radios"],["ptt","push to talk","downlead","radio cable","adapter","kenwood plug"],"PTT and cable to tie radio into the headset.",[]],
 progcable:["Programming cable",["Comms & Radios"],["programming cable","chirp","usb cable","prog cable"],"Cable and laptop to reprogram channels.",[]],
 spot:["Binoculars / rangefinder",["NVG & Optics"],["binocular","bino","spotting","monocular","rangefinder"],"Binos or a rangefinder for observation.",[]],
 batteries:["Spare batteries / power",["Misc","Comms & Radios","Lights & Lasers"],["battery","batteries","cr123","aa ","aaa","18650","power bank","charger"],"Spares for lights, NODs and radio.",[]],
};
var KITS=[
 {type:"env",id:"jungle",name:"Jungle",blurb:"Hot, wet and dense. Keep loads light, kit dry and bugs off you.",colors:["multicam","ranger green","green","od","olive","m81","woodland","tropic"],req:["carrier","riflemag","ifak","tq","pack","water","knife","boots","camo","bug","drybag"],opt:["helmet","headset","radio","rain","nav","shelter","filter","sun","wlight","headlamp","gloves","mags"]},
 {type:"env",id:"desert",name:"Desert",blurb:"Heat, sun and long sightlines. Water, eye pro and earth-tone gear come first.",colors:["coyote","tan","fde","khaki","arid","499","sand","brown","flat dark earth","multicam"],req:["carrier","plates","riflemag","ifak","tq","pack","water","eyepro","sun","boots","camo"],opt:["helmet","headset","radio","gloves","nav","spot","wlight","batteries","mags","insul"]},
 {type:"env",id:"maritime",name:"Maritime",blurb:"On or near the water. Flotation, waterproofing and gear that won't drag you down.",colors:["black","grey","gray","wolf","navy","ranger green","multicam black"],req:["pfd","drybag","carrier","riflemag","ifak","tq","knife","gloves","eyepro","headlamp","radio"],opt:["helmet","headset","rain","insul","boots","water","nav","wlight","laser","nvg"]},
 {type:"env",id:"arctic",name:"Arctic / Cold",blurb:"Below freezing. Layers, warm extremities, fire and power for your electronics.",colors:["white","alpine","grey","gray","wolf","snow"],req:["insul","rain","coldhead","gloves","boots","pack","water","headlamp","fire","shelter","ifak","tq","batteries"],opt:["carrier","riflemag","nav","eyepro","knife","helmet","radio"]},
 {type:"env",id:"urban",name:"Urban Low-Vis",blurb:"Built-up areas. Low-profile colors, white light, and pistol plus rifle readiness.",colors:["black","grey","gray","wolf","navy","khaki"],req:["carrier","plates","riflemag","pistolmag","holster","ifak","tq","wlight","gloves","eyepro","headset"],opt:["helmet","radio","sling","pack","tool","nvg","laser","mount"]},
 {type:"env",id:"woodland",name:"Woodland",blurb:"Temperate forest. Green and earth tones, rain gear and enough to overnight.",colors:["ranger green","od","olive","green","multicam","m81","woodland","coyote"],req:["carrier","riflemag","ifak","tq","pack","water","camo","boots","rain","knife"],opt:["helmet","headset","radio","nav","shelter","fire","filter","headlamp","wlight","gloves","insul","nvg"]},
 {type:"env",id:"mountain",name:"Mountain",blurb:"Elevation and fast weather changes. Layers, navigation and a pack that carries well.",colors:["multicam","coyote","ranger green","grey","gray"],req:["pack","water","insul","rain","boots","gloves","nav","ifak","tq","headlamp","sun"],opt:["carrier","riflemag","spot","shelter","fire","filter","radio","knife","batteries"]},
 {type:"env",id:"night",name:"Night Ops",blurb:"Low light. NODs, IR aiming, comms and enough batteries to last the night.",colors:[],req:["nvg","mount","helmet","laser","wlight","carrier","riflemag","ifak","tq","headset","radio","batteries"],opt:["headlamp","gloves","plates","pack","sling"]},
 {type:"train",id:"range",name:"Range Day",blurb:"Square-range practice. Ear and eye pro, mags, targets, med and a way to fix what breaks.",colors:[],req:["headset","eyepro","mags","pistolmags","holster","sling","targets","loader","ammocan","ifak","tq"],opt:["guncase","pistolcase","belt","riflemag","pistolmag","timer","spot","toolkit","clean","sun","water","batteries","gloves"]},
 {type:"train",id:"pistol",name:"Pistol Course",blurb:"Holster work and movement all day. Belt setup, plenty of mags, ammo and a timer.",colors:[],req:["belt","holster","pistolmag","pistolmags","headset","eyepro","ammocan","ifak","tq"],opt:["pistolcase","timer","loader","notebook","snapcaps","wlight","gloves","toolkit","clean","sun","water","rain"]},
 {type:"train",id:"carbine",name:"Carbine Course",blurb:"Rifle-focused class. Sling, belt or carrier, mags, pads and tools to fix the gun on the line.",colors:[],req:["guncase","sling","mags","riflemag","belt","headset","eyepro","ifak","tq","ammocan"],opt:["carrier","plates","helmet","kneepads","gloves","holster","pistolmag","wlight","toolkit","loader","snapcaps","clean","water","sun","rain","batteries"]},
 {type:"train",id:"lowlight",name:"Low-Light Shoot",blurb:"Dusk into dark. NODs, IR and white light, clear eye pro and every battery you own.",colors:[],req:["nvg","mount","helmet","laser","wlight","headlamp","headset","eyepro","batteries","ifak","tq"],opt:["guncase","mags","riflemag","carrier","gloves","insul","timer","toolkit","radio"]},
 {type:"train",id:"precision",name:"Precision / Long Range",blurb:"Distance work. Support, optics, a data book and tools to adjust and re-zero.",colors:[],req:["guncase","bipod","spot","notebook","headset","eyepro","ammocan","toolkit"],opt:["mat","batteries","clean","sun","water","insul","rain","ifak","tq"]},
 {type:"train",id:"fof",name:"Force-on-Force",blurb:"Sim or UTM training. Protection first, training guns, and gear you don't mind getting marked.",colors:[],req:["simgear","trainer","gloves","kneepads","ifak","tq"],opt:["carrier","helmet","belt","holster","radio","headset","water"]},
 {type:"train",id:"medtrain",name:"Med / TCCC Training",blurb:"Casualty care practice. Your carry IFAK and TQs plus a bigger bag to train from.",colors:[],req:["ifak","tq","traumabag","gloves","headlamp"],opt:["carrier","pack","notebook","radio","kneepads","water"]},
 {type:"train",id:"comms",name:"Comms / Radio Training",blurb:"Field radio work. Radio, antennas, power, cables and a log for frequencies and contacts.",colors:[],req:["radio","antenna","batteries","ptt","headset","notebook"],opt:["progcable","pack","nav","headlamp","rain","insul","shelter","water"]},
 {type:"train",id:"comp",name:"Competition",blurb:"USPSA / 3-Gun style match. Belt rig, lots of mags, loader, ammo and match-day comfort.",colors:[],req:["belt","holster","pistolmag","pistolmags","headset","eyepro","loader","ammocan"],opt:["riflemag","mags","sling","guncase","pistolcase","timer","toolkit","clean","sun","water","rain"]},
 {type:"env",id:"gethome",name:"Get-Home Bag",blurb:"Walk home 1–3 days on your own. Water, shelter, light and low-key looks.",colors:["black","grey","gray","coyote","khaki","olive","navy"],req:["pack","water","filter","ifak","tq","knife","tool","headlamp","fire","shelter","rain","nav","batteries"],opt:["insul","gloves","radio","pistolmag","holster","sun","boots"]},
];
var curKit="range";
var BAG_CATS=["Cases & Bags","Packs & Bags"];
var BAG_PREF={train:["range bag","range backpack","shooting bag","gun bag","rifle bag","bag"],env:["pack","ruck","backpack","assault","3 day","satl"],nvg:["pelican","case","hard case"],comms:["pelican","case","radio bag","pack"]};
function containers(){return live().filter(i=>BAG_CATS.includes(i.category))}
function autoContainer(kit){
  const prefs=kit.id==="comms"?BAG_PREF.comms:kit.id==="night"||kit.id==="lowlight"?[...BAG_PREF.nvg,...BAG_PREF.env]:kit.type==="train"?BAG_PREF.train:BAG_PREF.env;
  const avoid=["rifle case","rifle bag","pistol case","gun case","hydration","bladder","dry bag","ammo"];
  let best=null,bs=0;
  containers().forEach(i=>{const t=itemText(i);if(avoid.some(a=>t.includes(a))&&!(kit.type==="train"&&t.includes("range")))return;
    const k=prefs.findIndex(p=>t.includes(p)); if(k<0)return; const sc=100-k*5+(i.condition==="Needs-repair"?-50:0); if(sc>bs){bs=sc;best=i}});
  return best;
}
function containerFor(kit){const st=kits[kit.id]||{};if(!st.container||st.container==="none")return null;return live().find(i=>i.id===st.container)||null}
var itemText=i=>` ${[i.name,i.brand,i.notes].join(" ")} `.toLowerCase();
var VISIBLE=new Set(["carrier","riflemag","pistolmag","ifak","pack","helmet","camo","rain","insul","belt","sun","coldhead"]);
function colorFit(kit,i,sid){ if(!kit.colors.length||!i.color||(sid&&!VISIBLE.has(sid)))return 0; const c=i.color.toLowerCase(); return kit.colors.some(k=>c.includes(k))?1:-1 }
function score(kit,slotId,i){
  const [, cats, kws, , ex]=S[slotId]; const t=itemText(i);
  if(i.category==="Firearms")return 0;
  if(ex.some(k=>t.includes(k)))return 0;
  const kw=kws.some(k=>hasKw(t,k)), cat=GearLogic.slotAllowsCategory(cats,i.category);
  if(!kw)return 0;
  let sc=5+(cat?2:0)+colorFit(kit,i,slotId)*2;
  if(i.condition==="New"||i.condition==="Good")sc+=1; if(i.condition==="Needs-repair")sc-=3;
  return Math.max(sc,0.5);
}
function suggest(kit,sid,used){return candidates(kit,sid).find(i=>!used.has(i.id))||null}
function candidates(kit,slotId){return live().filter(i=>!onLoan(i.id)).map(i=>({i,s:score(kit,slotId,i)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.i)}
function solve(kit){
  const st=kits[kit.id]||{}; const picks=st.picks||{}; const used=new Set(); const out={};
  const box=containerFor(kit); if(box)used.add(box.id);
  const order=[...kit.req,...kit.opt];
  if(box){const sid=order.find(x=>!(picks[x])&&score(kit,x,box)>0);if(sid)out[sid]=box}
  order.forEach(sid=>{const p=picks[sid]; if(!p||p==="none"){if(!(sid in out))out[sid]=null;return} const it=live().find(i=>i.id===p); if(it){out[sid]=it;used.add(it.id)}});
  // anything mounted on packed gear (pouches on a packed belt, etc.) covers its slot too
  const riders=ridersOf(new Set([...used,...(box?[box.id]:[])]));
  order.forEach(sid=>{if(out[sid])return;const r=riders.find(i=>!used.has(i.id)&&score(kit,sid,i)>0);if(r){out[sid]=r;used.add(r.id)}});
  return out;
}
function coverage(kit){const a=solve(kit);const have=kit.req.filter(s=>a[s]).length;return {a,have,need:kit.req.length,pct:Math.round(100*have/Math.max(1,kit.req.length))}}
async function setKit(kitId,patch){kits={...kits,[kitId]:{...(kits[kitId]||{}),...patch,updatedAt:now()}};renderKits();await persist()}
function renderKits(){
  if(!live().length){$("kitChips").innerHTML="";$("kitDetail").innerHTML=`<div class="empty"><b>No gear yet</b>Add your gear on the Inventory tab. Then pack each kit with the gear you want in it. The kit suggests matching items you own.</div>`;return}
  const chip=k=>{const c=coverage(k);return `<button type="button" class="chip kchip" aria-pressed="${k.id===curKit}" data-k="${k.id}">${esc(k.name)}<small>${c.pct}%</small></button>`};
  $("kitChips").innerHTML=`<div class="kgroup"><span class="klabel">Training</span>${KITS.filter(k=>k.type==="train").map(chip).join("")}</div><div class="kgroup"><span class="klabel">Environments</span>${KITS.filter(k=>k.type==="env").map(chip).join("")}</div>`;
  const kit=KITS.find(k=>k.id===curKit)||KITS[0]; const {a,have,need,pct}=coverage(kit); const st=kits[kit.id]||{};
  const extras=(st.extras||[]).map(id=>live().find(i=>i.id===id)).filter(Boolean);
  const box=containerFor(kit);
  const used=new Set([...Object.values(a).filter(Boolean).map(i=>i.id),...extras.map(i=>i.id),...(box?[box.id]:[])]);
  const sugBox=!box?autoContainer(kit):null;
  const boxOpts=[`<option value="__auto">${sugBox?`Choose a bag (suggest: ${esc(sugBox.name)})`:"No bag chosen"}</option>`,...containers().map(i=>`<option value="${esc(i.id)}"${st.container===i.id?" selected":""}>${esc(i.name)}${i.color?` (${esc(i.color)})`:""}</option>`),`<option value="none"${st.container==="none"?" selected":""}>No bag / carry loose</option>`].join("");
  const riders=ridersOf(used);
  const val=[...[...used].map(id=>live().find(i=>i.id===id)),...riders].reduce((s,i)=>s+(i?GearLogic.countedValue(i):0)*(+i?.qty||1),0);
  const kw=kitWeight([...used,...riders.map(i=>i.id)]);
  const row=(sid,essential)=>{const [label,, ,tip]=S[sid]; const it=a[sid]; const cands=candidates(kit,sid); const picked=(st.picks||{})[sid];
    const viaMount=it&&!(picked&&picked===it.id)&&it.mountedOn&&it.id!==box?.id;
    const opts=[`<option value="__auto"${!picked||picked==="none"?" selected":""}>${viaMount?`On ${esc(itemById(it.mountedOn)?.name||"packed gear")}: ${esc(it.name)}`:"Not packed"}</option>`,...cands.map(i=>`<option value="${esc(i.id)}"${picked===i.id?" selected":""}>${esc(i.name)}${i.color?` (${esc(i.color)})`:""}</option>`)];
    const fit=it?colorFit(kit,it,sid):0;
    const sg=!it?suggest(kit,sid,used):null;
    const pill=!it?(sg?`<button class="btn ghost packBtn" type="button" data-pack="${sid}" data-id="${esc(sg.id)}">Pack it</button>`:`<span class="pill ${essential?"gap":""}">${essential?"Gap":"Optional"}</span>`):onLoan(it.id)?`<span class="pill warn">On loan</span>`:fit<0?`<span class="pill warn">Color off</span>`:`<span class="pill ok">Packed</span>`;
    const meta=it?esc([viaMount?`mounted on ${itemById(it.mountedOn)?.name||""}`:"",it.brand,it.color,it.location?`stored: ${it.location}`:""].filter(Boolean).join(" · ")||"—"):sg?`<span class="meta">You have: <b>${esc(sg.name)}</b>${sg.color?` (${esc(sg.color)})`:""}</span>`:`<span class="meta">${esc(tip)}</span>`;
    return `<div class="slot"><div class="lbl">${esc(label)}${essential?"":"<small>optional</small>"}</div><select data-slot="${sid}" aria-label="${esc(label)}">${opts.join("")}</select><div class="meta">${meta}</div>${pill}</div>`};
  const gaps=kit.req.filter(s=>!a[s]);
  const off=Object.entries(a).filter(([sid,i])=>i&&colorFit(kit,i,sid)<0).map(([s,i])=>`${esc(i.name)} (${esc(i.color)})`);
  const addable=live().filter(i=>!used.has(i.id)).sort((x,y)=>(x.name||"").localeCompare(y.name||""));
  $("kitDetail").innerHTML=`
   <div class="kitHead"><div><h2>${esc(kit.name)}</h2><p>${esc(kit.blurb)}</p>${kit.colors.length?`<div class="palette">Best colors: ${esc(kit.colors.slice(0,6).join(", "))}</div>`:""}</div>
     <div class="meter"><b>${have}/${need}</b> <span>essentials covered</span><div class="bar"><i style="width:${pct}%"></i></div><span>${used.size+riders.length} items · ${money(val)}</span><br><span>${kw.oz?fmtWt(kw.oz):"weight —"} · ${kw.n}/${kw.total} weighed</span></div>
     <div class="kitBtns"><label class="packin"><span>Pack it in</span><select id="kitBox">${boxOpts}</select>${!containers().length?`<small>Add a bag or case under Cases &amp; Bags</small>`:""}</label><button class="btn ghost" type="button" id="kitShare">Share</button><button class="btn ghost" type="button" id="kitPrint">Print packing list</button><button class="btn ghost" type="button" id="kitSuggest">Pack all suggestions</button><button class="btn ghost" type="button" id="kitReset">Clear kit</button></div></div>
   ${gaps.length||off.length?`<div class="gaps"><h3>${gaps.length?`${gaps.length} gap${gaps.length>1?"s":""} to fill`:"Check these"}</h3><ul>${gaps.map(s=>`<li><b>${esc(S[s][0])}</b>: ${esc(S[s][3])}</li>`).join("")}${off.length?`<li>Color doesn't suit ${esc(kit.name.toLowerCase())}: ${off.join(", ")}</li>`:""}</ul></div>`:""}
   <div class="slots"><div class="slotsHead">Essentials <span>${have} of ${need}</span></div>${kit.req.map(s=>row(s,true)).join("")}</div>
   <div class="slots"><div class="slotsHead">Optional <span>${kit.opt.filter(s=>a[s]).length} of ${kit.opt.length}</span></div>${kit.opt.map(s=>row(s,false)).join("")}</div>
   ${riders.length?`<div class="slots"><div class="slotsHead">Mounted on packed gear <span>${riders.length}</span></div><div class="riders">${riders.map(i=>`<div class="rider"><b>${esc(i.name)}</b><span>on ${esc(itemById(i.mountedOn)?.name||"")}</span><span>${esc(wtText(i))}</span></div>`).join("")}</div></div>`:""}
   <div class="slots"><div class="slotsHead">Also bring <span>${extras.length}</span></div>
     <div class="extras" style="padding-top:10px">${extras.map(i=>`<span class="x">${esc(i.name)}<button type="button" data-rmx="${esc(i.id)}" aria-label="Remove ${esc(i.name)}">×</button></span>`).join("")}
     <select id="addExtra" style="width:auto;max-width:100%"><option value="">+ Add an item to this kit…</option>${addable.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}${i.color?` (${esc(i.color)})`:""}</option>`).join("")}</select></div></div>`;
}
/* ---------- shared helpers ---------- */
var uid=()=>crypto.randomUUID?crypto.randomUUID():"g"+Date.now()+Math.random().toString(36).slice(2);
var L=c=>db[c].filter(x=>!x.deleted);
var byName=(a,b)=>(a.name||"").localeCompare(b.name||"");
function itemById(id){return id?live().find(i=>i.id===id):undefined}
function fmtDate(d){return d?new Date(d+"T12:00:00").toLocaleDateString():"—"}
function daysBetween(a,b){return Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/864e5)}
function addDays(d,n){const x=new Date(d+"T12:00:00");x.setDate(x.getDate()+n);return localISODate(x)}
function fmtWt(oz){oz=+oz||0;return oz>=16?`${(oz/16).toFixed(1)} lb`:`${oz%1?oz.toFixed(1):oz} oz`}
var lookupsOn=()=>!!(window.LOOKUP_URL||(kits._settings&&kits._settings.lookups));
var lookingUp=new Set();
function wtText(i){return i.weight!=null&&i.weight!==""?fmtWt(i.weight):!lookupsOn()?"":i.weightStatus==="notfound"?"weight not found":"weight pending"}
function kitWeight(ids){let oz=0,n=0;const uniq=[...new Set(ids)];uniq.forEach(id=>{const i=itemById(id);if(i&&i.weight!=null&&i.weight!==""){oz+=(+i.weight)*(+i.qty||1);n++}});return {oz,n,total:uniq.length}}
function onLoan(id){return L("loans").find(x=>x.itemId===id&&!x.returned)}
function firearms(){return live().filter(i=>i.category==="Firearms").sort(byName)}
function roundsFired(gunId){const it=itemById(gunId);return (+(it&&it.baseRounds)||0)+L("sessions").reduce((a,s)=>a+(s.lines||[]).filter(l=>l.firearmId===gunId).reduce((b,l)=>b+(+l.rounds||0),0),0)}
var MOUNT_CATS=["Firearms","Armor & Carriers","Belts","Packs & Bags","Cases & Bags","Helmet & Head","Holsters & Slings"];
function itemLabel(i,pool){
  const base=`${i.name}${i.nick?` “${i.nick}”`:""}`;
  const extra=[i.brand,i.color,i.location].filter(Boolean).join(" · ");
  let lab=extra?`${base} — ${extra}`:base;
  if(pool){const twins=pool.filter(x=>`${x.name}${x.nick?` “${x.nick}”`:""}`===base&&[x.brand,x.color,x.location].filter(Boolean).join(" · ")===extra);
    if(twins.length>1){const k=twins.slice().sort((a,b)=>(a.createdAt||a.id).localeCompare(b.createdAt||b.id)).findIndex(x=>x.id===i.id);lab+=` (#${k+1})`}}
  return lab;
}
function gunOpts(){const g=firearms();return g.length?`<option value="">— none —</option>`+g.map(x=>`<option value="${esc(x.id)}">${esc(itemLabel(x,g))}</option>`).join(""):`<option value="">Add your guns under the Firearms category first</option>`}
function mountOpts(selfId){
  const desc=new Set();
  if(selfId){desc.add(selfId);let grow=true;while(grow){grow=false;live().forEach(i=>{if(!desc.has(i.id)&&desc.has(i.mountedOn)){desc.add(i.id);grow=true}})}}
  const pool=live().filter(i=>MOUNT_CATS.includes(GearLogic.migrateCategoryName(i.category))&&!desc.has(i.id)).sort(byName);
  return `<option value="">— not mounted —</option>`+pool.map(i=>`<option value="${esc(i.id)}">${esc(itemLabel(i,pool))}</option>`).join("");
}
function ridersOf(set){const out=[];live().forEach(i=>{if(set.has(i.id))return;let p=i.mountedOn,d=0;while(p&&d<8){if(set.has(p)){out.push(i);return}p=itemById(p)?.mountedOn;d++}});return out}
function fireFields(){const on=$("fCat").value==="Firearms";document.querySelectorAll(".f.fire").forEach(e=>e.hidden=!on);document.querySelectorAll(".f.nogun").forEach(e=>e.hidden=on)}
$("fCat").addEventListener("change",fireFields);
function parseSplits(t){return String(t||"").split(/[\s,;]+/).map(parseFloat).filter(n=>isFinite(n)&&n>0)}
var optList=(arr,val)=>arr.map(([v,l])=>`<option value="${esc(v)}"${String(v)===String(val??"")?" selected":""}>${esc(l)}</option>`).join("");

/* ---------- generic editor ---------- */
var ED={};
var COLOF={range:"sessions",dope:"dope",ammo:"ammo",comms:"freqs",maint:"maint",wish:"wish",loans:"loans"};
var VIEWS=Object.keys(COLOF);
function openEd(view,rec){ED[view]={draft:JSON.parse(JSON.stringify(rec||{})),isNew:!rec||!rec.id,armed:false};renderExtra();const sh=document.querySelector(`#${view}View .sheet`);if(sh)sh.scrollTop=0}
function setPath(o,path,v){const ks=path.split(".");let t=o;for(let k=0;k<ks.length-1;k++){const key=ks[k];if(t[key]==null)t[key]=/^\d+$/.test(ks[k+1])?[]:{};t=t[key]}t[ks[ks.length-1]]=v}
function collect(view){const ed=ED[view];if(!ed)return;const f=document.querySelector(`#${view}View form[data-ed]`);if(!f)return;f.querySelectorAll("[name]").forEach(el=>{let v=el.type==="checkbox"?el.checked:el.value;if(el.type==="number")v=el.value===""?"":+el.value;setPath(ed.draft,el.name,v)})}
function fld(name,label,val,o={}){
  const t=o.type||"text";const cls=`f${o.span?" span"+o.span:""}`;let inp;
  if(t==="select")inp=`<select name="${name}" aria-label="${esc(label)}">${optList(o.opts,val)}</select>`;
  else inp=`<input name="${name}" aria-label="${esc(label)}" type="${t}" value="${esc(val??"")}"${o.ph?` placeholder="${esc(o.ph)}"`:""}${o.step?` step="${o.step}"`:""}${o.list?` list="${o.list}"`:""}${t==="number"&&!o.neg?' min="0"':""}${o.req?" required":""}>`;
  return `<div class="${cls}"><label>${esc(label)}</label>${inp}</div>`;
}
function cell(name,label,val,o={}){
  const t=o.type||"text";let inp;
  if(t==="select")inp=`<select name="${name}" aria-label="${esc(label)}">${optList(o.opts,val)}</select>`;
  else inp=`<input name="${name}" aria-label="${esc(label)}" type="${t}" value="${esc(val??"")}"${o.ph?` placeholder="${esc(o.ph)}"`:""}${o.step?` step="${o.step}"`:""}${o.list?` list="${o.list}"`:""}${t==="number"&&!o.neg?' min="0"':""}>`;
  return `<div><label>${esc(label)}</label>${inp}</div>`;
}
var rmBtn=(k,i)=>`<button type="button" class="rm" data-act="rmline" data-k="${k}" data-i="${i}" aria-label="Remove line">×</button>`;
function edForm(view,title,body){
  const ed=ED[view];
  return `<div class="sheetWrap edSheet"><div class="sheetBg" data-act="cancel"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheetTop"><span class="grab"></span><button class="xBtn" type="button" data-act="cancel" aria-label="Close">✕</button></div><form class="panel" data-ed="${view}"><h2>${esc(title)}</h2>${body}<div class="actions">${!ed.isNew?`<button class="btn ${ed.armed?"danger":"ghost"}" type="button" data-act="del">${ed.armed?"Confirm delete":"Delete"}</button>`:""}<span class="spacer"></span><button class="btn ghost" type="button" data-act="cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form></div></div>`;
}
async function upsertC(c,rec){rec={...rec,updatedAt:now()};if(!rec.id){rec.id=uid();rec.createdAt=rec.updatedAt}const i=db[c].findIndex(x=>x.id===rec.id);if(i>=0)db[c][i]=rec;else db[c].push(rec);await persist();return rec}
async function removeC(c,id){db[c]=db[c].map(x=>x.id===id?{id,deleted:true,updatedAt:now()}:x);await persist()}
var SAVE={},DEL={},NEWREC={},ACT={},RENDER={};
VIEWS.forEach(v=>{
  const el=$(v+"View");
  el.addEventListener("submit",async e=>{e.preventDefault();if(e.target&&(e.target.id==="pgForm"||e.target.id==="paceForm"))return;if(!ED[v])return;collect(v);await SAVE[v](ED[v].draft)});
  el.addEventListener("click",async e=>{
    const b=e.target.closest("[data-act]");if(!b||!el.contains(b))return;const act=b.dataset.act;const ed=ED[v];
    if(act==="cancel"){ED[v]=null;renderExtra();return}
    if(act==="del"){if(!ed.armed){collect(v);ed.armed=true;renderExtra();return}await DEL[v](ed.draft);ED[v]=null;render();toast("Deleted");return}
    if(act==="new"){openEd(v,NEWREC[v]?NEWREC[v]():{});return}
    if(act==="edit"){const r=L(COLOF[v]).find(x=>x.id===b.dataset.id);if(r)openEd(v,r);return}
    if(act==="addline"){collect(v);const k=b.dataset.k;(ed.draft[k]=ed.draft[k]||[]).push({});renderExtra();return}
    if(act==="rmline"){collect(v);ed.draft[b.dataset.k].splice(+b.dataset.i,1);renderExtra();return}
    if(ACT[v])await ACT[v](act,b,e);
  });
  el.addEventListener("change",e=>{if(ACT[v])ACT[v]("change",e.target,e)});
});
function renderExtra(){if(!COLOF[curTab])return;collect(curTab);const v=$(curTab+"View");const sh=v.querySelector(".sheet");const st=sh?sh.scrollTop:0;RENDER[curTab]();const sh2=v.querySelector(".sheet");if(sh2&&st)sh2.scrollTop=st;syncLock()}

