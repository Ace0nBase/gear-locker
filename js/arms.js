/* ---------- Arms Room: serial records ---------- */
var ARM={
  FA:{label:"Firearms",one:"Firearm",cat:"Firearms",type:"Type / action"},
  SU:{label:"Suppressors",one:"Suppressor",cat:"Suppressors",type:"Caliber rating"},
  OP:{label:"Optics & sights",one:"Optic",cat:"NVG & Optics",type:"Type / power"},
  WL:{label:"Weapon lights",one:"Weapon light",cat:"Lights & Lasers",type:"Output"},
  LA:{label:"Lasers, NVG & thermal",one:"Laser / NVG / thermal",cat:"Lights & Lasers",type:"Type (vis / IR)"},
  KN:{label:"Knives",one:"Knife",cat:"Knives & Tools",type:"Fixed / folder / auto"},
};
var ARM_KEYS=Object.keys(ARM);
var showSer=false,armImport=null;
var TOOLISH=/multi.?tool|leatherman|gerber|\bsaw\b|shovel|plier|wrench|screwdriver|sharpener|machete|e-?tool/i;
var autoArm=i=>i.category==="Firearms"?"FA":i.category==="Suppressors"?"SU":(i.category==="Knives & Tools"&&!TOOLISH.test([i.name,i.brand].join(" ")))?"KN":"";
var armOf=i=>i.arm==="no"?"":i.arm&&ARM[i.arm]?i.arm:autoArm(i);
var maskSer=s=>!s?"":showSer?s:(s.length>4?"•••• "+s.slice(-4):"••••");
var nrm=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
function nextArmId(sec,taken){
  const used=new Set([...live().map(i=>i.armId),...(taken||[])].filter(Boolean));
  let n=1;while(used.has(`${sec}-${String(n).padStart(3,"0")}`))n++;
  return `${sec}-${String(n).padStart(3,"0")}`;
}
function armRows(sec){return live().filter(i=>armOf(i)===sec).sort((a,b)=>(a.armId||"~").localeCompare(b.armId||"~")||byName(a,b))}
function fmtD(d){return d?fmtDate(d):""}

function renderArms(){
  const v=$("armsView");if(!v)return;
  const secs=ARM_KEYS.map(k=>({k,rows:armRows(k)}));
  const n=secs.reduce((a,s)=>a+s.rows.length,0),val=secs.reduce((a,s)=>a+s.rows.reduce((b,i)=>b+GearLogic.countedValue(i)*(+i.qty||1),0),0);
  const noSer=secs.reduce((a,s)=>a+s.rows.filter(i=>!i.serial&&s.k!=="KN").length,0);
  v.innerHTML=`<div class="vhead"><div><h2>Arms Room</h2><p>Serial numbers and records for your guns, suppressors, optics, lights, lasers and knives, for insurance and theft reports. Only you can see this when signed in.</p></div>
    <div class="vbtns"><button class="btn ghost" type="button" data-arm="ser">${showSer?"Hide serials":"Show serials"}</button><button class="btn ghost" type="button" data-arm="import">Import record</button><button class="btn ghost" type="button" data-arm="print">Print record</button><button class="btn" type="button" data-arm="new" id="armAdd">+ Add</button></div></div>
  <section class="stats armsStats"><div class="stat"><b>${noSer}</b><span>Missing serial</span></div><div class="stat"><b>${n}</b><span>On record</span></div><div class="stat"><b>${money(val)}</b><span>Value</span></div><div class="stat"><b>${(()=>{const pd=secs.reduce((a,s)=>a+s.rows.reduce((b,i)=>b+(+i.paid||0)*(+i.qty||1),0),0);return pd?money(pd):"—"})()}</b><span>What I paid</span></div></section>
  ${n?secs.filter(s=>s.rows.length).map(s=>{const sv=s.rows.reduce((b,i)=>b+GearLogic.countedValue(i)*(+i.qty||1),0);
    return `<section class="group"><div class="ghead"><h3>${esc(ARM[s.k].label)}</h3><span>${s.rows.length}${sv?` · ${money(sv)}`:""}</span></div>
    ${s.rows.map(i=>{const on=itemById(i.mountedOn);const sub=[i.brand,i.armType,i.caliber,on?"on "+on.name:i.setupOn].filter(Boolean).join(" · ");
      return `<button type="button" class="row armRow" data-id="${esc(i.id)}"><span class="qty armId">${esc(i.armId||"—")}</span>
      <span class="nm">${esc(i.name)}${i.nick?` <span class="tag">${esc(i.nick)}</span>`:""}<small>${esc(sub)}</small></span>
      <span class="ser">${s.k==="KN"?esc(i.markings||""):i.serial?`<span class="mono">${esc(maskSer(i.serial))}</span>`:`<span class="tag">no serial</span>`}</span>
      <span class="val">${GearLogic.countedValue(i)?money(GearLogic.countedValue(i)*(+i.qty||1)):"—"}</span></button>`}).join("")}</section>`}).join("")
  :`<div class="empty"><b>Nothing on record yet</b>Tap <em>Import record</em> to bring in your serial number Word file, or add guns and gear with a serial.</div>`}
  ${armImport?importSheet():""}`;
  syncLock();
}
function importSheet(){
  const p=armImport;const by=k=>p.rows.filter(r=>r.d.arm===k);
  return `<div class="sheetWrap edSheet"><div class="sheetBg" data-arm="icancel"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Import record"><div class="sheetTop"><span class="grab"></span><button class="xBtn" type="button" data-arm="icancel" aria-label="Close">✕</button></div>
  <div class="panel imp"><h2>Import ${esc(p.file)}</h2>
  <p class="hint">Found ${p.rows.length} items. ${p.rows.filter(r=>r.match).length} match gear you already have and get the serial and record details added. ${p.rows.filter(r=>!r.match).length} are new.</p>
  <table class="tbl"><thead><tr><th>Section</th><th class="n">New</th><th class="n">Update</th></tr></thead><tbody>${ARM_KEYS.filter(k=>by(k).length).map(k=>`<tr><td>${esc(ARM[k].label)}</td><td class="n">${by(k).filter(r=>!r.match).length}</td><td class="n">${by(k).filter(r=>r.match).length}</td></tr>`).join("")}</tbody></table>
  ${(()=>{const u=p.rows.filter(r=>r.match&&nrm(r.match.name)!==nrm(r.d.name));return u.length?`<p class="hint">Matched to gear you entered: ${u.slice(0,8).map(r=>`${esc(r.d.brand)} ${esc(r.d.name)} → your “${esc(r.match.name)}”`).join("; ")}${u.length>8?` and ${u.length-8} more`:""}</p>`:""})()}
  <p class="hint">Mounted-on links matched to your guns: ${p.links}. Values from the record are kept as entered. Nothing is sent anywhere except your own account.</p>
  <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-arm="icancel">Cancel</button><button class="btn" type="button" data-arm="igo">Import ${p.rows.length}</button></div></div></div></div>`;
}

/* read a .docx in the browser (zip + XML, no libraries) */
async function docxXml(buf){
  const dv=new DataView(buf);let e=buf.byteLength-22;
  while(e>=0&&dv.getUint32(e,true)!==0x06054b50)e--;
  if(e<0)throw new Error("That isn't a Word (.docx) file");
  const cnt=dv.getUint16(e+10,true);let p=dv.getUint32(e+16,true);
  for(let k=0;k<cnt;k++){
    const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),xl=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),off=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(new Uint8Array(buf,p+46,nl));
    if(name==="word/document.xml"){
      const ln=dv.getUint16(off+26,true),lx=dv.getUint16(off+28,true);
      const data=new Uint8Array(buf,off+30+ln+lx,csize);
      if(method===0)return new TextDecoder().decode(data);
      if(typeof DecompressionStream==="undefined")throw new Error("Update your browser to import Word files");
      const out=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return new TextDecoder().decode(out);
    }
    p+=46+nl+xl+cl;
  }
  throw new Error("That Word file has no document text");
}
function docxTables(xml){
  const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  const kids=(el,n)=>[...el.childNodes].filter(c=>c.localName===n);
  return [...doc.getElementsByTagNameNS(W,"tbl")].map(t=>kids(t,"tr").map(tr=>{
    const out=[];kids(tr,"tc").forEach(tc=>{
      const txt=[...tc.getElementsByTagNameNS(W,"p")].map(p=>[...p.getElementsByTagNameNS(W,"t")].map(x=>x.textContent).join("")).filter(Boolean).join(" ").trim();
      const gs=tc.getElementsByTagNameNS(W,"gridSpan")[0];const span=gs?parseInt(gs.getAttributeNS(W,"val")||gs.getAttribute("w:val"))||1:1;
      out.push(txt);for(let s=1;s<span;s++)out.push("");
    });return out;
  }));
}
var MON={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12};
function recDate(s){const m=String(s||"").toUpperCase().replace(/\s/g,"").match(/^(\d{1,2})([A-Z]{3,4})(\d{4})$/);if(m&&MON[m[2]])return `${m[3]}-${String(MON[m[2]]).padStart(2,"0")}-${m[1].padStart(2,"0")}`;const d=new Date(s);return s&&!isNaN(d)&&/\d{4}/.test(s)?d.toISOString().slice(0,10):""}
var unk=s=>/^(UK|UNK|UNKNOWN|N\/?A|NONE|-+)$/i.test(String(s||"").trim())?"":String(s||"").trim();
function recMoney(s){const v=parseFloat(String(s||"").replace(/[$,\s]/g,""));return isFinite(v)&&v>0?Math.round(v*100)/100:0}
function parseRecord(tables){
  const out=[];
  tables.forEach(t=>{
    const hi=t.findIndex(r=>/^item\s*id$/i.test((r[0]||"").trim()));if(hi<0)return;
    const H=t[hi].map(h=>h.toLowerCase());
    const col=re=>H.findIndex(h=>re.test(h));
    const C={mfr:col(/manufacturer/),model:col(/^model/),type:col(/^type|output|caliber rating/),cal:col(/caliber \/ gauge|^caliber$/),calr:col(/caliber rating/),serial:col(/serial/),bbl:col(/bbl|barrel/),acq:col(/date acquired/),from:col(/acquired from/),
      value:col(/^value/),photo:col(/photo/),notes:col(/notes/),form:col(/form type/),stamp:col(/stamp/),reg:col(/registrant/),dealer:col(/transferring dealer|dealer/),adapter:col(/adapter/),mount:col(/^mount$/),on:col(/mounted on/),
      batt:col(/battery/),cls:col(/class/),blade:col(/blade len/),steel:col(/steel/),handle:col(/handle/),marks:col(/markings/)};
    t.slice(hi+1).forEach(r=>{
      const id=(r[0]||"").trim().toUpperCase();const m=id.match(/^([A-Z]{2})-\d+$/);if(!m||!ARM[m[1]])return;
      const g=k=>C[k]>=0?(r[C[k]]||"").trim():"";
      const mfr=unk(g("mfr")),model=unk(g("model"));if(!mfr&&!model&&!unk(g("type"))&&!unk(g("serial"))&&!unk(g("blade")))return;
      const sec=m[1],notes=g("notes");
      const d={arm:sec,armId:id,brand:mfr,name:model||(unk(g("type"))?unk(g("type")).charAt(0)+unk(g("type")).slice(1).toLowerCase()+" "+ARM[sec].one.toLowerCase():ARM[sec].one),serial:unk(g("serial")),armType:unk(g("type")),acquired:recDate(g("acq")),acquiredFrom:unk(g("from"))||unk(g("dealer")),
        value:recMoney(g("value")),notes:notes,qty:1,condition:"Good"};
      if(sec==="FA"){d.caliber=unk(g("cal"));d.bbl=unk(g("bbl"))}
      if(sec==="SU"){d.caliber=unk(g("calr"))||unk(g("cal"));d.armType="";d.nfaForm=unk(g("form"));d.stampDate=recDate(g("stamp"));d.registrant=unk(g("reg"));d.adapter=unk(g("adapter"));d.acquired=d.acquired||d.stampDate}
      if(sec==="OP"){d.armMount=unk(g("mount"));d._on=unk(g("on"))}
      if(sec==="WL"){d.battery=unk(g("batt"));d._on=unk(g("on"))}
      if(sec==="LA"){d._on=unk(g("on"));d.laserClass=unk(g("cls"));if(/thermal|night vision|nvg/i.test(notes))d.cat="NVG & Optics"}
      if(sec==="KN"){d.bladeLen=unk(g("blade"));d.steel=unk(g("steel"));d.handle=unk(g("handle"));d.markings=unk(g("marks"));d.serial=""}
      if(g("photo"))d.photoRef=g("photo");
      d.category=d.cat||ARM[sec].cat;delete d.cat;
      out.push(d);
    });
  });
  return out;
}
function findMatch(d,used){
  const pool=live().filter(i=>!used.has(i.id));
  if(d.serial){const s=nrm(d.serial);const hit=pool.find(i=>i.serial&&nrm(i.serial)===s);if(hit)return hit}
  const byId=pool.find(i=>i.armId===d.armId&&(nrm(i.name)===nrm(d.name)||(i.serial&&nrm(i.serial)===nrm(d.serial))));if(byId)return byId;
  const b3=nrm(d.brand).slice(0,3),strip=(x,bs)=>bs.filter(Boolean).reduce((a,bb)=>a.split(bb).join(""),x),mdl=strip(nrm(d.name),[nrm(d.brand)]);
  const c=pool.filter(i=>!i.serial&&(armOf(i)===d.arm||i.category===d.category)&&(()=>{
    const full=nrm((i.brand||"")+" "+i.name),df=nrm(d.brand+" "+d.name);
    if(full===df)return true;
    if(full.length>=5&&(df.includes(full)||full.includes(df)))return true;
    if(b3&&!full.includes(b3))return false;
    const core=strip(nrm(i.name),[nrm(i.brand),nrm(d.brand)]);
    if(!core||!mdl)return false;
    return core.length>=3?(mdl.includes(core)||core.includes(mdl)):mdl.startsWith(core);
  })());
  return c.length===1?c[0]:null;
}
function resolveGun(txt,guns){
  const t=nrm(txt);if(!t)return null;
  const sub=(a,b)=>{let j=0;for(const ch of b){if(ch===a[j])j++;if(j===a.length)return true}return false};
  const hits=guns.filter(gn=>{const f=nrm((gn.brand||"")+gn.name);return f.includes(t)||sub(t,f)||nrm(gn.name)===t});
  if(hits.length<=1)return hits[0]||null;
  const dg=t.replace(/\D/g,"");const best=hits.filter(gn=>dg&&nrm(gn.name).replace(/\D/g,"").startsWith(dg));
  return best.length===1?best[0]:null;
}
function planImport(rows,file){
  const used=new Set();
  rows.forEach(r=>{r.match=findMatch(r.d,used);if(r.match)used.add(r.match.id)});
  const guns=[...firearms(),...rows.filter(r=>r.d.arm==="FA"&&!r.match).map(r=>({id:"new:"+r.d.armId,brand:r.d.brand,name:r.d.name}))];
  const gunsAll=guns.map(gn=>{const r=rows.find(x=>x.match&&x.match.id===gn.id);return r?{...gn,brand:gn.brand||r.d.brand,name:gn.name+" "+r.d.name}:gn});
  let links=0;rows.forEach(r=>{if(r.d._on){const gn=resolveGun(r.d._on,gunsAll);if(gn){r.gun=gn.id;links++}}});
  return {file,rows,links};
}
async function doImport(){
  const p=armImport;if(!p)return;const t=now();const idMap={};
  p.rows.forEach(r=>{
    const d={...r.d};const on=d._on;delete d._on;
    const keep={};Object.keys(d).forEach(k=>{if(d[k]!==""&&d[k]!=null)keep[k]=d[k]});
    if(r.match){
      const it=all.find(i=>i.id===r.match.id);if(!it)return;
      const val=keep.value;delete keep.value;delete keep.name;delete keep.brand;delete keep.qty;delete keep.condition;delete keep.category;
      if(keep.notes&&it.notes&&!it.notes.includes(keep.notes))keep.notes=it.notes+" · "+keep.notes;
      Object.assign(it,keep);if(val&&!+it.value){it.value=val;it.valueSource="manual";it.priceSource="manual"}if(val&&!+it.paid)it.paid=val;
      if(!it.caliber&&d.caliber)it.caliber=d.caliber;it.updatedAt=t;idMap["new:"+d.armId]=it.id;r.id=it.id;
    }else{
      const id=(crypto.randomUUID?crypto.randomUUID():"g"+Date.now()+Math.random().toString(36).slice(2));
      const rec={id,createdAt:t,updatedAt:t,...keep,weightStatus:"pending"};
      if(keep.value){rec.valueSource="manual";rec.priceSource="manual";rec.paid=keep.value}
      if(on&&!r.gun)rec.setupOn=on;
      all.push(rec);idMap["new:"+d.armId]=id;r.id=id;
    }
  });
  p.rows.forEach(r=>{if(!r.gun||!r.id)return;const it=all.find(i=>i.id===r.id);const gid=idMap[r.gun]||r.gun;if(it&&gid&&gid!==it.id){it.mountedOn=gid;it.updatedAt=t}});
  const n=p.rows.length;armImport=null;render();renderArms();await persist();toast(`Imported ${n} items into the Arms Room`,4000);
}
$("armsView").addEventListener("click",async e=>{
  const row=e.target.closest(".armRow[data-id]");if(row){openDetail(all.find(i=>i.id===row.dataset.id));return}
  const b=e.target.closest("[data-arm]");if(!b)return;const a=b.dataset.arm;
  if(a==="ser"){showSer=!showSer;renderArms();return}
  if(a==="new"){openArmForm();return}
  if(a==="import"){$("armFile").click();return}
  if(a==="print"){if(!ARM_KEYS.some(k=>armRows(k).length)){toast("Nothing on record yet");return}buildArmsPrint();printingKit=true;window.print();return}
  if(a==="icancel"){armImport=null;renderArms();return}
  if(a==="igo"){await doImport();return}
});
$("armFile").addEventListener("change",async e=>{
  const f=e.target.files[0];e.target.value="";if(!f)return;
  try{
    const rows=parseRecord(docxTables(await docxXml(await f.arrayBuffer())));
    if(!rows.length){toast("No serial record tables found in that file",4000);return}
    armImport=planImport(rows.map(d=>({d})),f.name);renderArms();
  }catch(err){toast(err.message||"Couldn't read that file",4000)}
});
function openArmForm(sec){openForm();const s=sec||"FA";$("fCat").value=ARM[s].cat;fireFields();$("fArm").value=s==="FA"?"":s;recFields()}

/* form: record fields */
var effArm=()=>{const v=$("fArm").value;return v==="no"?"":ARM[v]?v:autoArm({category:$("fCat").value,name:$("fName").value,brand:$("fBrand").value})};
function recFields(){
  const s=effArm();document.querySelectorAll(".f.rec").forEach(e=>e.hidden=!s);
  document.querySelectorAll("[data-recs]").forEach(e=>{e.hidden=!s||!e.dataset.recs.split(" ").includes(s)});
  if(s){$("fArmTypeL").textContent=ARM[s].type;$("fArmId").placeholder=editing?.armId||"Auto ("+nextArmId(s)+")"}
  if(typeof syncPhotoId==="function")syncPhotoId();
}
function photoDraft(){const mountedOn=$("fMount")?.value||"";const host=mountedOn?itemById(mountedOn):null;return GearLogic.armorySubject({name:$("fName").value,brand:$("fBrand").value,category:$("fCat").value,arm:$("fArm").value,mountedOn},host)}
function syncPhotoId(){const blocked=GearLogic.photoIdBlocked(!!kits._settings?.privateArms,photoDraft());$("idBtn").hidden=blocked;if(blocked)$("idOut").hidden=true}
$("fArm").addEventListener("change",recFields);
$("fCat").addEventListener("change",recFields);$("fName").addEventListener("change",recFields);
var lastArmCat="";
function armFollowsCategory(){
  if($("fArm").dataset.touched){lastArmCat=$("fCat").value;return}
  const current=$("fArm").value==="no"?"":$("fArm").value;
  const autoLast=lastArmCat==="Firearms"?"FA":lastArmCat==="Suppressors"?"SU":"";
  if(current!==autoLast){lastArmCat=$("fCat").value;return}
  const next=autoArm({category:$("fCat").value,name:$("fName").value,brand:$("fBrand").value})||"no";
  if($("fArm").value!==next){$("fArm").value=next;recFields()}
  lastArmCat=$("fCat").value;
  if(typeof syncSaleFields==="function")syncSaleFields();
}
$("fCat").addEventListener("change",armFollowsCategory);
$("fMount")?.addEventListener("change",()=>{if(typeof syncPhotoId==="function")syncPhotoId()});
var REC_IDS={fArmId:"armId",fSerial:"serial",fArmType:"armType",fAcq:"acquired",fFrom:"acquiredFrom",fBbl:"bbl",fForm:"nfaForm",fStamp:"stampDate",fAdapter:"adapter",fArmMount:"armMount",fBatt:"battery",fBlade:"bladeLen",fSteel:"steel",fHandle:"handle",fMarks:"markings"};
var _openForm=openForm;
openForm=function(item){
  _openForm(item);
  $("fArm").value=item?(item.arm||""):"";
  Object.entries(REC_IDS).forEach(([el,k])=>$(el).value=item?.[k]||"");
  if(!item&&kits._settings?.privateArms){$("fCat").value="";if(typeof fireFields==="function")fireFields()}
  lastArmCat=$("fCat").value;
  recFields();if(typeof syncSaleFields==="function")syncSaleFields();
};
var _readForm=readForm;
readForm=function(){
  const d=_readForm();const s=effArm();d.arm=$("fArm").value;
  Object.entries(REC_IDS).forEach(([el,k])=>d[k]=s?$(el).value.trim():(editing?.[k]||""));
  if(s&&!d.armId)d.armId=(editing&&editing.arm===s&&editing.armId)||nextArmId(s);
  if(s==="KN")d.serial="";
  return d;
};

/* printable record */
function buildArmsPrint(){
  const m2=n=>"$"+(+n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const on=i=>{const g=itemById(i.mountedOn);return g?(g.armId||g.name):(i.setupOn||"")};
  const COLS={
    FA:[["Item ID","armId"],["Manufacturer","brand"],["Model","name"],["Type / Action","armType"],["Caliber","caliber"],["Serial Number","serial"],["Bbl. Len.","bbl"],["Date Acquired",i=>fmtD(i.acquired)],["Acquired From","acquiredFrom"],["Value",i=>{const n=GearLogic.countedValue(i);return n?m2(n):""}],["Notes / Status","notes"]],
    SU:[["Item ID","armId"],["Manufacturer","brand"],["Model","name"],["Caliber","caliber"],["Serial Number","serial"],["Form","nfaForm"],["Stamp / Approval",i=>fmtD(i.stampDate)],["Dealer","acquiredFrom"],["Mount / Adapter","adapter"],["Value",i=>{const n=GearLogic.countedValue(i);return n?m2(n):""}],["Notes / Status","notes"]],
    OP:[["Item ID","armId"],["Manufacturer","brand"],["Model","name"],["Type","armType"],["Serial Number","serial"],["Mount","armMount"],["Mounted On",on],["Date Acquired",i=>fmtD(i.acquired)],["Value",i=>{const n=GearLogic.countedValue(i);return n?m2(n):""}],["Notes / Status","notes"]],
    WL:[["Item ID","armId"],["Manufacturer","brand"],["Model","name"],["Output","armType"],["Serial Number","serial"],["Battery","battery"],["Mounted On",on],["Date Acquired",i=>fmtD(i.acquired)],["Value",i=>{const n=GearLogic.countedValue(i);return n?m2(n):""}],["Notes / Status","notes"]],
    LA:[["Item ID","armId"],["Manufacturer","brand"],["Model","name"],["Type","armType"],["Serial Number","serial"],["Mounted On",on],["Date Acquired",i=>fmtD(i.acquired)],["Value",i=>{const n=GearLogic.countedValue(i);return n?m2(n):""}],["Notes / Status","notes"]],
    KN:[["Item ID","armId"],["Manufacturer","brand"],["Model","name"],["Type","armType"],["Blade Len.","bladeLen"],["Steel","steel"],["Handle","handle"],["Markings","markings"],["Date Acquired",i=>fmtD(i.acquired)],["Value",i=>{const n=GearLogic.countedValue(i);return n?m2(n):""}],["Notes / Status","notes"]],
  };
  const sum=[];
  let h=`<div class="ph"><div><h1>PERSONAL PROPERTY RECORD</h1><small>Firearms, NFA items, accessories &amp; edged weapons · ${esc(cloudUser?.email||"")} · Printed ${new Date().toLocaleDateString()}</small></div><small>PRIVATE — CONTAINS SERIAL NUMBERS</small></div>`;
  ARM_KEYS.forEach(k=>{const rows=armRows(k);if(!rows.length)return;const tot=rows.reduce((a,i)=>a+GearLogic.countedValue(i)*(+i.qty||1),0);sum.push([ARM[k].label,rows.length,tot]);
    const cols=COLS[k];
    h+=`<table><thead><tr class="cat"><th colspan="${cols.length}">${esc(ARM[k].label.toUpperCase())} — ${rows.length} · ${m2(tot)}</th></tr><tr>${cols.map(c=>`<th>${esc(c[0])}</th>`).join("")}</tr></thead><tbody>`+
      rows.map(i=>`<tr>${cols.map(c=>`<td${c[0]==="Value"?' class="r"':""}>${esc(typeof c[1]==="function"?c[1](i):(i[c[1]]||""))}</td>`).join("")}</tr>`).join("")+`</tbody></table>`});
  const gt=sum.reduce((a,s)=>a+s[2],0),gn=sum.reduce((a,s)=>a+s[1],0);
  h+=`<table style="max-width:5.5in"><thead><tr class="cat"><th colspan="3">SUMMARY</th></tr><tr><th>Category</th><th class="r">Items</th><th class="r">Total value</th></tr></thead><tbody>${sum.map(s=>`<tr><td>${esc(s[0])}</td><td class="r">${s[1]}</td><td class="r">${m2(s[2])}</td></tr>`).join("")}<tr><th>GRAND TOTAL</th><th class="r">${gn}</th><th class="r">${m2(gt)}</th></tr></tbody></table>`;
  h+=`<p class="sign">Owner signature: ______________________________ &nbsp;&nbsp; Date: ______________ &nbsp;&nbsp; Witness: ______________________________</p>`;
  $("printSheet").innerHTML=h;
}

function armDetail(i){
  const s=armOf(i);if(!s)return "";
  const L=[["Record ID",esc(i.armId||"")],
    ["Serial number",s==="KN"?"":i.serial?`<span class="mono">${esc(maskSer(i.serial))}</span> <button class="lnk" type="button" data-dact="ser">${showSer?"Hide":"Show"}</button>`:"Not recorded"],
    [ARM[s].type,esc(i.armType||"")],["Acquired",esc(fmtD(i.acquired))],["Acquired from",esc(i.acquiredFrom||"")],["Barrel length",esc(i.bbl||"")],
    ["Form",esc(i.nfaForm||"")],["Stamp / approval",esc(fmtD(i.stampDate))],["Mount / adapter",esc(i.adapter||i.armMount||"")],["Battery",esc(i.battery||"")],
    ["Blade length",esc(i.bladeLen||"")],["Steel",esc(i.steel||"")],["Handle",esc(i.handle||"")],["Markings",esc(i.markings||"")]].filter(r=>r[1]);
  return `<div class="sect"><h3>Serial record · ${esc(ARM[s].one)}</h3><dl>${L.map(r=>`<div><dt>${esc(r[0])}</dt><dd>${r[1]}</dd></div>`).join("")}</dl></div>`;
}

/* ---------- v10: paid, swap prompt, photo ID, sharing ---------- */
var m2=n=>"$"+(+n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2});

/* what I paid: form + detail + stats */
var _openForm10=openForm;
openForm=function(item){_openForm10(item);$("fPaid").value=item?.paid||"";$("idOut").hidden=true};
var _readForm10=readForm;
readForm=function(){const d=_readForm10();const v=parseFloat($("fPaid").value);d.paid=isFinite(v)&&v>0?Math.round(v*100)/100:"";return d};

/* swap prompt: new gear mounted where similar gear already sits */
var GENERIC=new Set(["pouch","pouches","double","single","triple","mag","mags","magazine","molle","small","medium","large","black","coyote","ranger","green","multicam","tan","grey","gray","the","and","with","for","gen","new","old","kit","holder","case","bag","rig"]);
function slotsOf(i){const t=itemText(i);return Object.keys(S).filter(sid=>{const[,,kws,,ex]=S[sid];return kws.some(k=>hasKw(t,k))&&!ex.some(k=>t.includes(k))})}
function wordsOf(i){const br=new Set(String(i.brand||"").toLowerCase().split(/\W+/));return new Set(String(i.name||"").toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!GENERIC.has(w)&&!br.has(w)))}
function similarGear(a,b){
  if(a.category!==b.category)return false;
  const sa=slotsOf(a),sb=new Set(slotsOf(b));if(sa.some(s=>sb.has(s)))return true;
  const wb=wordsOf(b);return [...wordsOf(a)].some(w=>wb.has(w));
}
var swap=null;
function maybeSwap(rec,before){
  if(!rec.mountedOn||(before&&before.mountedOn===rec.mountedOn))return;
  const host=itemById(rec.mountedOn);if(!host)return;
  const old=live().filter(i=>i.id!==rec.id&&i.mountedOn===rec.mountedOn&&similarGear(i,rec));
  if(!old.length)return;
  swap={rec:rec.id,host:host.id,old:old.map(i=>i.id),keep:new Set()};renderSwap();
}
function renderSwap(){
  const el=$("swapSheet");if(!swap){el.hidden=true;syncLock();return}
  const host=itemById(swap.host),rec=itemById(swap.rec);
  el.querySelector(".panel").innerHTML=`<h2>Swap it out?</h2>
   <p>You put <b>${esc(rec?.name||"")}</b> on <b>${esc(host?.name||"")}</b>. It already has:</p>
   <div class="swapList">${swap.old.map(id=>{const i=itemById(id);return i?`<label class="swapItem"><input type="checkbox" data-sw="${esc(id)}" ${swap.keep.has(id)?"":"checked"}><span><b>${esc(i.name)}</b><small>${esc([i.brand,i.color,i.nick].filter(Boolean).join(" · "))}</small></span></label>`:""}).join("")}</div>
   <p class="hint">Checked items come off ${esc(host?.name||"it")} and go back to spare gear in your inventory.</p>
   <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-swap="keep">Keep both</button><button class="btn" type="button" data-swap="move">Move off</button></div>`;
  el.hidden=false;syncLock();
}
$("swapSheet").addEventListener("change",e=>{const c=e.target.closest("[data-sw]");if(!c||!swap)return;if(c.checked)swap.keep.delete(c.dataset.sw);else swap.keep.add(c.dataset.sw)});
$("swapSheet").addEventListener("click",async e=>{
  const b=e.target.closest("[data-swap]");if(!b||!swap)return;
  if(b.dataset.swap==="move"){const t=now();let n=0;swap.old.forEach(id=>{if(swap.keep.has(id))return;const i=all.find(x=>x.id===id);if(i){i.mountedOn="";i.setupOn="";i.updatedAt=t;n++}});
    const host=itemById(swap.host);swap=null;renderSwap();render();await persist();if(viewing&&!$("detail").hidden)openDetail(itemById(viewing.id),true);toast(n?`Moved ${n} off ${host?.name||""} to spare gear`:"Kept both");return}
  swap=null;renderSwap();
});
{const _sc=saveCurrent;saveCurrent=async function(extra){const before=editing?{...editing}:null;const rec=await _sc(extra);if(rec&&!extra)setTimeout(()=>maybeSwap(rec,before),350);return rec}}

/* identify unknown gear from a photo */
function shrinkImage(file,max=1024){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>{const s=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(img.src);res(c.toDataURL("image/jpeg",0.82).split(",")[1])};img.onerror=()=>rej(new Error("Couldn't open that photo"));img.src=URL.createObjectURL(file)})}
$("idBtn").onclick=()=>{const draft=photoDraft();if(GearLogic.photoIdBlocked(!!kits._settings?.privateArms,draft)){toast(String(draft.category||"").trim()? "Photo ID stays off for Arms Room items.":"Choose a category before photo ID.");return}if(!window.LOOKUP_URL||!cloudUser){toast("Sign in to use photo ID");return}$("idFile").click()};
$("idFile").addEventListener("change",async e=>{
  const f=e.target.files[0];e.target.value="";if(!f)return;
  const draft=photoDraft();
  if(GearLogic.photoIdBlocked(!!kits._settings?.privateArms,draft)){toast(String(draft.category||"").trim()?"Photo ID stays off for Arms Room items.":"Choose a category before photo ID.");return}
  const out=$("idOut");out.hidden=false;out.innerHTML=`<span class="tag">Looking at your photo…</span>`;$("idBtn").disabled=true;
  try{
    const img=await shrinkImage(f);const tok=await firebase.auth().currentUser.getIdToken();
    const r=await fetch(window.LOOKUP_URL.replace(/\/$/,"")+"/identify",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+tok},body:JSON.stringify({image:img,hint:$("fName").value.trim()})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Photo ID failed");
    const g=j.result||{};
    if(g.name&&(!$("fName").value.trim()||$("fName").dataset.fromPhoto))$("fName").value=g.name,$("fName").dataset.fromPhoto="1";
    if(g.brand&&!$("fBrand").value.trim())$("fBrand").value=g.brand;
    if(g.category&&CATS.includes(g.category)&&!editing)$("fCat").value=g.category,fireFields(),$("fCat").dispatchEvent(new Event("change"));
    if(g.color&&!$("fColor").value.trim())setColor(g.color);
    $("fName").dispatchEvent(new Event("input"));
    const photoRestricted=GearLogic.saleRestricted(saleDraft());
    out.innerHTML=`<span class="tag">Photo ID · ${esc(g.confidence||"low")} confidence</span><br>${esc(g.summary||"")}${g.brand?"":photoRestricted?" Look up weight does not search stores.":" Brand unknown, so prices and weight will be estimated for a typical one."}`;
  }catch(err){out.innerHTML=`<span class="tag">Photo ID</span><br>${esc(err.message||"Didn't work")}`}
  finally{$("idBtn").disabled=false}
});

/* share a piece of gear (and everything on it) or a kit */
function treeOf(rootId){
  const out=[rootId];let grow=true;const set=new Set(out);
  const root=itemById(rootId);
  while(grow){grow=false;live().forEach(i=>{if(!set.has(i.id)&&(set.has(i.mountedOn)||(root?.category==="Firearms"&&i.forGun===rootId&&!i.mountedOn))){set.add(i.id);out.push(i.id);grow=true}})}
  return out.map(itemById).filter(Boolean);
}
var shareRow=(i,parent,prices)=>GearLogic.shareItemFields(i,parent,prices);
var shareState=null;
function openShare(kind,id){
  let title,rows;
  if(kind==="item"){const it=itemById(id);if(!it)return;title=it.name;rows=treeOf(id)}
  else{const kit=KITS.find(k=>k.id===id);const {a}=coverage(kit);const st=kits[kit.id]||{};const box=containerFor(kit);const ids=new Set([...(box?[box.id]:[]),...Object.values(a).filter(Boolean).map(i=>i.id),...(st.extras||[])]);rows=[...ids].map(itemById).filter(Boolean);ridersOf(ids).forEach(r=>rows.push(r));title=kit.name+" kit"}
  let from="";try{from=localStorage.getItem("gearLocker.shareName")||""}catch{}
  const existing=(kits._shares||{})[kind+":"+id];
  shareState={kind,id,title,rows,from,prices:false,link:existing?shareUrl(existing):"",sid:existing||""};renderShare();
}
var shareUrl=sid=>withAppQuery({s:sid});
function renderShare(){
  const el=$("shareSheet");const s=shareState;if(!s){el.hidden=true;syncLock();return}
  const wt=s.rows.reduce((a,i)=>a+(i.weight!=null&&i.weight!==""?(+i.weight)*(+i.qty||1):0),0);
  el.querySelector(".panel").innerHTML=`<h2>Share ${esc(s.title)}</h2>
   <p>Sends a read-only page with <b>${s.rows.length} item${s.rows.length>1?"s":""}</b>: names, brands, colors${wt?`, weights (${fmtWt(wt)} total)`:""}. Your friend doesn't need an account. Serial numbers, notes and where you store things are never included.</p>
   <div class="swapList">${s.rows.slice(0,12).map(i=>`<div class="swapItem"><span><b>${esc(i.name)}</b><small>${esc([i.brand,i.color].filter(Boolean).join(" · "))}</small></span></div>`).join("")}${s.rows.length>12?`<div class="hint">and ${s.rows.length-12} more</div>`:""}</div>
   <div class="f"><label for="shFrom">Your name on the page (optional)</label><input id="shFrom" value="${esc(s.from)}" placeholder="Your name"></div>
   <label class="keep"><input type="checkbox" id="shPrices" ${s.prices?"checked":""}> Include values and what I paid</label>
   ${s.link?`<div class="f"><label for="shLink">Link</label><input id="shLink" readonly value="${esc(s.link)}"></div><p class="hint">Changes you make later don't show until you tap Update link.</p>`:""}
   <div class="actions">${s.sid?`<button class="btn ghost" type="button" data-sh="stop">Stop sharing</button>`:""}<span class="spacer"></span><button class="btn ghost" type="button" data-sh="close">Close</button><button class="btn" type="button" data-sh="go">${s.sid?"Update &amp; send link":"Create &amp; send link"}</button></div>`;
  el.hidden=false;syncLock();
}
async function publishShare(){
  const s=shareState;if(!cloudUser||!fsdb){toast("Sign in to share");return}
  s.from=$("shFrom").value.trim().slice(0,40);s.prices=$("shPrices").checked;try{localStorage.setItem("gearLocker.shareName",s.from)}catch{}
  const ids=new Set(s.rows.map(i=>i.id));
  if(s.rows.length>GearLogic.MAX_SHARE_ITEMS){toast("That share is too big. Split it into a smaller kit.");return}
  const rows=s.rows.map((i,k)=>{let par=i.mountedOn&&ids.has(i.mountedOn)?i.mountedOn:"";if(!par&&k>0&&s.kind==="item"&&i.forGun&&ids.has(i.forGun))par=i.forGun;return shareRow(i,par,s.prices)});
  const sid=s.sid||(Array.from(crypto.getRandomValues(new Uint8Array(15)),b=>"abcdefghijkmnpqrstuvwxyz23456789"[b%32]).join(""));
  const doc={owner:cloudUser.uid,title:s.title,kind:s.kind,from:s.from,prices:s.prices,items:rows,updatedAt:now()};
  try{await fsdb.collection("shares").doc(sid).set(doc)}catch(e){toast("Couldn't create the link: "+(e.code==="permission-denied"?"sharing isn't switched on yet":e.message),6000);return}
  kits={...kits,_shares:{...(kits._shares||{}),[s.kind+":"+s.id]:sid}};await persist();
  s.sid=sid;s.link=shareUrl(sid);renderShare();
  try{if(navigator.share){await navigator.share({title:s.title+" · Gear Locker",text:`${s.from?s.from+"'s ":""}${s.title}`,url:s.link});return}}catch(e){if(e.name==="AbortError")return}
  try{await navigator.clipboard.writeText(s.link);toast("Link copied. Paste it in a text.")}catch{$("shLink")?.select();toast("Copy the link and send it")}
}
$("shareSheet").addEventListener("click",async e=>{
  const b=e.target.closest("[data-sh]");if(!b||!shareState)return;const a=b.dataset.sh;
  if(a==="close"){shareState=null;renderShare();return}
  if(a==="go"){b.disabled=true;await publishShare();b.disabled=false;return}
  if(a==="stop"){const s=shareState;try{await fsdb.collection("shares").doc(s.sid).delete()}catch{}const m={...(kits._shares||{})};delete m[s.kind+":"+s.id];kits={...kits,_shares:m};await persist();shareState=null;renderShare();toast("Link turned off")}
});

/* shared page (no sign-in) */
var SHARE_ID=new URLSearchParams(location.search).get("s");
async function showSharedPage(){
  document.body.classList.add("sharing");document.querySelector(".wrap:not(#sharedPage)").hidden=true;$("gate").hidden=true;const v=$("sharedPage");v.hidden=false;v.innerHTML=`<p class="hint">Loading…</p>`;
  try{
    if(!initFirebase())throw new Error("Can't open this link.");
    var shareDb=firebase.firestore();
    if(window.GEAR_QA&&firebase.app().options.projectId!=="demo-gear-locker")throw new Error("Can't open this link.");
    const snap=await shareDb.collection("shares").doc(SHARE_ID).get();
    if(!snap.exists)throw new Error("This link was turned off or doesn't exist.");
    const d=snap.data();const items=Array.isArray(d.items)?d.items:[];
    const kids=p=>items.filter(i=>(i.parent||"")===p);
    const wt=items.reduce((a,i)=>a+(i.weight!=null?(+i.weight)*(+i.qty||1):0),0),wn=items.filter(i=>i.weight!=null).length;
    const val=items.reduce((a,i)=>a+(+i.value||0)*(+i.qty||1),0),paid=items.reduce((a,i)=>a+(+i.paid||0)*(+i.qty||1),0);
    const line=(i,depth)=>`<div class="shItem" style="margin-left:${Math.min(depth,4)*18}px">${depth?`<span class="shOn">on ${esc(items.find(x=>x.id===i.parent)?.name||"")}</span>`:""}<b>${i.qty>1?i.qty+"× ":""}${esc(i.name)}${i.nick?` <span class="tag">${esc(i.nick)}</span>`:""}</b><small>${esc([i.brand,i.color,i.caliber,i.weight!=null?fmtWt(i.weight):"",d.prices&&i.value?"worth "+money(i.value):"",d.prices&&i.paid?"paid "+money(i.paid):""].filter(Boolean).join(" · "))}</small></div>`+kids(i.id).map(k=>line(k,depth+1)).join("");
    const roots=items.filter(i=>!i.parent||!items.some(x=>x.id===i.parent));
    v.innerHTML=`<header><div><div class="sub">GEAR LOCKER · SHARED${d.from?" BY "+esc(d.from.toUpperCase()):""}</div><h1>${esc(d.title||"Gear")}</h1></div></header>
     <section class="stats"><div class="stat"><b>${items.length}</b><span>Items</span></div><div class="stat"><b>${wt?fmtWt(wt):"—"}</b><span>Weight${wn<items.length&&wt?` (${wn}/${items.length})`:""}</span></div>${d.prices?`<div class="stat"><b>${money(val)}</b><span>Value</span></div><div class="stat"><b>${paid?money(paid):"—"}</b><span>Paid</span></div>`:""}</section>
     <div class="shList">${roots.map(r=>line(r,0)).join("")}</div>
     <p class="hint" style="margin-top:28px">Updated ${esc(new Date(d.updatedAt||Date.now()).toLocaleDateString())}. <a href="${esc(location.pathname)}">Make your own Gear Locker</a></p>`;
    document.title=(d.title||"Gear")+" · Gear Locker";
  }catch(e){v.innerHTML=`<div class="empty"><b>Can't open this link</b>${esc(e.code==="permission-denied"?"This link was turned off or doesn't exist.":e.message||"")}</div>`}
}

