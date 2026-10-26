/* ---------- v17: total kit weight, loaded mags ---------- */
// heavier common load per round, in ounces
var AMMO={"556":{oz:0.44,lbl:"5.56 M855 62gr",cap:30},"308":{oz:0.90,lbl:"7.62x51 M80 / 175gr",cap:20},"762x39":{oz:0.59,lbl:"7.62x39 123gr",cap:30},"300blk":{oz:0.62,lbl:".300 BLK 220gr",cap:30},"65cm":{oz:0.90,lbl:"6.5 CM 140gr",cap:20},"9":{oz:0.44,lbl:"9mm 147gr",cap:15},"45":{oz:0.76,lbl:".45 ACP 230gr",cap:8},"40":{oz:0.58,lbl:".40 S&W 180gr",cap:15},"10mm":{oz:0.63,lbl:"10mm 200gr",cap:15},"380":{oz:0.34,lbl:".380 ACP 95gr",cap:7},"22":{oz:0.12,lbl:".22 LR 40gr",cap:10},"12ga":{oz:1.4,lbl:"12 ga 00 buck",cap:6}};
function calKey(t){t=String(t||"").toLowerCase();
  if(/308|7\.62 ?x ?51|762x51|\b762 nato/.test(t))return "308";if(/7\.62 ?x ?39|\bak\b|762x39/.test(t))return "762x39";if(/300 ?(blk|blackout|aac)/.test(t))return "300blk";if(/6\.5/.test(t))return "65cm";
  if(/5\.56|556|\.223|223|stanag|\bar-?15|\bm4\b|pmag|lancer/.test(t))return "556";if(/\.45|\b45\b|1911/.test(t))return "45";if(/\.40|\b40 ?s&?w/.test(t))return "40";if(/10 ?mm/.test(t))return "10mm";if(/\.380|\b380\b/.test(t))return "380";
  if(/\.22|\b22 ?lr|\b22\b/.test(t))return "22";if(/12 ?ga|shotgun/.test(t))return "12ga";if(/9 ?mm|9x19|glock|p320|p365|\b365\b|m&p|pistol/.test(t))return "9";return ""}
var PISTOL_CAP=[[/\bg?17\b|p320|m&p ?9|\b92\b|cz ?75|p226/,17],[/\bg?19\b|p229/,15],[/43x|48\b|\bmos\b/,10],[/\b365\b|p365|hellcat/,12],[/\bg?26\b/,10],[/\bg?43\b/,6],[/1911/,8]];
function magSpec(name,brand,isPistol,gunCalTxt){
  const t=` ${name||""} ${brand||""} `.toLowerCase();
  let cal=calKey(t);if(!cal&&gunCalTxt)cal=calKey(gunCalTxt);if(!cal)cal=isPistol?"9":"556";
  const a=AMMO[cal]||AMMO["556"];
  let cap=(t.match(/\b(\d{1,3}) ?(rd|rnd|round|r)s?\b/)||t.match(/(?:pmag|mag|magazine|lancer)\s*(\d{2})\b/)||[])[1];cap=+cap||0;
  if(!cap&&isPistol){const m=PISTOL_CAP.find(([re])=>re.test(t));cap=m?m[1]:a.cap}
  if(!cap)cap=a.cap;
  // empty mag weight when we don't have one: by material
  const empty=isPistol?(/steel|metal/.test(t)?3.2:2.8):/steel/.test(t)?7.0:/lancer|l5/.test(t)?4.8:/alum|gi\b|usgi/.test(t)?4.2:/pmag|polymer|magpul/.test(t)?4.4:cal==="308"?6.5:4.6;
  return {cal,cap,roundOz:a.oz,ammoLbl:a.lbl,emptyOz:empty,loadedOz:empty+cap*a.oz};
}
function kitWeightFull(kit){
  const st=kstate(kit.id);const guns=[...(st.slots.primary||[]),...(st.slots.sidearm||[])].map(p=>itemById(p.id)).filter(Boolean);
  const gunCal=pistol=>(guns.find(g=>(gunType(g)==="pistol")===pistol)?.caliber)||"";
  let gear=0,gearN=0,mags=0,magN=0,ammo=0,gunsOz=0;const missing=[];const seen=new Set();const magLines=[];
  const add=(it,q,custom,name,sid)=>{
    const isMag=sid==="mags"||(it&&(classify(it).has("mag_rifle")||classify(it).has("mag_pistol")));
    if(isMag){const pistol=it?classify(it).has("mag_pistol"):RX.pistolword.test(String(name).toLowerCase());const sp=magSpec(it?.name||name,it?.brand,pistol,gunCal(pistol));
      const e=(it&&it.weight!=null&&it.weight!=="")?+it.weight:sp.emptyOz;const lo=(e+sp.cap*sp.roundOz)*q;mags+=e*q;ammo+=sp.cap*sp.roundOz*q;magN+=q;magLines.push(`${q}× ${it?.name||name}: ${sp.cap} rds ${sp.ammoLbl} ≈ ${fmtWt(e+sp.cap*sp.roundOz)} each`);return}
    if(custom){missing.push(name);return}
    if(it.weight==null||it.weight===""){missing.push(it.name);return}
    if(classify(it).has("gun_long")||classify(it).has("gun_pistol"))gunsOz+=(+it.weight)*q;else{gear+=(+it.weight)*q;gearN+=q}
  };
  Object.entries(st.slots).forEach(([sid,arr])=>arr.forEach(p=>{const it=p.id?itemById(p.id):null;if(p.id&&!it)return;if(it){if(seen.has(it.id+"|"+sid))return;seen.add(it.id+"|"+sid)}add(it,+p.qty||1,!it,p.name,sid)}));
  const box=containerFor(kit);if(box)add(box,1,false,"","");
  (st.extras||[]).map(itemById).filter(Boolean).forEach(i=>add(i,1,false,"",""));
  const ids=kitPacked(kit);ridersOf(ids).filter(i=>!ids.has(i.id)).forEach(i=>add(i,+i.qty||1,false,"",""));
  return {total:gear+mags+ammo+gunsOz,gear,gearN,mags,ammo,magN,gunsOz,missing:[...new Set(missing)],magLines};
}
{const _rk=renderKits;renderKits=function(){_rk();const kit=KITS.find(k=>k.id===curKit)||KITS[0];const w=kitWeightFull(kit);
  const m=$("kitDetail").querySelector(".meter");if(m){const spans=m.querySelectorAll("span");const last=spans[spans.length-1];if(last)last.innerHTML=`<b>${w.total?fmtWt(w.total):"—"}</b> total${w.missing.length?` · ${w.missing.length} not weighed`:""}`}
  const lb=x=>x?`${(x/16).toFixed(1)} lb`:"—";
  $("kitDetail").insertAdjacentHTML("beforeend",`<div class="slots wtBox"><div class="slotsHead">Total weight <span>${w.total?fmtWt(w.total):"—"}</span></div>
   <div class="wtGrid"><div><b>${lb(w.gear)}</b><span>Gear (${w.gearN} weighed)</span></div><div><b>${lb(w.mags+w.ammo)}</b><span>${w.magN} loaded mag${w.magN===1?"":"s"}${w.ammo?` · ${lb(w.ammo)} is ammo`:""}</span></div><div><b>${lb(w.gunsOz)}</b><span>Guns (unloaded)</span></div><div><b>${w.total?`${(w.total/16).toFixed(1)} lb`:"—"}</b><span>All in${w.total>=16*2.2?` · ${(w.total/35.274).toFixed(1)} kg`:""}</span></div></div>
   ${w.magLines.length?`<p class="hint">Mags counted full of the heavier common load: ${w.magLines.map(esc).join("; ")}.</p>`:""}
   ${w.missing.length?`<p class="hint">Not in the total yet (no weight): ${w.missing.slice(0,12).map(esc).join(", ")}${w.missing.length>12?` and ${w.missing.length-12} more`:""}. </p>${window.LOOKUP_URL?`<button class="btn ghost" type="button" id="kitWeigh">Look up the missing weights</button>`:""}`:""}</div>`);
}}

/* ---------- v18: battery tracker ---------- */
var NO_BATT=/\bg[34]5\b|\bg33\b|magnifier|dual ?ill|acog|tritium|fiber|\bta\d{2}|irons?\b|backup sights?/;
// starting points by device type (refined by "Look up" for your exact model)
function battGuess(i){
  const k=classify(i);const t=itemNameText(i);
  if(NO_BATT.test(t)||k.has("optic_mag"))return null;
  if(k.has("optic")){
    if(/eotech|exps|\bxps|\b55[28]\b|\bhws\b/.test(t))return {type:/55[28]/.test(t)?"AA":"CR123A",count:/55[28]/.test(t)?2:1,months:3,life:"~600–1,000 hrs at mid setting",kind:"holographic"};
    if(k.has("optic_lpvo"))return {type:"CR2032",count:1,months:12,life:"illumination only; ~100–500 hrs on",kind:"LPVO illumination"};
    if(/aimpoint|\bt-?[12]\b|\bcco\b|\bm68\b|comp ?m/.test(t))return {type:/comp ?m[45]|\bm68|\bcco/.test(t)?"AA":"CR2032",count:1,months:12,life:"years of constant-on (Aimpoint ~5 yrs)",kind:"red dot"};
    if(k.has("optic_pistol"))return {type:"CR2032",count:1,months:12,life:"~1–4 years depending on brightness",kind:"pistol dot"};
    return {type:"CR2032",count:1,months:12,life:"months to years depending on brightness",kind:"red dot"};
  }
  if(k.has("wlight"))return {type:/tlr-?7|tlr-?8|apl ?c|x400u?|\bscout\b|m6[0-4]0|x300u?/.test(t)&&!/tlr-?7/.test(t)?"CR123A":"CR123A",count:/tlr-?7|tlr-?6|apl ?c/.test(t)?1:2,months:6,life:"~1–2 hrs on high; lithium cells lose punch over time",kind:"weapon light"};
  if(k.has("laser"))return {type:"CR123A",count:/trinity|peq-?15|dbal/.test(t)?2:1,months:6,life:"~10–50 hrs depending on mode",kind:"IR laser"};
  if(k.has("nvg"))return {type:"AA",count:1,months:3,life:"~40–50 hrs per AA",kind:"night vision"};
  if(k.has("thermal"))return {type:"rechargeable",count:1,months:1,life:"~4–8 hrs per charge",kind:"thermal",charge:true};
  if(k.has("headset"))return {type:"AAA",count:2,months:6,life:"~500 hrs",kind:"electronic hearing pro"};
  if(k.has("radio"))return {type:"rechargeable",count:1,months:1,life:"~8–12 hrs per charge",kind:"radio",charge:true};
  if(k.has("headlamp"))return {type:"AAA",count:3,months:6,life:"varies by mode",kind:"headlamp"};
  if(i.category==="Lights & Lasers"||i.category==="NVG & Optics"||i.category==="Comms & Radios")return {type:"",count:1,months:6,life:"",kind:"electronics"};
  return null;
}
function battInfo(i){
  const g=battGuess(i);if(!g&&!i.battType)return null;if(i.battNone)return null;
  let type=i.battType||(i.battery&&String(i.battery))||g?.type||"";type=type.replace(/^\s*cr ?123a?\s*$/i,"CR123A").replace(/^\s*cr ?2032\s*$/i,"CR2032").replace(/^\s*(aa|aaa)\s*$/i,m=>m.trim().toUpperCase());const months=+i.battMonths||g?.months||6;
  const changed=i.battChanged||"";const next=changed?new Date(new Date(changed+"T12:00:00").getTime()+months*30.44*864e5).toISOString().slice(0,10):"";
  const daysLeft=next?Math.round((new Date(next+"T12:00:00")-new Date())/864e5):null;
  const status=!changed?"unknown":daysLeft<0?"over":daysLeft<=14?"soon":"ok";
  return {type,count:+i.battCount||g?.count||1,months,life:i.battLife||g?.life||"",kind:g?.kind||"",charge:!!(g?.charge||/recharg/i.test(type)),changed,next,daysLeft,status,looked:!!i.battLooked};
}
var battItems=()=>live().filter(i=>battInfo(i)).map(i=>({i,b:battInfo(i)}));
{const _bf=badgeFor;badgeFor=function(k){const n=_bf(k);return k==="maint"?n+battItems().filter(x=>x.b.status==="over").length:n}}
var battEdit=null;
{const _rm=RENDER.maint;RENDER.maint=()=>{_rm();const v=$("maintView");
  const rows=battItems().sort((a,b)=>({over:0,soon:1,unknown:2,ok:3}[a.b.status]-{over:0,soon:1,unknown:2,ok:3}[b.b.status])||(a.b.daysLeft??9e9)-(b.b.daysLeft??9e9));
  const spares={};rows.filter(x=>!x.b.charge&&x.b.type).forEach(x=>{spares[x.b.type]=(spares[x.b.type]||0)+x.b.count*(+x.i.qty||1)});
  const pill=b=>b.status==="over"?`<span class="pill gap">${b.charge?"Charge now":"Change now"}</span>`:b.status==="soon"?`<span class="pill warn">${b.daysLeft}d left</span>`:b.status==="unknown"?`<span class="pill">Not logged</span>`:`<span class="pill ok">OK</span>`;
  const html=`<div class="slotsHead" style="margin-top:6px">Batteries <span>${rows.length}</span></div>
   ${rows.length?`<p class="hint" style="margin:6px 0">Tap <b>Changed today</b> when you swap batteries${rows.some(x=>x.b.charge)?" or charge something":""}. Intervals start from rules of thumb; <b>Look up</b> gets the exact battery and life for your model.</p>
   <div class="battList">${rows.map(({i,b})=>`<div class="batt ${b.status}"><div class="bn"><b>${esc(i.name)}</b><small>${esc([b.count>1?b.count+"× "+b.type:b.type||"battery type not set",b.life].filter(Boolean).join(" · "))}</small>
     <small>${b.changed?`${b.charge?"Charged":"Changed"} ${esc(fmtDate(b.changed))} · next by ${esc(fmtDate(b.next))}`:"No change logged yet"} · every ${b.months<1?"few weeks":b.months===1?"month":b.months+" months"}</small></div>
     <div class="bb">${pill(b)}<button class="btn ghost" type="button" data-act="battnow" data-id="${esc(i.id)}">${b.charge?"Charged today":"Changed today"}</button><button class="btn ghost" type="button" data-act="battedit" data-id="${esc(i.id)}">Edit</button>${window.LOOKUP_URL&&!b.looked?`<button class="btn ghost" type="button" data-act="battlook" data-id="${esc(i.id)}">Look up</button>`:""}</div></div>`).join("")}</div>
   ${Object.keys(spares).length?`<p class="hint">Spares to keep on hand (one full swap of everything): ${Object.entries(spares).map(([t,n])=>`<b>${n}× ${esc(t)}</b>`).join(" · ")}</p>`:""}`
   :`<p class="hint">Add optics, lights, lasers, NODs, headsets or radios to your inventory and they show up here.</p>`}`;
  const anchor=v.querySelector(".stats");if(anchor)anchor.insertAdjacentHTML("afterend",html);else v.insertAdjacentHTML("beforeend",html);
  const st=v.querySelector(".stats .stat b");if(st){const over=rows.filter(x=>x.b.status==="over").length;if(over)st.textContent=String(+st.textContent+over)}
  if(battEdit)renderBattSheet();
}}
function renderBattSheet(){const el=$("battSheet");const i=battEdit&&itemById(battEdit);if(!i){el.hidden=true;battEdit=null;syncLock();return}const b=battInfo(i)||{};
  el.querySelector(".panel").innerHTML=`<h2>Battery: ${esc(i.name)}</h2>
   <div class="f"><label for="bType">Battery</label><input id="bType" value="${esc(b.type||"")}" placeholder="CR123A, CR2032, AA, rechargeable"></div>
   <div class="f"><label for="bCount">How many</label><input id="bCount" type="number" min="1" value="${b.count||1}"></div>
   <div class="f"><label for="bMonths">Change every (months)</label><input id="bMonths" type="number" min="0.25" step="0.25" value="${b.months||6}"></div>
   <div class="f"><label for="bDate">Last changed</label><input id="bDate" type="date" value="${esc(b.changed||"")}"></div>
   <div class="f"><label for="bLife">Battery life note</label><input id="bLife" value="${esc(b.life||"")}" placeholder="~600 hrs at setting 12"></div>
   <label class="keep"><input type="checkbox" id="bNone"> This doesn't use batteries</label>
   <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-bs="close">Cancel</button><button class="btn" type="button" data-bs="save">Save</button></div>`;
  el.hidden=false;syncLock()}
$("battSheet").addEventListener("click",async e=>{const b=e.target.closest("[data-bs]");if(!b)return;const i=all.find(x=>x.id===battEdit&&!x.deleted);
  if(b.dataset.bs==="save"&&i){i.battType=$("bType").value.trim();i.battCount=Math.max(1,parseInt($("bCount").value)||1);i.battMonths=Math.max(0.25,+$("bMonths").value||6);i.battChanged=$("bDate").value||"";i.battLife=$("bLife").value.trim();if($("bNone").checked)i.battNone=true;i.updatedAt=now();await persist()}
  battEdit=null;renderBattSheet();renderExtra();updateBadges()});
{const _am=ACT.maint;ACT.maint=async(act,b)=>{
  const i=b?.dataset?.id&&all.find(x=>x.id===b.dataset.id&&!x.deleted);
  if(act==="battnow"&&i){i.battChanged=today();if(!i.battType){const g=battGuess(i);if(g){i.battType=g.type;i.battCount=g.count}}i.updatedAt=now();await persist();toast(`${i.name}: logged`);renderExtra();updateBadges();return}
  if(act==="battedit"&&i){battEdit=i.id;renderBattSheet();return}
  if(act==="battlook"&&i){b.disabled=true;b.textContent="Looking…";try{const j=await apiPost("/battery",{name:i.name,brand:i.brand||"",category:i.category||"",type:i.armType||""});const r=j.result||{};
      if(r.none){i.battNone=true;toast(`${i.name} doesn't use batteries`)}else{if(r.battery)i.battType=r.battery;if(+r.count)i.battCount=+r.count;if(+r.swapMonths)i.battMonths=+r.swapMonths;if(r.life)i.battLife=r.life;toast(`${i.name}: ${r.count||1}× ${r.battery||"?"}, change every ${r.swapMonths||"?"} months`,5000)}
      i.battLooked=true;i.updatedAt=now();await persist()}catch(err){toast("Battery lookup: "+err.message,5000)}renderExtra();return}
  return _am?_am(act,b):undefined}}
// item screen: battery line
{const _od=openDetail;openDetail=function(i,quiet){_od(i,quiet);const b=i&&battInfo(i);if(!b)return;const dl=$("detail").querySelector("dl");if(!dl)return;
  dl.insertAdjacentHTML("beforeend",`<div><dt>Battery</dt><dd>${esc(b.count>1?b.count+"× "+b.type:b.type||"—")}<small>${b.changed?`${b.charge?"charged":"changed"} ${esc(fmtDate(b.changed))} · next ${esc(fmtDate(b.next))}`:"change not logged"}</small></dd></div>`)}}

/* ---------- v19: shot timer + your own drills ---------- */
/* your drills live with your kits settings so they sync */
var myDrills=()=>Array.isArray(kits._drills)?kits._drills:[];
var allDrills=()=>[...DRILLS,...myDrills().map(d=>({...d,mine:true,metric:"total",tiers:(d.tiers||[]).filter(t=>t&&t[0]&&+t[1]>0).map(t=>[t[0],+t[1]]),src:"Your drill"}))];
async function saveDrills(list){kits={...kits,_drills:list};await persist();renderExtra()}
{const _dc=drillChart;drillChart=function(name){const lib=myDrills().find(d=>d.name.toLowerCase()===String(name).toLowerCase());if(!lib)return _dc(name);
  // chart with your goal lines: borrow the library code by temporarily adding it
  DRILLS.push({...lib,metric:"total",tiers:(lib.tiers||[]).filter(t=>t&&t[0]&&+t[1]>0).map(t=>[t[0],+t[1]])});try{return _dc(name)}finally{DRILLS.pop()}}}
drillLibrary=function(ds){
  const card=(d,key)=>{const me=ds.find(x=>x.name.toLowerCase()===d.name.toLowerCase());const best=me&&isFinite(me.best)?me.best:null;const lvl=tierFor(d,best);
    return `<article class="drill${d.mine?" mine":""}"><h4>${esc(d.name)}${d.mine?` <span class="tag">yours</span>`:""}</h4><div class="setup">${esc(d.setup||[d.dist?d.dist+" yd":"",d.rounds?d.rounds+" rds":"",d.start||""].filter(Boolean).join(" · "))}</div>
      ${d.tiers.length?`<div class="tiers">${d.tiers.map(t=>`<span class="${lvl===t[0]?"hit":""}">${esc(t[0])} ≤ ${(+t[1]).toFixed(2)}s</span>`).join("")}</div>`:""}
      ${d.tip?`<div class="setup">${esc(d.tip)}</div>`:""}
      <div class="you">${best!=null?`Your best: <b>${best.toFixed(2)}s</b>${lvl?` · <b>${esc(lvl)}</b>`:""}${me&&isFinite(me.bestFirst)?` · draw ${me.bestFirst.toFixed(2)}s`:""}${me&&isFinite(me.bestSplit)?` · split ${me.bestSplit.toFixed(2)}s`:""}`:"Not logged yet"}</div>
      <div class="vbtns"><button class="btn" type="button" data-act="timerdrill" data-k="${esc(key)}">Run with timer</button><button class="btn ghost" type="button" data-act="logdrill2" data-k="${esc(key)}">Log by hand</button>${d.mine?`<button class="btn ghost" type="button" data-act="editdrill" data-k="${esc(key)}">Edit</button>`:""}</div>
      <div class="src">${d.mine?"":"Source: "+esc(d.src)}</div></article>`};
  return `<div class="slotsHead">Drills <span>${myDrills().length?`${myDrills().length} of yours + `:""}published standards</span></div>
   <div class="vbtns" style="margin:8px 0"><button class="btn" type="button" data-act="timer">Shot timer</button><button class="btn ghost" type="button" data-act="newdrill">+ Add your own drill</button></div>
   <div class="drills">${myDrills().map(d=>card(allDrills().find(x=>x.id===d.id),"m:"+d.id)).join("")}${DRILLS.map((d,k)=>card(d,"p:"+k)).join("")}</div>`;
};
var drillByKey=k=>{if(!k)return null;if(k.startsWith("m:"))return allDrills().find(d=>d.id===k.slice(2))||null;return DRILLS[+k.slice(2)]||null};
// keep the drill name suggestions current
{const _rr=RENDER.range;RENDER.range=()=>{_rr();const dl=$("drills");if(dl){const have=new Set([...dl.options].map(o=>o.value));myDrills().forEach(d=>{if(!have.has(d.name))dl.insertAdjacentHTML("beforeend",`<option>${esc(d.name)}</option>`)})}
  const head=$("rangeView").querySelector(".vhead .btn[data-act='new']");if(head&&!$("rangeView").querySelector(".vhead [data-act='timer']"))head.insertAdjacentHTML("beforebegin",`<button class="btn ghost" type="button" data-act="timer">Shot timer</button>`)}}
{const _ar=ACT.range;ACT.range=(act,t)=>{
  if(act==="timer"){openTimer(null);return}
  if(act==="timerdrill"){openTimer(t.dataset.k);return}
  if(act==="newdrill"){drillEd={id:"",name:"",dist:"",rounds:"",start:"Holster",setup:"",tip:"",tiers:[["Goal",""],["",""],["",""]]};renderDrillEd();return}
  if(act==="editdrill"){const d=myDrills().find(x=>"m:"+x.id===t.dataset.k);if(d){drillEd=JSON.parse(JSON.stringify(d));while((drillEd.tiers=drillEd.tiers||[]).length<3)drillEd.tiers.push(["",""]);renderDrillEd()}return}
  if(act==="logdrill2"){const d=drillByKey(t.dataset.k);if(!d)return;const m=String(d.setup||"").match(/^(\d+) yd/);const row={name:d.name,dist:d.dist||(m?+m[1]:""),par:d.par||""};
    if(ED.range){collect("range");const ds=ED.range.draft.drills=ED.range.draft.drills||[];const empty=ds.findIndex(x=>!x.name);if(empty>=0)ds[empty]=row;else ds.push(row);renderExtra()}else openEd("range",{date:today(),lines:[{}],drills:[row]});curDrill=d.name;return}
  return _ar(act,t)}}

/* drill editor */
var drillEd=null;
function renderDrillEd(){const el=$("drillSheet");const d=drillEd;if(!d){el.hidden=true;syncLock();return}
  el.querySelector(".panel").innerHTML=`<h2>${d.id?"Edit drill":"Your own drill"}</h2>
   <div class="f"><label for="dName">Name</label><input id="dName" value="${esc(d.name)}" placeholder="3-target transition"></div>
   <div class="row3"><div class="f"><label for="dDist">Yards</label><input id="dDist" type="number" min="0" value="${esc(d.dist)}"></div><div class="f"><label for="dRds">Rounds</label><input id="dRds" type="number" min="1" value="${esc(d.rounds)}"></div>
   <div class="f"><label for="dStart">Start from</label><select id="dStart">${["Holster","Concealment","Low ready","High ready","Table / box","Sling","Other"].map(s=>`<option${d.start===s?" selected":""}>${s}</option>`).join("")}</select></div></div>
   <div class="f"><label for="dSetup">Course of fire</label><input id="dSetup" value="${esc(d.setup)}" placeholder="2 body, reload, 2 body on 8&quot; plate"></div>
   <div class="f"><label>Goal times (optional)</label>${d.tiers.map((t,k)=>`<div class="row2t"><input data-tn="${k}" value="${esc(t[0])}" placeholder="${["Goal","Good","Great"][k]}"><input data-tt="${k}" type="number" step="0.01" min="0" value="${esc(t[1])}" placeholder="seconds"></div>`).join("")}</div>
   <div class="f"><label for="dTip">Notes</label><input id="dTip" value="${esc(d.tip)}" placeholder="Scoring, target, cues"></div>
   <div class="actions">${d.id?`<button class="btn ghost" type="button" data-de="del">Delete</button>`:""}<span class="spacer"></span><button class="btn ghost" type="button" data-de="close">Cancel</button><button class="btn" type="button" data-de="save">Save drill</button></div>`;
  el.hidden=false;syncLock()}
$("drillSheet").addEventListener("click",async e=>{const b=e.target.closest("[data-de]");if(!b)return;const a=b.dataset.de;
  if(a==="close"){drillEd=null;renderDrillEd();return}
  if(a==="del"){if(!b.dataset.armed){b.dataset.armed=1;b.textContent="Tap again to delete";return}const id=drillEd.id;drillEd=null;renderDrillEd();await saveDrills(myDrills().filter(x=>x.id!==id));toast("Drill deleted");return}
  if(a==="save"){const name=$("dName").value.trim();if(!name){$("dName").focus();return}
    const tiers=[0,1,2].map(k=>[document.querySelector(`[data-tn="${k}"]`).value.trim()||(document.querySelector(`[data-tt="${k}"]`).value?["Goal","Good","Great"][k]:""),+document.querySelector(`[data-tt="${k}"]`).value||""]).filter(t=>t[0]&&t[1]).sort((x,y)=>y[1]-x[1]);
    const rec={id:drillEd.id||uid(),name:name.slice(0,60),dist:+$("dDist").value||"",rounds:+$("dRds").value||"",start:$("dStart").value,setup:$("dSetup").value.trim().slice(0,160),tip:$("dTip").value.trim().slice(0,200),tiers};
    rec.setup=rec.setup||[rec.dist?rec.dist+" yd":"",rec.rounds?rec.rounds+" rds":"",rec.start?"from "+rec.start.toLowerCase():""].filter(Boolean).join(" · ");
    const list=myDrills().filter(x=>x.id!==rec.id);list.unshift(rec);drillEd=null;renderDrillEd();await saveDrills(list);toast(`Saved ${rec.name}`)}});

/* ---------- shot timer ---------- */
var TM={ctx:null,stream:null,node:null,src:null,useWorklet:false,running:false,beepAt:0,shots:[],peak:0,cal:false,calPeak:0,wake:null,autoStop:null,parT:0,
  set:(()=>{try{return JSON.parse(localStorage.getItem("gearLocker.timer")||"{}")}catch{return {}}})()};
TM.set={th:-12,hold:0.08,delay:"random",par:"",addRounds:true,...TM.set};
var saveTmSet=()=>{try{localStorage.setItem("gearLocker.timer",JSON.stringify(TM.set))}catch{}};
var dbToLin=db=>Math.pow(10,db/20),linToDb=v=>v>0?20*Math.log10(v):-90;
var tmDrill=null;
var WORKLET=`class D extends AudioWorkletProcessor{constructor(){super();this.th=0.25;this.hold=0.08*sampleRate;this.last=-1e12;this.arm=1e18;this.mf=-1;this.mt=-1;this.pk=0;this.n=0;this.port.onmessage=e=>{const m=e.data;if(m.th!=null)this.th=m.th;if(m.hold!=null)this.hold=m.hold*sampleRate;if(m.arm!=null)this.arm=m.arm*sampleRate;if(m.mf!=null){this.mf=m.mf*sampleRate;this.mt=m.mt*sampleRate}}}
process(ins){const c=ins[0]&&ins[0][0];if(!c)return true;for(let i=0;i<c.length;i++){const v=c[i]<0?-c[i]:c[i];if(v>this.pk)this.pk=v;const f=currentFrame+i;if(v>=this.th&&f>=this.arm&&!(f>=this.mf&&f<=this.mt)&&f-this.last>this.hold){this.last=f;this.port.postMessage({shot:f/sampleRate,lvl:v})}}
this.n+=c.length;if(this.n>=sampleRate*0.04){this.port.postMessage({peak:this.pk});this.pk=0;this.n=0}return true}}registerProcessor("shot-detector",D);`;
async function micOn(){
  if(TM.ctx&&TM.stream)return true;
  if(!navigator.mediaDevices?.getUserMedia){toast("This browser can't use the microphone",5000);return false}
  try{
    TM.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
    TM.ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});if(TM.ctx.state==="suspended")await TM.ctx.resume();
    TM.src=TM.ctx.createMediaStreamSource(TM.stream);
    try{const url=URL.createObjectURL(new Blob([WORKLET],{type:"application/javascript"}));await TM.ctx.audioWorklet.addModule(url);TM.node=new AudioWorkletNode(TM.ctx,"shot-detector");TM.useWorklet=true;TM.node.port.onmessage=e=>onDet(e.data)}
    catch{ // older Safari: script processor fallback
      const sp=TM.ctx.createScriptProcessor(256,1,1);let last=-1e9,arm=1e9,pk=0,n=0;TM.useWorklet=false;
      TM.fb={set:m=>{if(m.arm!=null)arm=m.arm;if(m.mf!=null){TM.fb.mf=m.mf;TM.fb.mt=m.mt}},mf:-1,mt:-1};
      sp.onaudioprocess=ev=>{const c=ev.inputBuffer.getChannelData(0);const t0=TM.ctx.currentTime-c.length/TM.ctx.sampleRate;const th=dbToLin(TM.set.th);for(let i=0;i<c.length;i++){const v=Math.abs(c[i]);if(v>pk)pk=v;const t=t0+i/TM.ctx.sampleRate;if(v>=th&&t>=arm&&!(t>=TM.fb.mf&&t<=TM.fb.mt)&&t-last>TM.set.hold){last=t;onDet({shot:t,lvl:v})}}n+=c.length;if(n>=TM.ctx.sampleRate*0.04){onDet({peak:pk});pk=0;n=0}};
      TM.node=sp;sp.connect(TM.ctx.destination)}
    TM.src.connect(TM.node);pushTm();return true;
  }catch(err){toast(err.name==="NotAllowedError"?"Allow microphone access for Gear Locker in Settings to use the timer":"Mic error: "+err.message,6000);return false}
}
function micOff(){try{TM.stream?.getTracks().forEach(t=>t.stop())}catch{}try{TM.ctx?.close()}catch{}TM.ctx=TM.stream=TM.node=TM.src=null;try{TM.wake?.release()}catch{}TM.wake=null}
function pushTm(m){const msg={th:dbToLin(TM.set.th),hold:TM.set.hold,...(m||{})};if(TM.useWorklet)TM.node?.port.postMessage(msg);else TM.fb?.set(msg)}
function beep(at,ms=220,hz=2600){const o=TM.ctx.createOscillator(),g=TM.ctx.createGain();o.type="square";o.frequency.value=hz;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(0.9,at+0.005);g.gain.setValueAtTime(0.9,at+ms/1000-0.01);g.gain.linearRampToValueAtTime(0,at+ms/1000);o.connect(g).connect(TM.ctx.destination);o.start(at);o.stop(at+ms/1000+0.02)}
function onDet(m){
  if(m.peak!=null){TM.peak=m.peak;if(TM.cal)TM.calPeak=Math.max(TM.calPeak,m.peak);drawMeter();return}
  if(m.shot!=null&&TM.running){const t=m.shot-TM.beepAt;if(t<0)return;TM.shots.push({t,lvl:m.lvl});clearTimeout(TM.autoStop);
    const need=+tmDrill?.rounds||0;if(need&&TM.shots.length>=need)TM.autoStop=setTimeout(()=>stopTimer(),1500);renderTimerShots();navigator.vibrate?.(15)}
}
function drawMeter(){const bar=$("tmLvl");if(!bar)return;const db=Math.max(-60,linToDb(TM.peak));bar.style.width=`${Math.max(0,(db+60)/60*100)}%`;bar.classList.toggle("hot",db>=TM.set.th)}
function openTimer(key){tmDrill=key?drillByKey(key):null;TM.shots=[];TM.running=false;renderTimer()}
function closeTimer(){if(TM.running)stopTimer(true);micOff();$("timerSheet").hidden=true;syncLock()}
function renderTimer(){
  const el=$("timerSheet");const guns=firearms();const s=TM.set;
  el.querySelector(".panel").innerHTML=`<h2>Shot timer</h2>
   <div class="row2t"><select id="tmDrill" aria-label="Drill"><option value="">Free run (no drill)</option>${myDrills().map(d=>`<option value="m:${esc(d.id)}"${tmDrill&&tmDrill.id===d.id?" selected":""}>${esc(d.name)} (yours)</option>`).join("")}${DRILLS.map((d,k)=>`<option value="p:${k}"${tmDrill&&!tmDrill.mine&&tmDrill.name===d.name?" selected":""}>${esc(d.name)}</option>`).join("")}</select>
     <select id="tmGun" aria-label="Gun"><option value="">Gun (optional)</option>${guns.map(g=>`<option value="${esc(g.id)}"${s.gun===g.id?" selected":""}>${esc(g.name)}</option>`).join("")}</select></div>
   ${tmDrill?`<p class="hint" style="margin:4px 0">${esc(tmDrill.setup||"")}${tmDrill.tiers?.length?` · goals: ${tmDrill.tiers.map(t=>`${esc(t[0])} ${(+t[1]).toFixed(2)}s`).join(", ")}`:""}</p>`:""}
   <div class="tmBig"><div><b id="tmTotal">0.00</b><span>last shot</span></div><div><b id="tmCount">0</b><span>shots</span></div><div><b id="tmFirst">—</b><span>first shot</span></div></div>
   <div id="tmShots" class="tmShots"></div>
   <div class="tmCtl"><button class="btn tmGo" type="button" data-tm="go">${TM.running?"Stop":"Start"}</button><button class="btn ghost" type="button" data-tm="clear">Clear</button><button class="btn ghost" type="button" data-tm="save">Save to range log</button></div>
   <details class="tmSet"${TM.set.seen?"":" open"}><summary>Mic sensitivity &amp; start beep</summary>
     <div class="meter2"><i id="tmLvl"></i><span class="thr" style="left:${(s.th+60)/60*100}%"></span></div>
     <div class="f"><label for="tmTh">Pick up shots louder than <b id="tmThV">${s.th} dB</b></label><input id="tmTh" type="range" min="-50" max="-1" step="1" value="${s.th}"></div>
     <div class="vbtns"><button class="btn ghost" type="button" data-tm="pre" data-v="-6">Unsuppressed</button><button class="btn ghost" type="button" data-tm="pre" data-v="-16">Suppressed</button><button class="btn ghost" type="button" data-tm="pre" data-v="-30">Dry fire / .22</button><button class="btn ghost" type="button" data-tm="cal">${TM.cal?"Listening… fire one shot":"Calibrate"}</button></div>
     <div class="f"><label for="tmHold">Ignore echoes closer than <b id="tmHoldV">${s.hold.toFixed(2)}s</b></label><input id="tmHold" type="range" min="0.04" max="0.30" step="0.01" value="${s.hold}"></div>
     <div class="row2t"><div class="f"><label for="tmDelay">Start beep</label><select id="tmDelay"><option value="random"${s.delay==="random"?" selected":""}>Random 2–4 s</option><option value="3"${s.delay==="3"?" selected":""}>After 3 s</option><option value="0"${s.delay==="0"?" selected":""}>Instant</option></select></div>
     <div class="f"><label for="tmPar">Par time (s)</label><input id="tmPar" type="number" step="0.1" min="0" value="${esc(s.par)}" placeholder="none"></div></div>
     <label class="keep"><input type="checkbox" id="tmAdd"${s.addRounds?" checked":""}> Add shots to the gun's round count when saving</label>
     <p class="hint">Calibrate: tap it, then fire one shot (or the loudest thing you want counted). It sets the level just under that. Other shooters on the line can trigger it, so a lane to yourself, or the Suppressed setting with your muzzle close to the phone, works best.</p>
   </details>
   <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-tm="close">Done</button></div>`;
  el.hidden=false;syncLock();renderTimerShots();if(!TM.set.seen){TM.set.seen=1;saveTmSet()}
}
function renderTimerShots(){const box=$("tmShots");if(!box)return;const sh=TM.shots;
  $("tmTotal").textContent=sh.length?sh[sh.length-1].t.toFixed(2):"0.00";$("tmCount").textContent=sh.length;$("tmFirst").textContent=sh.length?sh[0].t.toFixed(2):"—";
  box.innerHTML=sh.length?sh.map((x,k)=>`<div class="tmShot"><span>#${k+1}</span><b>${x.t.toFixed(2)}</b><span>${k?`split ${(x.t-sh[k-1].t).toFixed(2)}`:"first"}</span><button type="button" class="qb x" data-tm="rm" data-i="${k}" aria-label="Not a shot">✕</button></div>`).join("")
    :`<p class="hint">${TM.running?"Listening…":"Tap Start, hold steady for the beep."}</p>`;box.scrollTop=box.scrollHeight;
  const tot=sh.length?sh[sh.length-1].t:0;const lvl=tmDrill&&tot?tierFor({metric:"total",tiers:tmDrill.tiers||[]},tot):null;
  if(lvl&&!TM.running)box.insertAdjacentHTML("beforeend",`<p class="hint"><b>${esc(lvl)}</b> pace for ${esc(tmDrill.name)}</p>`);
}
async function startTimer(){
  if(!(await micOn()))return;
  try{TM.wake=await navigator.wakeLock?.request("screen")}catch{}
  TM.shots=[];TM.running=true;renderTimerShots();
  const d=TM.set.delay==="random"?2+Math.random()*2:+TM.set.delay;const at=TM.ctx.currentTime+Math.max(0.15,d);
  TM.beepAt=at;beep(at);pushTm({arm:at+0.24});
  const par=+TM.set.par;if(par>0){TM.parT=at+par;beep(at+par,180,1900);pushTm({mf:at+par-0.01,mt:at+par+0.22})}else pushTm({mf:-1,mt:-1});
  const go=$("timerSheet").querySelector(".tmGo");if(go)go.textContent="Stop";
}
function stopTimer(silent){TM.running=false;clearTimeout(TM.autoStop);pushTm({arm:1e9});const go=$("timerSheet").querySelector(".tmGo");if(go)go.textContent="Start";renderTimerShots();try{TM.wake?.release()}catch{}TM.wake=null;if(!silent&&TM.shots.length)navigator.vibrate?.([30,60,30])}
$("timerSheet").addEventListener("input",e=>{const t=e.target;if(t.id==="tmTh"){TM.set.th=+t.value;$("tmThV").textContent=t.value+" dB";$("timerSheet").querySelector(".thr").style.left=`${(TM.set.th+60)/60*100}%`;pushTm();saveTmSet()}
  if(t.id==="tmHold"){TM.set.hold=+t.value;$("tmHoldV").textContent=(+t.value).toFixed(2)+"s";pushTm();saveTmSet()}});
$("timerSheet").addEventListener("change",e=>{const t=e.target;if(t.id==="tmDelay"){TM.set.delay=t.value;saveTmSet()}if(t.id==="tmPar"){TM.set.par=t.value;saveTmSet()}if(t.id==="tmGun"){TM.set.gun=t.value;saveTmSet()}if(t.id==="tmAdd"){TM.set.addRounds=t.checked;saveTmSet()}if(t.id==="tmDrill"){tmDrill=drillByKey(t.value);renderTimer()}});
$("timerSheet").addEventListener("click",async e=>{const b=e.target.closest("[data-tm]");if(!b)return;const a=b.dataset.tm;
  if(a==="close"){closeTimer();return}
  if(a==="go"){if(TM.running)stopTimer();else await startTimer();return}
  if(a==="clear"){if(TM.running)stopTimer(true);TM.shots=[];renderTimerShots();return}
  if(a==="rm"){TM.shots.splice(+b.dataset.i,1);renderTimerShots();return}
  if(a==="pre"){TM.set.th=+b.dataset.v;saveTmSet();pushTm();renderTimer();if(!TM.ctx)await micOn();return}
  if(a==="cal"){if(!(await micOn()))return;TM.cal=true;TM.calPeak=0;b.textContent="Listening… fire one shot";setTimeout(()=>{TM.cal=false;if(TM.calPeak>0.01){TM.set.th=Math.round(Math.max(-50,Math.min(-1,linToDb(TM.calPeak)-8)));saveTmSet();pushTm();toast(`Set to ${TM.set.th} dB (8 dB under that shot)`)}else toast("Didn't hear anything loud. Try again closer to the phone.");renderTimer()},5000);return}
  if(a==="save"){if(!TM.shots.length){toast("No shots to save");return}if(TM.running)stopTimer(true);
    const sh=TM.shots;const first=+sh[0].t.toFixed(2);const splits=sh.slice(1).map((x,k)=>(x.t-sh[k].t).toFixed(2)).join(", ");const total=+sh[sh.length-1].t.toFixed(2);
    const name=tmDrill?.name||"Timer run";const row={name,dist:tmDrill?.dist||(String(tmDrill?.setup||"").match(/^(\d+) yd/)||[])[1]||"",par:+TM.set.par||"",first,splits,total,hits:"",shots:sh.length};
    let s=L("sessions").find(x=>x.date===today());s=s?{...s,drills:[...(s.drills||[])],lines:[...(s.lines||[])]}:{date:today(),type:"",location:"",lines:[],drills:[]};
    s.drills.push(row);
    const gun=TM.set.gun&&itemById(TM.set.gun);if(gun&&TM.set.addRounds){const l=s.lines.find(x=>x.firearmId===gun.id&&!x.ammoId);if(l)l.rounds=(+l.rounds||0)+sh.length;else s.lines.push({firearmId:gun.id,rounds:sh.length})}
    s.rounds=s.lines.reduce((a,l)=>a+(+l.rounds||0),0);
    await upsertC("sessions",s);curDrill=name;TM.shots=[];renderTimerShots();render();toast(`Saved: ${name} ${total.toFixed(2)}s (first ${first.toFixed(2)})`,4000);return}
});
$("timerSheet").querySelector(".sheetBg").addEventListener("click",closeTimer);

