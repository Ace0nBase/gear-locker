/* ---------- v26: smarter kit matching + ammo market prices ---------- */
/* 1) keywords must start a word ("tent" no longer matches "reTENTion", "amp" no longer matches "lAMP") */
var _kwRe={};
function hasKw(t,k){const r=_kwRe[k]||(_kwRe[k]=new RegExp("(^|[^a-z0-9])"+k.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));return r.test(t)}
all.forEach(i=>{try{delete i._kinds}catch{}});

/* 2) ammo on hand. Show what you paid. Do not look up retailer prices. */
var ammoName=a=>[a.caliber,a.brand,a.load].filter(Boolean).join(" ");
{const _r=RENDER.ammo;RENDER.ammo=()=>{_r();const v=$("ammoView");const recs=L("ammo");
  const st=v.querySelector(".stats");if(st){const paidStat=[...st.querySelectorAll(".stat")].find(s=>/Ammo value/.test(s.textContent));if(paidStat)paidStat.querySelector("span").textContent="What I paid"}
  const head=v.querySelector(".vhead > div");head?.insertAdjacentHTML("beforeend",`<p class="hint" style="margin:4px 0 0">Ammo stays out of your inventory total. Cost per round is what you paid for that line. War Box does not look up ammo prices or stores.</p>`);
  if(!recs.length)return;
  const cards=recs.slice().sort((a,b)=>(a.caliber||"").localeCompare(b.caliber||"")).map(a=>{const paid=+a.cpr&&+a.rounds?(+a.cpr)*(+a.rounds):0;
    return `<div class="ammoP"><div class="apTop"><b>${esc(ammoName(a)||"Ammo")}</b><small>${(+a.rounds||0).toLocaleString()} rds${a.location?" · "+esc(a.location):""}</small></div>
     <div class="apGrid">
      <div class="apPaid"><span>I paid</span><b>${money(paid)}</b></div>
      <div><span>Cost per round</span><b>${+a.cpr?"$"+(+a.cpr).toFixed(2):"—"}<i>/rd</i></b></div>
     </div>
     <div class="apBtns"><button class="btn ghost" type="button" data-act="ammoshot" data-id="${esc(a.id)}">I shot some</button></div>
     <div class="apShot" id="shot_${esc(a.id)}" hidden><input type="number" min="1" step="1" inputmode="numeric" placeholder="Rounds" aria-label="Rounds shot"><button class="btn" type="button" data-act="ammotake" data-id="${esc(a.id)}">Take off</button></div></div>`}).join("");
  const html=`<div class="slotsHead">What I paid</div><div class="ammoPs">${cards}</div>`;
  const tables=v.querySelectorAll(".scroll");const anchor=tables[0]||st;anchor?.insertAdjacentHTML("afterend",html);
}}
{const _a=ACT.ammo;ACT.ammo=async(act,b,e)=>{
  const id=b?.dataset?.id;
  if(act==="ammoshot"&&id){const box=$("shot_"+id);if(box){box.hidden=!box.hidden;if(!box.hidden)box.querySelector("input").focus()}return}
  if(act==="ammotake"&&id){const box=$("shot_"+id);const n=Math.round(+box.querySelector("input").value||0);if(n<=0){toast("Type how many rounds");return}
    const a=db.ammo.find(x=>x.id===id&&!x.deleted);if(!a)return;a.rounds=Math.max(0,(+a.rounds||0)-n);a.updatedAt=now();await persist();toast(`${n.toLocaleString()} rds off ${ammoName(a)} · ${a.rounds.toLocaleString()} left`);renderExtra();updateBadges();return}
  return _a?_a(act,b,e):undefined}}

/* ---------- v27: Comms — frequencies, CHIRP export/import, PACE plans ---------- */
var MODES=[["FM","FM (wide)"],["NFM","NFM (narrow)"],["AM","AM"]];
var TONES=["67.0","69.3","71.9","74.4","77.0","79.7","82.5","85.4","88.5","91.5","94.8","97.4","100.0","103.5","107.2","110.9","114.8","118.8","123.0","127.3","131.8","136.5","141.3","146.2","151.4","156.7","159.8","162.2","165.5","167.9","171.3","173.8","177.3","179.9","183.5","186.2","189.9","192.8","196.6","199.5","203.5","206.5","210.7","218.1","225.7","229.1","233.6","241.8","250.3","254.1"];
var SERVICES=["Ham","GMRS","FRS","MURS","Marine","Aviation","NOAA weather","Public safety (listen)","Business","Other"];
// what a Baofeng can legally transmit on: ham (with your license). Everything else exports as receive-only.
var TX_OK=s=>!s||s==="Ham"||s==="Other";
var fnum=v=>{const n=parseFloat(String(v||"").replace(/[^\d.]/g,""));return isFinite(n)&&n>0?n:0};
var mhz=v=>fnum(v)?fnum(v).toFixed(4).replace(/0{1,2}$/,""):"";
function txFreq(f){const rx=fnum(f.rx);if(!rx)return 0;if(f.duplex==="+")return rx+fnum(f.offset);if(f.duplex==="-")return rx-fnum(f.offset);if(f.duplex==="split")return fnum(f.tx);if(f.duplex==="off")return 0;return rx}
var toneTxt=f=>f.toneMode==="Tone"?`T ${f.txTone}`:f.toneMode==="TSQL"?`TSQL ${f.txTone}`:f.toneMode==="DTCS"?`DCS ${f.dcs||"023"}`:"";
var radios=()=>live().filter(i=>classify(i).has("radio")||(i.category==="Comms & Radios"&&/baofeng|uv-?\d|bf-?|radio|yaesu|kenwood|icom|btech|tidradio|wouxun|quansheng|anytone|motorola|midland/i.test(i.name+" "+(i.brand||""))&&!/antenna|cable|ptt|adapter|mic|headset|battery|charger/i.test(i.name)));
var commsSet=()=>kits._settings?.comms||{};
async function setComms(p){kits={...kits,_settings:{...(kits._settings||{}),comms:{...commsSet(),...p}}};await persist()}
var chN=f=>f.ch===""||f.ch==null||!isFinite(+f.ch)?9999:+f.ch;
var freqsSorted=()=>L("freqs").sort((a,b)=>chN(a)-chN(b)||(a.group||"").localeCompare(b.group||"")||fnum(a.rx)-fnum(b.rx));
var commsTab="freqs",commsGroup="All",paceEd=null;
NEWREC.comms=()=>({mode:"FM",duplex:"",toneMode:"",power:"High",service:"Ham",group:commsGroup!=="All"?commsGroup:""});

/* ---- CHIRP CSV ---- */
var CHIRP_HEAD=["Location","Name","Frequency","Duplex","Offset","Tone","rToneFreq","cToneFreq","DtcsCode","DtcsPolarity","RxDtcsCode","CrossMode","Mode","TStep","Skip","Power","Comment","URCALL","RPT1CALL","RPT2CALL","DVCODE"];
var csvCell=v=>{v=String(v??"");return /[",\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v};
function chirpRows(list,start){return list.map((f,k)=>{
  const rxOnly=f.duplex==="off"||!TX_OK(f.service);const dup=rxOnly?"off":f.duplex||"";
  const off=dup==="split"?fnum(f.tx).toFixed(6):dup==="+"||dup==="-"?fnum(f.offset).toFixed(6):"0.000000";
  const tm=f.toneMode||"";const t=f.txTone||"88.5",r=f.toneMode==="TSQL"?(f.txTone||"88.5"):(f.rxTone||t);
  return [start+k,(f.short||f.name||"").replace(/[^\w\- ./]/g,"").slice(0,7).toUpperCase(),fnum(f.rx).toFixed(6),dup,off,tm,t,r,f.dcs||"023","NN",f.dcs||"023","Tone->Tone",f.mode||"FM","5.00",f.skip?"S":"",f.power==="Low"?"1.0W":"5.0W",(f.notes||f.name||"").slice(0,60),"","","",""]})}
function chirpCsv(list,start){return [CHIRP_HEAD,...chirpRows(list,start)].map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n"}
function parseCsv(t){const rows=[];let row=[],cur="",q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}else if(c==='"')q=true;else if(c===","){row.push(cur);cur=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&t[i+1]==="\n")i++;row.push(cur);rows.push(row);row=[];cur=""}else cur+=c}if(cur||row.length){row.push(cur);rows.push(row)}return rows.filter(r=>r.some(x=>x.trim()))}
function fromChirp(text){const rows=parseCsv(text);if(!rows.length)return[];const h=rows[0].map(x=>x.trim());const ix=k=>h.indexOf(k);if(ix("Frequency")<0)throw new Error("That isn't a CHIRP .csv (no Frequency column)");
  return rows.slice(1).map(r=>{const g=k=>(r[ix(k)]??"").trim();const rx=fnum(g("Frequency"));if(!rx)return null;let dup=g("Duplex");const tm=g("Tone");
    const svc=guessService(rx);
    return {ch:g("Location"),name:g("Name")||mhz(rx),short:g("Name"),rx:mhz(rx),duplex:dup,offset:dup==="+"||dup==="-"?mhz(g("Offset")):"",tx:dup==="split"?mhz(g("Offset")):"",
      toneMode:["Tone","TSQL","DTCS"].includes(tm)?tm:"",txTone:g("rToneFreq")||"",rxTone:g("cToneFreq")||"",dcs:g("DtcsCode")||"",mode:["FM","NFM","AM"].includes(g("Mode"))?g("Mode"):"FM",
      power:/^(1|low)/i.test(g("Power"))?"Low":"High",notes:g("Comment"),service:svc,group:"Imported",skip:g("Skip")==="S"}}).filter(Boolean)}
function guessService(rx){if((rx>=144&&rx<=148)||(rx>=420&&rx<=450)||(rx>=222&&rx<=225)||(rx>=50&&rx<=54))return rx>=462.55&&rx<=467.725?"GMRS":"Ham";if(rx>=462.55&&rx<=467.725)return "GMRS";if(rx>=151.82&&rx<=154.6)return "MURS";if(rx>=156&&rx<=162.025)return "Marine";if(rx>=162.4&&rx<=162.55)return "NOAA weather";if(rx>=108&&rx<=137)return "Aviation";return "Other"}
async function saveFile(name,text,type){const blob=new Blob([text],{type});
  try{const file=new File([blob],name,{type});if(navigator.canShare&&navigator.canShare({files:[file]})&&/iphone|ipad|android/i.test(navigator.userAgent)){await navigator.share({files:[file],title:name});return}}catch(e){if(e.name==="AbortError")return}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)}

/* ---- starter channels (common, public) ---- */
var COMMON={
 "Ham calling":[["2MCALL","146.520","Ham","National 2 m FM simplex calling"],["70CALL","446.000","Ham","National 70 cm FM simplex calling"],["2M 55","146.550","Ham","2 m simplex"],["2M 58","146.580","Ham","2 m simplex"],["70 500","446.500","Ham","70 cm simplex"]],
 "NOAA weather":[["WX1","162.550","NOAA weather"],["WX2","162.400","NOAA weather"],["WX3","162.475","NOAA weather"],["WX4","162.425","NOAA weather"],["WX5","162.450","NOAA weather"],["WX6","162.500","NOAA weather"],["WX7","162.525","NOAA weather"]],
 "MURS":[["MURS1","151.820","MURS"],["MURS2","151.880","MURS"],["MURS3","151.940","MURS"],["MURS4","154.570","MURS"],["MURS5","154.600","MURS"]],
 "FRS / GMRS 1–22":[...[462.5625,462.5875,462.6125,462.6375,462.6625,462.6875,462.7125,467.5625,467.5875,467.6125,467.6375,467.6625,467.6875,467.7125,462.55,462.575,462.6,462.625,462.65,462.675,462.7,462.725].map((f,k)=>[`FRS${k+1}`,f.toFixed(4),k<7||k>=14?"GMRS":"FRS"])],
 "Marine":[["MAR16","156.800","Marine","Distress / calling"],["MAR9","156.450","Marine","Boater calling"],["MAR22A","157.100","Marine","Coast Guard liaison"]],
};

/* ---- render ---- */
RENDER.comms=()=>{
  const v=$("commsView");const ed=ED.comms,d=ed?.draft||{};const cs=commsSet();const rs=radios();
  const all_=freqsSorted();const groups=["All",...[...new Set(all_.map(f=>f.group||"Ungrouped"))].sort()];if(!groups.includes(commsGroup))commsGroup="All";
  const list=commsGroup==="All"?all_:all_.filter(f=>(f.group||"Ungrouped")===commsGroup);
  const form=ed?edForm("comms",ed.isNew?"Add a frequency":"Edit frequency",
    fld("name","Name",d.name,{req:1,ph:"Team primary",span:2})+fld("short","Radio display name (7 letters)",d.short,{ph:"TEAM1"})+fld("ch","Channel #",d.ch,{type:"number",step:1})+
    fld("rx","Receive freq (MHz)",d.rx,{req:1,ph:"146.520",step:"0.0001"})+fld("duplex","Transmit",d.duplex,{type:"select",opts:[["","Same as receive (simplex)"],["+","Repeater + offset"],["-","Repeater − offset"],["split","Different TX freq"],["off","Receive only"]]})+
    fld("offset","Offset (MHz)",d.offset,{ph:"0.600"})+fld("tx","TX freq if different (MHz)",d.tx,{ph:"—"})+
    fld("toneMode","Tone",d.toneMode,{type:"select",opts:[["","None"],["Tone","Tone (TX only, repeaters)"],["TSQL","Tone squelch (TX + RX)"],["DTCS","DCS code"]]})+
    fld("txTone","CTCSS tone (Hz)",d.txTone,{type:"select",opts:[["",""],...TONES.map(t=>[t,t])]})+fld("dcs","DCS code",d.dcs,{ph:"023"})+
    fld("mode","Mode",d.mode,{type:"select",opts:MODES})+fld("power","Power",d.power,{type:"select",opts:[["High","High"],["Low","Low"]]})+
    fld("service","Service",d.service,{type:"select",opts:SERVICES.map(s=>[s,s])})+fld("group","Group",d.group,{list:"freqGroups",ph:"Team, Family, Repeaters"})+
    `<datalist id="freqGroups">${groups.filter(g=>g!=="All").map(g=>`<option value="${esc(g)}">`).join("")}</datalist>`+
    (rs.length?`<div class="f span4"><label>On which radios</label><div class="radioPick">${rs.map(r=>`<label class="keep"><input type="checkbox" name="radios.${esc(r.id)}"${(d.radios||{})[r.id]?" checked":""}> ${esc(r.name)}</label>`).join("")}</div></div>`:"")+
    fld("notes","Notes",d.notes,{span:4,ph:"Repeater location, net times, who's on it"})+
    `<p class="hint span4">${!TX_OK(d.service||"Ham")?"Baofengs aren't approved to transmit on "+esc(d.service)+", so this exports as <b>receive only</b>.":"Transmitting on ham frequencies needs your amateur license."}</p>`):"";
  const tabsH=`<div class="chips" role="tablist">${[["freqs","Frequencies"],["pace","PACE plans"],["radios","Radios & export"]].map(([k,l])=>`<button type="button" class="chip" aria-pressed="${commsTab===k}" data-act="ctab" data-k="${k}">${l}</button>`).join("")}</div>`;
  let body="";
  if(commsTab==="freqs"){
    body=`<section class="stats"><div class="stat"><b>${all_.length}</b><span>Frequencies</span></div><div class="stat"><b>${groups.length-1}</b><span>Groups</span></div><div class="stat"><b>${rs.length}</b><span>Radios</span></div><div class="stat"><b>${L("pace").length}</b><span>PACE plans</span></div></section>
    <div class="cBar"><select id="cGroup" aria-label="Group">${optList(groups.map(g=>[g,g]),commsGroup)}</select><button class="btn ghost" type="button" data-act="cimport">Import CHIRP .csv</button><button class="btn ghost" type="button" data-act="ccommon">Add common channels</button></div>
    ${list.length?`<div class="scroll"><table class="tbl"><thead><tr><th class="n">Ch</th><th>Name</th><th class="n">RX</th><th>TX</th><th>Tone</th><th>Mode</th><th>Group</th></tr></thead><tbody>${list.map(f=>{const tx=txFreq(f);const ro=f.duplex==="off"||!TX_OK(f.service);
      return `<tr class="click" data-act="edit" data-id="${esc(f.id)}"><td class="n">${esc(f.ch||"")}</td><td><b>${esc(f.name)}</b>${f.short&&f.short.toUpperCase()!==String(f.name).toUpperCase()?`<small class="mono"> ${esc(f.short)}</small>`:""}<br><small>${esc(f.service||"")}${f.notes?" · "+esc(f.notes):""}</small></td><td class="n mono">${esc(mhz(f.rx))}</td><td class="mono">${ro?"<small>RX only</small>":tx&&Math.abs(tx-fnum(f.rx))>1e-6?esc(mhz(tx)):"simplex"}</td><td class="mono">${esc(toneTxt(f)||"—")}</td><td>${esc(f.mode||"FM")}${f.power==="Low"?" · L":""}</td><td>${esc(f.group||"—")}</td></tr>`}).join("")}</tbody></table></div>`
     :`<div class="empty"><b>No frequencies yet</b>Tap <em>+</em> to add one, <em>Import CHIRP .csv</em> to pull in what's already on your radio, or <em>Add common channels</em> for calling, weather, MURS and FRS/GMRS.</div>`}`;
  }else if(commsTab==="pace"){
    const plans=L("pace").sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    body=`<p class="hint">A PACE plan is your <b>P</b>rimary, <b>A</b>lternate, <b>C</b>ontingency and <b>E</b>mergency way to reach your people, in order. Link each step to a saved frequency so the card prints with the real channel.</p>
          ${plans.length?`<div class="paceList">${plans.map(p=>paceCard(p,false)).join("")}</div>`:`<div class="empty"><b>No PACE plans yet</b>Make one for your team, your family, or a trip.</div>`}`;
  }else{
    body=`<div class="secBlock"><h3>Your station</h3><div class="row2"><div class="f"><label for="cCall">Callsign</label><input id="cCall" value="${esc(cs.callsign||"")}" placeholder="Your callsign" autocapitalize="characters"></div><div class="f"><label for="cStart">First memory # on export</label><input id="cStart" type="number" min="0" value="${esc(cs.start??0)}"></div></div><p class="hint">Baofeng UV-5R / BF-F8HP / UV-82 memories start at 0. Names are cut to 7 letters on the radio.</p></div>
     <div class="secBlock"><h3>Export for CHIRP</h3><p class="hint">Download the .csv, then in CHIRP: <b>Radio → Download from radio</b> (keeps your radio's settings), <b>File → Import</b> this .csv, then <b>Radio → Upload to radio</b>. Non-ham channels go out as receive-only.</p>
      <div class="cBar"><button class="btn" type="button" data-act="cexport" data-r="">All ${all_.length} frequencies</button>${rs.map(r=>{const n=all_.filter(f=>(f.radios||{})[r.id]).length;return `<button class="btn ghost" type="button" data-act="cexport" data-r="${esc(r.id)}"${n?"":" disabled"}>${esc(r.name)} (${n})</button>`}).join("")}</div>
      ${rs.length?"":`<p class="hint">Add your radios in Inventory under <b>Comms &amp; Radios</b> to keep a separate channel list for each.</p>`}
      ${all_.length>128?`<p class="hint">A UV-5R holds 128 channels; you have ${all_.length}. Export per radio to stay under it.</p>`:""}</div>
     <div class="secBlock"><h3>Print</h3><div class="cBar"><button class="btn ghost" type="button" data-act="cprint">Print frequency card</button></div></div>`;
  }
  v.innerHTML=`<div class="vhead"><div><h2>Comms</h2><p>Your frequencies, what's on each radio, and your PACE plans.</p></div><button class="btn" type="button" data-act="${commsTab==="pace"?"pnew":"new"}">${commsTab==="pace"?"+ PACE plan":"+ Frequency"}</button></div>${form}${tabsH}${body}${paceEd?paceSheet():""}<input type="file" id="chirpFile" accept=".csv,text/csv" hidden>`;
};
var PSTEP=[["p","Primary"],["a","Alternate"],["c","Contingency"],["e","Emergency"]];
var METHODS=["Radio","Cell call","Text / Signal","Satellite messenger","Ham repeater","Email","Meet in person","Visual / signal panel","Other"];
function freqLabel(id){const f=L("freqs").find(x=>x.id===id);if(!f)return "";return `${f.name} · ${mhz(f.rx)}${toneTxt(f)?" "+toneTxt(f):""}${f.ch!==""&&f.ch!=null?" · Ch "+f.ch:""}`}
function paceCard(p,print){return `<article class="pace"><header><b>${esc(p.name||"PACE plan")}</b>${p.who?`<small>${esc(p.who)}</small>`:""}${print?"":`<span class="spacer"></span><button class="btn ghost" type="button" data-act="pedit" data-id="${esc(p.id)}">Edit</button><button class="btn ghost" type="button" data-act="pprint" data-id="${esc(p.id)}">Print</button>`}</header>
  ${PSTEP.map(([k,l])=>{const s=p[k]||{};if(!s.method&&!s.detail&&!s.freq)return "";return `<div class="pstep"><span class="pl ${k}">${l[0]}</span><div><b>${esc(l)}: ${esc(s.method||"")}</b>${s.freq?`<div class="mono">${esc(freqLabel(s.freq))}</div>`:""}${s.detail?`<div>${esc(s.detail)}</div>`:""}${s.when?`<small>${esc(s.when)}</small>`:""}</div></div>`}).join("")}
  ${p.checkin?`<div class="pmeta"><b>Check-ins:</b> ${esc(p.checkin)}</div>`:""}${p.rally?`<div class="pmeta"><b>Rally point:</b> ${esc(p.rally)}</div>`:""}${p.callsigns?`<div class="pmeta"><b>Callsigns:</b> ${esc(p.callsigns)}</div>`:""}${p.codes?`<div class="pmeta"><b>Code words:</b> ${esc(p.codes)}</div>`:""}${p.notes?`<div class="pmeta">${esc(p.notes)}</div>`:""}</article>`}
function paceSheet(){const p=paceEd;const fs=freqsSorted();const fo=[["","— none —"],...fs.map(f=>[f.id,`${f.name} (${mhz(f.rx)})`])];
  return `<div class="sheetWrap"><div class="sheetBg" data-act="pclose"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="PACE plan"><div class="sheetTop"><span class="grab"></span><button class="xBtn" type="button" data-act="pclose" aria-label="Close">✕</button></div><form class="panel" id="paceForm"><h2>${p.id?"Edit PACE plan":"New PACE plan"}</h2>
   <div class="row2"><div class="f"><label>Plan name</label><input name="name" value="${esc(p.name||"")}" placeholder="Family, Team, Hunting trip"></div><div class="f"><label>Who's on it</label><input name="who" value="${esc(p.who||"")}" placeholder="Me, Sarah, Dad"></div></div>
   ${PSTEP.map(([k,l])=>{const s=p[k]||{};return `<fieldset class="pfs"><legend><span class="pl ${k}">${l[0]}</span> ${l}</legend><div class="row2"><div class="f"><label>Method</label><select name="${k}.method">${optList([["",""],...METHODS.map(m=>[m,m])],s.method)}</select></div><div class="f"><label>Frequency</label><select name="${k}.freq">${optList(fo,s.freq)}</select></div></div>
     <div class="f"><label>Details</label><input name="${k}.detail" value="${esc(s.detail||"")}" placeholder="${k==="p"?"Cell, call first":k==="a"?"Text, wait 15 min":k==="c"?"Radio on team channel":"Meet at the rally point"}"></div><div class="f"><label>When to switch to this</label><input name="${k}.when" value="${esc(s.when||"")}" placeholder="${k==="p"?"Default":"No answer after 2 tries / 30 min"}"></div></fieldset>`}).join("")}
   <div class="f"><label>Check-in schedule</label><input name="checkin" value="${esc(p.checkin||"")}" placeholder="Top of every hour, 5 min listening window"></div>
   <div class="f"><label>Rally point</label><input name="rally" value="${esc(p.rally||"")}" placeholder="Where to meet if nothing else works"></div>
   <div class="f"><label>Callsigns</label><input name="callsigns" value="${esc(p.callsigns||"")}" placeholder="Base = Lead, Mobile 1 = …"></div>
   <div class="f"><label>Code words</label><input name="codes" value="${esc(p.codes||"")}" placeholder="All good = Green, need help = Red"></div>
   <div class="f"><label>Notes</label><input name="notes" value="${esc(p.notes||"")}"></div>
   <div class="actions">${p.id?`<button class="btn ${p._armed?"danger":"ghost"}" type="button" data-act="pdel">${p._armed?"Confirm delete":"Delete"}</button>`:""}<span class="spacer"></span><button class="btn ghost" type="button" data-act="pclose">Cancel</button><button class="btn" type="button" data-act="psave">Save</button></div></form></div></div>`}
function paceCollect(){const f=$("paceForm");if(!f)return;f.querySelectorAll("[name]").forEach(el=>setPath(paceEd,el.name,el.value))}
SAVE.comms=async d=>{if(!fnum(d.rx)){toast("Enter the receive frequency");return}if(!String(d.name||"").trim())d.name=mhz(d.rx);d.rx=mhz(d.rx);
  if((d.duplex==="+"||d.duplex==="-")&&!fnum(d.offset))d.offset=fnum(d.rx)<300?"0.600":"5.000";
  const r={};Object.entries(d.radios||{}).forEach(([k,v])=>{if(v)r[k]=true});d.radios=r;
  await upsertC("freqs",d);ED.comms=null;toast("Frequency saved");render()};
DEL.comms=async d=>{await removeC("freqs",d.id)};
ACT.comms=async(act,b,e)=>{
  if(act==="change"&&b.id==="cGroup"){commsGroup=b.value;renderExtra();return}
  if(act==="change"&&(b.id==="cCall"||b.id==="cStart")){await setComms(b.id==="cCall"?{callsign:b.value.trim().toUpperCase()}:{start:Math.max(0,parseInt(b.value)||0)});toast("Saved");return}
  if(act==="change"&&b.id==="chirpFile"){const file=b.files[0];if(!file)return;try{const got=fromChirp(await file.text());const have=new Set(L("freqs").map(f=>mhz(f.rx)+"|"+(f.short||f.name)));let n=0;
      for(const f of got){if(have.has(f.rx+"|"+(f.short||f.name)))continue;await upsertC("freqs",f);n++}toast(n?`Imported ${n} frequenc${n>1?"ies":"y"}`:"Nothing new in that file",4000);commsGroup=n?"Imported":commsGroup;commsTab="freqs";render()}catch(err){toast(err.message,5000)}return}
  if(act==="ctab"){commsTab=b.dataset.k;renderExtra();return}
  if(act==="cimport"){$("chirpFile").click();return}
  if(act==="ccommon"){const v=$("commsView");v.querySelector(".cBar").insertAdjacentHTML("afterend",`<div class="secBlock" id="commonBox"><h3>Add common channels</h3>${Object.keys(COMMON).map(k=>`<label class="keep"><input type="checkbox" value="${esc(k)}"${k==="Ham calling"||k==="NOAA weather"?" checked":""}> ${esc(k)} (${COMMON[k].length})</label>`).join("")}<p class="hint">Only ham channels are set to transmit. Weather, MURS, FRS/GMRS and marine are added receive-only, because Baofengs aren't approved to transmit on them.</p><div class="cBar"><button class="btn" type="button" data-act="ccommonadd">Add</button></div></div>`);b.disabled=true;return}
  if(act==="ccommonadd"){const picks=[...$("commonBox").querySelectorAll("input:checked")].map(x=>x.value);const have=new Set(L("freqs").map(f=>mhz(f.rx)));let n=0;
    for(const g of picks)for(const [nm,fr,svc,note] of COMMON[g]){if(have.has(mhz(fr)))continue;await upsertC("freqs",{name:nm,short:nm,rx:mhz(fr),duplex:TX_OK(svc)?"":"off",mode:svc==="Ham"||svc==="NOAA weather"||svc==="Marine"?"FM":"NFM",power:"High",service:svc,group:g,notes:note||""});n++}
    toast(n?`Added ${n} channels`:"You already have those");render();return}
  if(act==="cexport"){const rid=b.dataset.r;const r=rid&&itemById(rid);const list=freqsSorted().filter(f=>!rid||(f.radios||{})[rid]);if(!list.length){toast("No frequencies to export");return}
    const cs=commsSet();const name=`${(r?r.name:"war-box-freqs").replace(/[^\w\-]+/g,"_")}_${today()}.csv`;await saveFile(name,chirpCsv(list,+cs.start||0),"text/csv");toast(`Exported ${list.length} channel${list.length>1?"s":""} for CHIRP`,4000);return}
  if(act==="cprint"){printFreqs();return}
  if(act==="pnew"){paceEd={};renderExtra();return}
  if(act==="pedit"){const p=L("pace").find(x=>x.id===b.dataset.id);if(p){paceEd=JSON.parse(JSON.stringify(p));renderExtra()}return}
  if(act==="pclose"){paceEd=null;renderExtra();return}
  if(act==="psave"){paceCollect();const {_armed,...rec}=paceEd;if(!String(rec.name||"").trim())rec.name="PACE plan";await upsertC("pace",rec);paceEd=null;commsTab="pace";toast("PACE plan saved");render();return}
  if(act==="pdel"){paceCollect();if(!paceEd._armed){paceEd._armed=true;renderExtra();return}await removeC("pace",paceEd.id);paceEd=null;toast("Deleted");render();return}
  if(act==="pprint"){const p=L("pace").find(x=>x.id===b.dataset.id);if(p)printPace(p);return}
};
function freqTable(list){return `<table><thead><tr><th>Ch</th><th>Name</th><th>RX MHz</th><th>TX</th><th>Tone</th><th>Mode</th><th>Notes</th></tr></thead><tbody>${list.map(f=>{const tx=txFreq(f);const ro=f.duplex==="off"||!TX_OK(f.service);return `<tr><td>${esc(f.ch||"")}</td><td><b>${esc(f.name)}</b></td><td>${esc(mhz(f.rx))}</td><td>${ro?"RX only":tx&&Math.abs(tx-fnum(f.rx))>1e-6?esc(mhz(tx)):"simplex"}</td><td>${esc(toneTxt(f)||"—")}</td><td>${esc(f.mode||"FM")}</td><td>${esc(f.notes||"")}</td></tr>`}).join("")}</tbody></table>`}
function printFreqs(){const cs=commsSet();const list=freqsSorted();const gs=[...new Set(list.map(f=>f.group||"Ungrouped"))];
  $("printSheet").innerHTML=`<div class="ph"><div><h1>FREQUENCY CARD</h1><small>${cs.callsign?esc(cs.callsign)+" · ":""}Printed ${new Date().toLocaleDateString()}</small></div></div>${gs.map(g=>`<h3>${esc(g)}</h3>${freqTable(list.filter(f=>(f.group||"Ungrouped")===g))}`).join("")}${L("pace").map(p=>paceCard(p,true)).join("")}`;window.print()}
function printPace(p){const ids=PSTEP.map(([k])=>p[k]?.freq).filter(Boolean);const list=L("freqs").filter(f=>ids.includes(f.id));
  $("printSheet").innerHTML=`<div class="ph"><div><h1>PACE PLAN — ${esc((p.name||"").toUpperCase())}</h1><small>Printed ${new Date().toLocaleDateString()}</small></div></div>${paceCard(p,true)}${list.length?`<h3>Frequencies</h3>${freqTable(list)}`:""}`;window.print()}
// Comms keeps its own pace-sheet inputs out of the frequency form collector
{const _c=collect;collect=function(view){if(view==="comms"&&paceEd)paceCollect();return _c(view)}}
// a radio's item screen shows how many channels are saved for it
{const _od=openDetail;openDetail=function(i,quiet){_od(i,quiet);if(!i||!radios().some(r=>r.id===i.id))return;const n=L("freqs").filter(f=>(f.radios||{})[i.id]).length;const dl=$("detail").querySelector("dl");dl?.insertAdjacentHTML("beforeend",`<div><dt>Channels</dt><dd>${n} saved in Comms</dd></div>`)}}

{const _f=$("fab").onclick;$("fab").onclick=()=>{if(curTab==="comms"&&commsTab==="pace"){paceEd={};renderExtra();return}_f()}}

/* ---------- v28: build a PACE plan from location + situation, using your frequencies ---------- */
var PG_SCEN=["Family at home (storm / power out)","Around town / neighborhood","Road trip / convoy","Day hike / backcountry","Hunting / camping trip","On the water","Range day / training","Team field exercise","Big event / crowd"];
var PG_DIST=["Within sight (under ½ mile)","Same area (up to 3 miles)","Across town (3–20 miles)","Far apart (20+ miles)"];
var PG_TERR=["Flat / open","Suburban","Dense city","Woods","Hills / mountains","Water"];
var PG_CELL=["Good","Spotty","None / expect it to go down"];
var PG_GRID=["Normal","Power out"];
var PG_LIC=["Only me (ham)","Everyone has a ham license","GMRS license","Nobody is licensed"];
var PG_DEV=["Phones","Baofeng / ham handheld","Mobile ham radio","GMRS radios","FRS walkie-talkies","MURS radios","Satellite messenger (inReach / ZOLEO)","CB radio"];
var paceGen=null;
function pgDefaults(){const inv=live().map(i=>(i.name+" "+(i.brand||"")).toLowerCase()).join(" | ");const dev=["Phones"];
  if(radios().length)dev.push("Baofeng / ham handheld");if(/inreach|zoleo|spot x|garmin messenger|bivy stick/.test(inv))dev.push("Satellite messenger (inReach / ZOLEO)");if(/gmrs|midland|rocky talkie/.test(inv))dev.push("GMRS radios");
  const last=commsSet().paceGen||{};return {location:last.location||"",scenario:last.scenario||PG_SCEN[0],distance:last.distance||PG_DIST[1],terrain:last.terrain||PG_TERR[1],cell:last.cell||PG_CELL[1],grid:last.grid||PG_GRID[0],people:"",licensed:last.licensed||(commsSet().callsign?PG_LIC[0]:PG_LIC[3]),devices:last.devices||dev,duration:"",notes:""}}
var onRadio=f=>Object.values(f.radios||{}).some(Boolean);
function pgCollect(){const f=$("pgForm");if(!f||!paceGen)return;const v=paceGen.in;f.querySelectorAll("[name]").forEach(el=>{if(el.name==="dev")return;v[el.name]=el.value});v.devices=[...f.querySelectorAll('[name="dev"]:checked')].map(x=>x.value)}
function pgSheet(){const g=paceGen,v=g.in;const sel=(n,arr)=>`<select name="${n}">${optList(arr.map(x=>[x,x]),v[n])}</select>`;
  let body="";
  if(g.stage==="form"||g.stage==="busy"){const busy=g.stage==="busy";
    body=`<h2>Build a PACE plan</h2><p class="hint">Tell it where and what. It builds the plan around the ${L("freqs").length} frequencies you've saved${window.LOOKUP_URL?" and, if you give an area, looks up real repeaters and the NOAA station there":""}.</p>
    <div class="f"><label>Area</label><div class="cBar" style="margin:0"><input name="location" value="${esc(v.location)}" placeholder="St. Augustine, FL or a ZIP" style="flex:1;min-width:0"><button class="btn ghost" type="button" data-act="pggeo">Use my location</button></div><small class="hint">Leave blank to skip the local lookup. Only the area you type is sent, never your gear.</small></div>
    <div class="row2"><div class="f"><label>Scenario</label>${sel("scenario",PG_SCEN)}</div><div class="f"><label>How far apart</label>${sel("distance",PG_DIST)}</div></div>
    <div class="row2"><div class="f"><label>Terrain</label>${sel("terrain",PG_TERR)}</div><div class="f"><label>Cell service</label>${sel("cell",PG_CELL)}</div></div>
    <div class="row2"><div class="f"><label>Power</label>${sel("grid",PG_GRID)}</div><div class="f"><label>Licenses</label>${sel("licensed",PG_LIC)}</div></div>
    <div class="f"><label>Radios &amp; devices the group has</label><div class="radioPick">${PG_DEV.map(d=>`<label class="keep"><input type="checkbox" name="dev" value="${esc(d)}"${v.devices.includes(d)?" checked":""}> ${esc(d)}</label>`).join("")}</div></div>
    <div class="row2"><div class="f"><label>Who's on it</label><input name="people" value="${esc(v.people)}" placeholder="Me, wife, 2 kids"></div><div class="f"><label>How long</label><input name="duration" value="${esc(v.duration)}" placeholder="Weekend, 3 days"></div></div>
    <div class="f"><label>Anything else</label><input name="notes" value="${esc(v.notes)}" placeholder="Kids carry FRS radios; we'll split into 2 vehicles"></div>
    ${g.err?`<div class="err">${esc(g.err)}</div>`:""}
    <div class="actions"><span class="spacer"></span><button class="btn ghost" type="button" data-act="pgclose">Cancel</button><button class="btn" type="button" data-act="pgrun"${busy?" disabled":""}>${busy?"Building… (up to a minute)":"Build plan"}</button></div>`;
  }else{const r=g.res;const fs=g.sent;
    const fref=s=>{if(s.f!=null){const f=fs[s.f]&&L("freqs").find(x=>x.id===fs[s.f].id);if(!f)return "";const rs=radios().filter(x=>(f.radios||{})[x.id]).map(x=>x.name);
        return `<div class="pgF have"><span class="mono">${esc(f.name)} · ${esc(mhz(f.rx))}${toneTxt(f)?" "+esc(toneTxt(f)):""}</span><small>${rs.length?"✓ On "+esc(rs.join(", ")):"✓ In your list · <b>not programmed on a radio yet</b>"}</small></div>`}
      if(s.n!=null){const n=r.newFreqs[s.n];return n?`<div class="pgF new"><span class="mono">${esc(n.name)} · ${esc(n.rx)}${n.duplex?" "+n.duplex+n.offset:""}${n.tone?" T "+esc(n.tone):""}</span><small>New · not in your list${n.source?" · from "+esc(n.source):""}</small></div>`:""}return ""};
    body=`<h2>${esc(r.name||"PACE plan")}</h2>${r.summary?`<p class="hint">${esc(r.summary)}</p>`:""}
     <div class="pace">${PSTEP.map(([k,l])=>{const s=r.steps[k]||{};return `<div class="pstep"><span class="pl ${k}">${l[0]}</span><div><b>${esc(l)}: ${esc(s.method)}</b>${fref(s)}${s.detail?`<div>${esc(s.detail)}</div>`:""}${s.when?`<small>${esc(s.when)}</small>`:""}</div></div>`}).join("")}
      ${r.checkin?`<div class="pmeta"><b>Check-ins:</b> ${esc(r.checkin)}</div>`:""}${r.rally?`<div class="pmeta"><b>Rally point:</b> ${esc(r.rally)}</div>`:""}${r.codes?`<div class="pmeta"><b>Code words:</b> ${esc(r.codes)}</div>`:""}</div>
     ${r.newFreqs.length?`<div class="secBlock"><h3>Local frequencies it found</h3><p class="hint">Tick the ones to add to your list (group "${esc(pgGroup())}"). Double-check them on RepeaterBook before you program them.</p>${r.newFreqs.map((n,k)=>`<label class="keep pgN"><input type="checkbox" data-nf="${k}" checked> <span><b>${esc(n.name)}</b> <span class="mono">${esc(n.rx)}${n.duplex?" "+n.duplex+n.offset:""}${n.tone?" T "+esc(n.tone):""}</span><br><small>${esc([n.service,n.notes,n.source&&"source: "+n.source].filter(Boolean).join(" · "))}</small></span></label>`).join("")}</div>`:""}
     ${r.gaps.length?`<div class="secBlock"><h3>Gaps to fix</h3><ul class="pgGaps">${r.gaps.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}
     <div class="actions"><button class="btn ghost" type="button" data-act="pgback">Change inputs</button><span class="spacer"></span><button class="btn ghost" type="button" data-act="pgedit">Edit first</button><button class="btn" type="button" data-act="pgsave">Save plan</button></div>`;
  }
  return `<div class="sheetWrap"><div class="sheetBg" data-act="pgclose"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Build a PACE plan"><div class="sheetTop"><span class="grab"></span><button class="xBtn" type="button" data-act="pgclose" aria-label="Close">✕</button></div><form class="panel" id="pgForm">${body}</form></div></div>`}
var pgGroup=()=>paceGen?.in?.location?("Local — "+paceGen.in.location).slice(0,40):"Local";
{const _r=RENDER.comms;RENDER.comms=()=>{_r();const v=$("commsView");
  if(commsTab==="pace"){const h=v.querySelector(".vhead");h?.insertAdjacentHTML("afterend",`<div class="cBar"><button class="btn" type="button" data-act="pgopen">Build a plan for me</button><span class="hint">from your area, situation and saved frequencies</span></div>`)}
  if(paceGen)v.insertAdjacentHTML("beforeend",pgSheet());
}}
{const _c=collect;collect=function(view){if(view==="comms"&&paceGen&&paceGen.stage!=="result")pgCollect();return _c(view)}}
async function pgSaveNew(){const r=paceGen.res;const keep=new Set([...document.querySelectorAll("#pgForm [data-nf]:checked")].map(x=>+x.dataset.nf));const map={};
  const have=L("freqs");for(const [k,n] of r.newFreqs.entries()){if(!keep.has(k))continue;const dup=have.find(f=>mhz(f.rx)===mhz(n.rx)&&(f.duplex||"")===(n.duplex||""));if(dup){map[k]=dup.id;continue}
    const svc=SERVICES.includes(n.service)?n.service:guessService(fnum(n.rx));
    const rec=await upsertC("freqs",{name:n.name,short:n.name.replace(/[^\w ]/g,"").slice(0,7).toUpperCase(),rx:mhz(n.rx),duplex:TX_OK(svc)?n.duplex:"off",offset:n.duplex?mhz(n.offset)||"0.600":"",toneMode:n.tone?"Tone":"",txTone:n.tone||"",mode:n.mode||"FM",power:"High",service:svc,group:pgGroup(),notes:[n.notes,n.source&&"src: "+n.source].filter(Boolean).join(" · ")});map[k]=rec.id}
  return map}
function pgPlanRec(map){const r=paceGen.res,fs=paceGen.sent;const rec={name:r.name||"PACE plan",who:paceGen.in.people||"",checkin:r.checkin,rally:r.rally,codes:r.codes,notes:[r.summary,paceGen.in.location&&"Area: "+paceGen.in.location].filter(Boolean).join(" · ")};
  PSTEP.forEach(([k])=>{const s=r.steps[k]||{};rec[k]={method:METHODS.includes(s.method)?s.method:(s.method||""),detail:s.detail||"",when:s.when||"",freq:s.f!=null?fs[s.f]?.id||"":s.n!=null?map[s.n]||"":""}});return rec}
{const _a=ACT.comms;ACT.comms=async(act,b,e)=>{
  if(act==="pgopen"){paceGen={stage:"form",in:pgDefaults()};renderExtra();return}
  if(act==="pgclose"){paceGen=null;renderExtra();return}
  if(act==="pgback"){paceGen.stage="form";renderExtra();return}
  if(act==="pggeo"){pgCollect();if(!navigator.geolocation){toast("Location isn't available here");return}b.disabled=true;b.textContent="Finding…";
    navigator.geolocation.getCurrentPosition(p=>{paceGen.in.location=`${p.coords.latitude.toFixed(2)}, ${p.coords.longitude.toFixed(2)}`;renderExtra()},()=>{toast("Couldn't get your location");renderExtra()},{timeout:10000,maximumAge:6e5});return}
  if(act==="pgrun"){pgCollect();if(!window.LOOKUP_URL||!cloudUser){paceGen.err="Sign in to build plans.";renderExtra();return}
    paceGen.err="";paceGen.stage="busy";renderExtra();const v=paceGen.in;await setComms({paceGen:{location:v.location,scenario:v.scenario,distance:v.distance,terrain:v.terrain,cell:v.cell,grid:v.grid,licensed:v.licensed,devices:v.devices}});
    const sent=freqsSorted().slice(0,150);
    try{const j=await apiPost("/pace",{...v,freqs:sent.map(f=>({name:f.name,rx:mhz(f.rx),duplex:f.duplex||"",offset:f.offset||"",tx:f.tx||"",tone:toneTxt(f),mode:f.mode||"FM",service:f.service||"",group:f.group||"",notes:f.notes||"",onRadio:onRadio(f)}))});
      if(!paceGen)return;paceGen.res=j.result;paceGen.sent=sent.map(f=>({id:f.id}));paceGen.stage="result"}
    catch(err){if(!paceGen)return;paceGen.stage="form";paceGen.err="Couldn't build it: "+err.message}renderExtra();return}
  if(act==="pgsave"){const map=await pgSaveNew();const rec=pgPlanRec(map);await upsertC("pace",rec);const n=Object.keys(map).length;paceGen=null;commsTab="pace";toast(`PACE plan saved${n?` · ${n} new frequenc${n>1?"ies":"y"} added`:""}`,4000);render();return}
  if(act==="pgedit"){const map=await pgSaveNew();paceEd=pgPlanRec(map);paceGen=null;commsTab="pace";render();return}
  return _a(act,b,e)}}
// saved plans: warn when a linked frequency isn't programmed on any radio
{const _pc=paceCard;paceCard=function(p,print){let h=_pc(p,print);if(print||!radios().length)return h;
  const miss=PSTEP.map(([k])=>p[k]?.freq).filter(Boolean).map(id=>L("freqs").find(f=>f.id===id)).filter(f=>f&&!onRadio(f));
  if(miss.length)h=h.replace(/<\/article>$/,`<div class="pmeta warnTxt">⚠ Not on any radio yet: ${miss.map(f=>esc(f.name)).join(", ")}. <button class="btn ghost" type="button" data-act="ponradio" data-ids="${miss.map(f=>f.id).join(",")}" style="margin-top:6px">Put on ${radios().length>1?"all my radios":esc(radios()[0].name)}</button></div></article>`);return h}}
{const _a=ACT.comms;ACT.comms=async(act,b,e)=>{if(act==="ponradio"){const rs=radios();for(const id of b.dataset.ids.split(",")){const f=db.freqs.find(x=>x.id===id&&!x.deleted);if(!f)continue;const r={...(f.radios||{})};rs.forEach(x=>r[x.id]=true);f.radios=r;f.updatedAt=now()}await persist();toast("Added. Export for CHIRP on Radios & export.",4000);renderExtra();return}return _a(act,b,e)}}

boot();
