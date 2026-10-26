/* ---------- AMMO ---------- */
function ammoSummary(){
  const m={};
  L("ammo").forEach(a=>{const k=(a.caliber||"Unknown").trim();const s=m[k]||(m[k]={cal:k,rounds:0,cost:0,costed:0,alert:0});s.rounds+=+a.rounds||0;if(+a.cpr){s.cost+=(+a.cpr)*(+a.rounds||0);s.costed+=+a.rounds||0}s.alert=Math.max(s.alert,+a.lowAlert||0)});
  return Object.values(m).map(s=>({...s,avg:s.costed?s.cost/s.costed:0,low:s.alert>0&&s.rounds<s.alert})).sort((a,b)=>a.cal.localeCompare(b.cal));
}
var ammoLabel=a=>`${a.caliber||"?"} · ${[a.brand,a.load].filter(Boolean).join(" ")} (${(+a.rounds||0).toLocaleString()} on hand)`;
NEWREC.ammo=()=>({lowAlert:200});
RENDER.ammo=()=>{
  const ed=ED.ammo,sum=ammoSummary();
  const recs=L("ammo").sort((a,b)=>(a.caliber||"").localeCompare(b.caliber||"")||(a.brand||"").localeCompare(b.brand||""));
  const total=sum.reduce((a,s)=>a+s.rounds,0),val=L("ammo").reduce((a,x)=>a+(+x.cpr||0)*(+x.rounds||0),0);
  const d=ed?.draft||{};
  $("ammoView").innerHTML=`<div class="vhead"><div><h2>Ammo</h2><p>Rounds on hand by caliber. When you log a range session, the rounds you fire come off these counts.</p></div><button class="btn" type="button" data-act="new">+ Add ammo</button></div>
  ${ed?edForm("ammo",ed.isNew?"Add ammo":"Edit ammo",
    fld("caliber","Caliber",d.caliber,{list:"calibers",req:1,ph:"9mm"})+fld("brand","Brand",d.brand,{ph:"Federal"})+fld("load","Load",d.load,{ph:"124gr FMJ"})+fld("rounds","Rounds on hand",d.rounds,{type:"number",step:1})+
    fld("cpr","Cost per round ($)",d.cpr,{type:"number",step:"0.01",ph:"0.28"})+fld("lowAlert","Warn when caliber drops below",d.lowAlert,{type:"number",step:1})+fld("location","Stored at",d.location,{list:"locations",span:2})+fld("lot","Lot # / notes",d.lot,{span:4})):""}
  <section class="stats"><div class="stat"><b>${total.toLocaleString()}</b><span>Rounds on hand</span></div><div class="stat"><b>${sum.length}</b><span>Calibers</span></div><div class="stat"><b>${money(val)}</b><span>Ammo value</span></div><div class="stat"><b>${sum.filter(s=>s.low).length}</b><span>Running low</span></div></section>
  ${recs.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Caliber</th><th class="n">Rounds</th><th class="n">Avg $/rd</th><th class="n">Warn below</th><th>Status</th></tr></thead><tbody>${sum.map(s=>`<tr><td><b>${esc(s.cal)}</b></td><td class="n">${s.rounds.toLocaleString()}</td><td class="n">${s.avg?"$"+s.avg.toFixed(2):"—"}</td><td class="n">${s.alert||"—"}</td><td>${s.low?`<span class="pill gap">Low</span>`:`<span class="pill ok">OK</span>`}</td></tr>`).join("")}</tbody></table></div>
  <div class="slotsHead">Boxes &amp; lots <span>click to edit</span></div>
  <div class="scroll"><table class="tbl"><thead><tr><th>Caliber</th><th>Brand</th><th>Load</th><th class="n">Rounds</th><th class="n">$/rd</th><th>Stored</th></tr></thead><tbody>${recs.map(a=>`<tr class="click" data-act="edit" data-id="${esc(a.id)}"><td>${esc(a.caliber)}</td><td>${esc(a.brand)}</td><td>${esc(a.load)}</td><td class="n">${(+a.rounds||0).toLocaleString()}</td><td class="n">${+a.cpr?"$"+(+a.cpr).toFixed(2):"—"}</td><td>${esc(a.location||"—")}</td></tr>`).join("")}</tbody></table></div>`
  :`<div class="empty"><b>No ammo logged</b>Add each caliber and load you keep, like "9mm · Federal · 124gr FMJ · 1,000 rds".</div>`}`;
};
SAVE.ammo=async d=>{if(!String(d.caliber||"").trim()){toast("Enter a caliber");return}await upsertC("ammo",d);ED.ammo=null;toast("Ammo saved");render()};
DEL.ammo=async d=>{await removeC("ammo",d.id)};

/* ---------- RANGE LOG ---------- */
var curDrill="";
NEWREC.range=()=>({date:today(),lines:[{}],drills:[{}]});
/* Published standards. Times are seconds; lower is better. metric "total" = beep to last shot, "first" = beep to first shot. */
var DRILLS=[
 {name:"Bill Drill",setup:"7 yd · 6 rds · holster to 6 shots on the A-zone (8\" circle)",metric:"total",tiers:[["Novice",5.0],["Intermediate",3.0],["Advanced",2.0],["Master",1.5]],tip:"Advanced ≈ sub-1.0s draw with ~0.20s splits.",src:"RifleConfigurator drill standards"},
 {name:"Draw to first shot",setup:"7 yd · 1 rd · from concealment to a body hit",metric:"total",tiers:[["Beginner",3.0],["Intermediate",2.0],["Advanced",1.4],["Master",1.0]],tip:"Same as ASP 10-Round Skill Check, stage 1.",src:"ASP 10-Round Skill Check"},
 {name:"FAST",setup:"7 yd · 6 rds · 2 head (3×5 card), slidelock reload, 4 body (8\" plate) · from concealment",metric:"total",tiers:[["Novice",10.0],["Intermediate",9.99],["Advanced",6.99],["Expert",4.99]],tip:"Under 10 = Intermediate, under 7 = Advanced, under 5 = Expert. +0.5s for open-top retention holster.",src:"Todd Green / pistol-training.com"},
 {name:"El Presidente",setup:"10 yd · 12 rds · 3 targets 1 m apart · start facing away, holstered · 2 each, reload, 2 each",metric:"total",tiers:[["Standard",10.0]],tip:"10.00s clean is the classic reference.",src:"Jeff Cooper standard"},
 {name:"Failure to Stop",setup:"7 yd · 3 rds · 2 body + 1 head · from the holster (Mozambique)",metric:"total",tiers:[["Dark",2.9],["Light",2.25],["Turbo",1.7]],tip:"Gabe White Technical Skills Test pins.",src:"Gabe White standards"},
 {name:"Keepers' Test",setup:"7 yd · 3 rds · 3×5 card horizontal · from concealment",metric:"total",tiers:[["Pretty salty",3.0],["Really good",2.5]],tip:"",src:"Spencer Keepers"},
 {name:"5x5 Skill Test",setup:"5 yd · 5 rds · 5\" circle · from ready",metric:"total",tiers:[["Pass",5.0]],tip:"All 5 inside the circle within 5.00s.",src:"Standard 5^5 drill"},
 {name:"The Test",setup:"10 yd · 10 rds · B-8 repair center · from ready",metric:"total",tiers:[["Pass",10.0]],tip:"Score: 80% pass, 90% good, 95% excellent (Hackathorn).",src:"Larry Vickers / Ken Hackathorn"},
 {name:"Bill Drill 2",setup:"7 yd · 15 rds · strings of 1,2,3,4,5 from the holster",metric:"total",tiers:[["Goal",10.0]],tip:"10.00s total across all five strings.",src:"Published drill library"},
 {name:"Dot Torture",setup:"Starts at 3 yd · 50 rds · ten 2\" dots · untimed",metric:"none",tiers:[],tip:"Score is the farthest distance you shoot 50/50 clean. Log it in Hits/pts.",src:"David Blinder"},
];
function tierFor(d,t){if(!t||!isFinite(t)||d.metric==="none")return null;let got=null;d.tiers.forEach(x=>{if(t<=x[1]+1e-9)got=x[0]});return got}
function drillLibrary(ds){
  return `<div class="slotsHead">Drill library <span>published standards to compare against</span></div><div class="drills">${DRILLS.map((d,k)=>{
    const me=ds.find(x=>x.name.toLowerCase()===d.name.toLowerCase());const best=me&&isFinite(me.best)?me.best:null;const lvl=tierFor(d,best);
    return `<article class="drill"><h4>${esc(d.name)}</h4><div class="setup">${esc(d.setup)}</div>
      ${d.tiers.length?`<div class="tiers">${d.tiers.map(t=>`<span class="${lvl===t[0]?"hit":""}">${esc(t[0])} ≤ ${t[1].toFixed(2)}s</span>`).join("")}</div>`:""}
      ${d.tip?`<div class="setup">${esc(d.tip)}</div>`:""}
      <div class="you">${best!=null?`Your best: <b>${best.toFixed(2)}s</b>${lvl?` · <b>${esc(lvl)}</b>`:" · keep working"}${me&&isFinite(me.bestFirst)?` · draw ${me.bestFirst.toFixed(2)}s`:""}${me&&isFinite(me.bestSplit)?` · split ${me.bestSplit.toFixed(2)}s`:""}`:"Not logged yet"}</div>
      <button class="btn ghost" type="button" data-act="logdrill" data-i="${k}">Log this drill</button><div class="src">Source: ${esc(d.src)}</div></article>`}).join("")}</div>`;
}
function drillStats(){
  const m={};
  L("sessions").forEach(s=>(s.drills||[]).forEach(x=>{const n=(x.name||"").trim();if(!n)return;const k=n.toLowerCase();const r=m[k]||(m[k]={name:n,runs:0,best:Infinity,bestFirst:Infinity,bestSplit:Infinity,last:""});r.runs++;
    if(+x.total)r.best=Math.min(r.best,+x.total);if(+x.first)r.bestFirst=Math.min(r.bestFirst,+x.first);parseSplits(x.splits).forEach(sp=>r.bestSplit=Math.min(r.bestSplit,sp));if((s.date||"")>r.last)r.last=s.date}));
  return Object.values(m).sort((a,b)=>b.runs-a.runs||a.name.localeCompare(b.name));
}
function drillChart(name){
  const pts=[];
  L("sessions").slice().sort((a,b)=>(a.date||"").localeCompare(b.date||"")).forEach(s=>{const ds=(s.drills||[]).filter(x=>(x.name||"").trim().toLowerCase()===name.toLowerCase());if(!ds.length)return;
    const tot=Math.min(...ds.map(x=>+x.total||Infinity)),fs=Math.min(...ds.map(x=>+x.first||Infinity));pts.push({date:s.date,tot:isFinite(tot)?tot:null,fs:isFinite(fs)?fs:null})});
  if(!pts.length)return `<p class="hint">No times logged for this drill yet.</p>`;
  const W=640,H=230,pl=48,pr=16,pt=12,pb=36;const max=Math.max(...pts.flatMap(p=>[p.tot||0,p.fs||0]))*1.15||1;
  const x=i=>pts.length===1?pl+(W-pl-pr)/2:pl+i*(W-pl-pr)/(pts.length-1);const y=v=>pt+(H-pt-pb)*(1-v/max);
  const grid=[0,1,2,3].map(k=>{const v=max*k/3;return `<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${v.toFixed(1)}s</text>`}).join("");
  const step=Math.max(1,Math.ceil(pts.length/6));
  const xl=pts.map((p,i)=>i%step===0||i===pts.length-1?`<text x="${x(i)}" y="${H-12}" text-anchor="${pts.length>1&&i===0?"start":pts.length>1&&i===pts.length-1?"end":"middle"}">${esc(fmtDate(p.date))}</text>`:"").join("");
  const path=(k,cls)=>{const seg=pts.map((p,i)=>p[k]!=null?[x(i),y(p[k])]:null).filter(Boolean);if(!seg.length)return "";return (seg.length>1?`<path class="${cls}" d="M${seg.map(q=>q.join(" ")).join(" L")}"/>`:"")+seg.map(q=>`<circle class="${cls==="ln"?"pt":"pt2"}" cx="${q[0]}" cy="${q[1]}" r="${cls==="ln"?4:3}"/>`).join("")};
  const lib=DRILLS.find(d=>d.name.toLowerCase()===name.toLowerCase());
  const bench=lib&&lib.metric==="total"?lib.tiers.filter(t=>t[1]<=max).map(t=>`<line class="bench" x1="${pl}" x2="${W-pr}" y1="${y(t[1])}" y2="${y(t[1])}"/><text class="benchT" x="${W-pr-2}" y="${y(t[1])-3}" text-anchor="end">${esc(t[0])} ${t[1].toFixed(2)}s</text>`).join(""):"";
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} times over sessions">${grid}${bench}${xl}${path("fs","ln2")}${path("tot","ln")}</svg><div class="legend"><span><i></i>Best total time</span><span><i class="b"></i>Best first shot / draw</span><span>Lower is better</span></div>`;
}
RENDER.range=()=>{
  const ed=ED.range,d=ed?.draft||{};const sess=L("sessions").sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const ds=drillStats();if(!curDrill||!ds.some(x=>x.name.toLowerCase()===curDrill.toLowerCase()))curDrill=ds[0]?.name||"";
  const guns=firearms(),ammo=L("ammo");
  const typeOpts=[["","—"],...KITS.filter(k=>k.type==="train").map(k=>[k.name,k.name]),["Other","Other"]];
  const form=ed?edForm("range",ed.isNew?"Log a range session":"Edit session",
    fld("date","Date",d.date,{type:"date"})+fld("type","Training type",d.type,{type:"select",opts:typeOpts})+fld("location","Range / location",d.location,{span:2,ph:"Local range, bay 3"})+
    `<div class="lines"><h4>Rounds fired <button class="btn ghost" type="button" data-act="addline" data-k="lines">+ Add gun</button></h4>
      ${!guns.length?`<p class="hint">Add your guns in Inventory under the Firearms category to track round counts per gun.</p>`:""}
      ${(d.lines||[]).map((l,i)=>`<div class="line l3">${cell(`lines.${i}.firearmId`,"Firearm",l.firearmId,{type:"select",opts:[["","—"],...guns.map(g=>[g.id,g.name])]})}${cell(`lines.${i}.ammoId`,"Ammo used (subtracts from Ammo)",l.ammoId,{type:"select",opts:[["","— not tracked —"],...ammo.map(a=>[a.id,ammoLabel(a)])]})}${cell(`lines.${i}.rounds`,"Rounds",l.rounds,{type:"number",step:1})}${rmBtn("lines",i)}</div>`).join("")}</div>
    <div class="lines"><h4>Drills &amp; times <button class="btn ghost" type="button" data-act="addline" data-k="drills">+ Add drill</button></h4>
      <p class="hint">Splits: type them separated by commas, like 0.24, 0.22, 0.25. Leave Total blank and it's added up from first shot + splits.</p>
      ${(d.drills||[]).map((x,i)=>`<div class="line drill">${cell(`drills.${i}.name`,"Drill",x.name,{list:"drills",ph:"Bill Drill"})}${cell(`drills.${i}.dist`,"Yards",x.dist,{type:"number",step:1})}${cell(`drills.${i}.par`,"Par (s)",x.par,{type:"number",step:"0.01"})}${cell(`drills.${i}.first`,"Draw / 1st (s)",x.first,{type:"number",step:"0.01"})}${cell(`drills.${i}.splits`,"Splits (s)",x.splits,{ph:"0.24, 0.22, 0.25"})}${cell(`drills.${i}.total`,"Total (s)",x.total,{type:"number",step:"0.01"})}${cell(`drills.${i}.hits`,"Hits / pts",x.hits,{ph:"6/6 A"})}${rmBtn("drills",i)}</div>`).join("")}</div>`+
    fld("notes","Notes",d.notes,{span:4,ph:"What worked, what to fix next time"})):"";
  const totalRds=sess.reduce((a,s)=>a+(+s.rounds||0),0);
  const libHTML=drillLibrary(ds);
  $("rangeView").innerHTML=`<div class="vhead"><div><h2>Range Log</h2><p>Log each session's rounds, drills and split times to see your progress over time.</p></div><button class="btn" type="button" data-act="new">+ Log session</button></div>
  ${form}
  <section class="stats"><div class="stat"><b>${sess.length}</b><span>Sessions</span></div><div class="stat"><b>${totalRds.toLocaleString()}</b><span>Rounds logged</span></div><div class="stat"><b>${ds.length}</b><span>Drills tracked</span></div><div class="stat"><b>${sess[0]?esc(fmtDate(sess[0].date)):"—"}</b><span>Last session</span></div></section>
  ${ds.length?`<div class="chartWrap"><div class="vhead"><div><h2 style="font-size:1.2rem">Progress</h2></div><select id="drillPick" aria-label="Drill">${optList(ds.map(x=>[x.name,`${x.name} (${x.runs} run${x.runs>1?"s":""})`]),curDrill)}</select></div>${drillChart(curDrill)}</div>
  <div class="slotsHead">Personal bests</div>
  <div class="scroll"><table class="tbl"><thead><tr><th>Drill</th><th class="n">Runs</th><th class="n">Best total</th><th class="n">Best draw / 1st</th><th class="n">Best split</th><th>Last run</th></tr></thead><tbody>${ds.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td class="n">${x.runs}</td><td class="n">${isFinite(x.best)?x.best.toFixed(2)+"s":"—"}</td><td class="n">${isFinite(x.bestFirst)?x.bestFirst.toFixed(2)+"s":"—"}</td><td class="n">${isFinite(x.bestSplit)?x.bestSplit.toFixed(2)+"s":"—"}</td><td>${esc(fmtDate(x.last))}</td></tr>`).join("")}</tbody></table></div>`:""}
  ${libHTML}
  ${guns.length?`<div class="slotsHead">Round counts</div><div class="scroll"><table class="tbl"><thead><tr><th>Firearm</th><th>Caliber</th><th class="n">Rounds fired</th></tr></thead><tbody>${guns.map(g=>`<tr><td>${esc(g.name)}</td><td>${esc(g.caliber||"—")}</td><td class="n">${roundsFired(g.id).toLocaleString()}</td></tr>`).join("")}</tbody></table></div>`:""}
  ${sess.length?`<div class="slotsHead">Sessions <span>click to edit</span></div><div class="scroll"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Location</th><th class="n">Rounds</th><th>Drills</th></tr></thead><tbody>${sess.map(s=>`<tr class="click" data-act="edit" data-id="${esc(s.id)}"><td>${esc(fmtDate(s.date))}</td><td>${esc(s.type||"—")}</td><td>${esc(s.location||"—")}</td><td class="n">${(+s.rounds||0).toLocaleString()}</td><td>${esc((s.drills||[]).map(x=>x.name+(x.total?` ${(+x.total).toFixed(2)}s`:"")).join(", ")||"—")}</td></tr>`).join("")}</tbody></table></div>`
  :`<div class="empty"><b>No sessions yet</b>Click <em>+ Log session</em> after your next range trip. Add drills with your draw time and splits to start tracking progress.</div>`}`;
};
function applyAmmo(lines,sign){(lines||[]).forEach(l=>{if(!l.ammoId||!+l.rounds)return;const a=db.ammo.find(x=>x.id===l.ammoId&&!x.deleted);if(a){a.rounds=Math.max(0,(+a.rounds||0)-sign*(+l.rounds));a.updatedAt=now()}})}
SAVE.range=async d=>{
  if(!d.date){toast("Pick a date");return}
  d.lines=(d.lines||[]).filter(l=>l&&(l.firearmId||l.ammoId||+l.rounds));
  d.drills=(d.drills||[]).filter(x=>x&&(x.name||x.first||x.splits||x.total));
  d.drills.forEach(x=>{if(x.total===""||x.total==null){const t=(+x.first||0)+parseSplits(x.splits).reduce((a,b)=>a+b,0);x.total=t?+t.toFixed(2):""}});
  const old=d.id?L("sessions").find(s=>s.id===d.id):null;
  applyAmmo(old?.lines,-1);applyAmmo(d.lines,1);
  d.rounds=d.lines.reduce((a,l)=>a+(+l.rounds||0),0);
  if(d.drills[0]?.name)curDrill=d.drills[0].name;
  await upsertC("sessions",d);ED.range=null;toast("Session saved");render();
};
DEL.range=async d=>{const old=L("sessions").find(s=>s.id===d.id);applyAmmo(old?.lines,-1);await removeC("sessions",d.id)};
ACT.range=(act,t)=>{
  if(act==="change"&&t.id==="drillPick"){curDrill=t.value;renderExtra();return}
  if(act==="logdrill"){const d=DRILLS[+t.dataset.i];if(!d)return;const m=d.setup.match(/^(\d+) yd/);
    if(ED.range){collect("range");const ds=ED.range.draft.drills=ED.range.draft.drills||[];const empty=ds.findIndex(x=>!x.name);const row={name:d.name,dist:m?+m[1]:""};if(empty>=0)ds[empty]=row;else ds.push(row);renderExtra()}
    else openEd("range",{date:today(),lines:[{}],drills:[{name:d.name,dist:m?+m[1]:""}]});
    curDrill=d.name}
};

/* ---------- DOPE ---------- */
NEWREC.dope=()=>({units:"MIL",zero:100,rows:[100,200,300,400,500,600].map(dist=>({dist}))});
var rifleLabel=d=>itemById(d.rifleId)?.name||d.rifleName||"Rifle";
function dopeTable(d,cls="tbl dopeTbl"){const rows=(d.rows||[]).filter(r=>r.dist!==""&&r.dist!=null).sort((a,b)=>+a.dist-+b.dist);
  return `<table class="${cls}"><thead><tr><th>Yards</th><th>Elev (${esc(d.units||"MIL")})</th><th>Wind 10 mph</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.dist)}</td><td>${r.elev===""||r.elev==null?"—":esc(r.elev)}</td><td>${r.wind===""||r.wind==null?"—":esc(r.wind)}</td></tr>`).join("")}</tbody></table>`}
RENDER.dope=()=>{
  const ed=ED.dope,d=ed?.draft||{};const guns=firearms();
  const form=ed?edForm("dope",ed.isNew?"New DOPE card":"Edit DOPE card",
    fld("rifleId","Rifle",d.rifleId,{type:"select",opts:[["","— pick from Firearms —"],...guns.map(g=>[g.id,g.name])]})+fld("rifleName","Or type rifle name",d.rifleName,{ph:"RPR .308"})+fld("load","Load / ammo",d.load,{ph:"Federal GMM 175gr"})+fld("optic","Optic",d.optic,{ph:"Vortex PST 5-25"})+
    fld("units","Units",d.units,{type:"select",opts:[["MIL","MIL"],["MOA","MOA"]]})+fld("zero","Zero (yd)",d.zero,{type:"number",step:1})+fld("mv","Muzzle velocity (fps)",d.mv,{type:"number",step:1})+fld("bc","BC",d.bc,{ph:"G7 .243"})+
    fld("conditions","Conditions when confirmed",d.conditions,{span:2,ph:"72°F, 50 ft DA 1,200"})+fld("confirmed","Confirmed on",d.confirmed,{type:"date"})+fld("height","Sight height (in)",d.height,{type:"number",step:"0.01"})+
    `<div class="lines"><h4>Holds <span class="vbtns"><button class="btn ghost" type="button" data-act="fill">Fill 100–1000 yd</button><button class="btn ghost" type="button" data-act="addline" data-k="rows">+ Add distance</button></span></h4>
      ${(d.rows||[]).map((r,i)=>`<div class="line dope">${cell(`rows.${i}.dist`,"Yards",r.dist,{type:"number",step:1})}${cell(`rows.${i}.elev`,`Elevation (${d.units||"MIL"})`,r.elev,{type:"number",step:"0.1",neg:1})}${cell(`rows.${i}.wind`,"Wind hold, 10 mph full value",r.wind,{type:"number",step:"0.1",neg:1})}${rmBtn("rows",i)}</div>`).join("")}</div>`+
    fld("notes","Notes",d.notes,{span:4,ph:"Cold bore shift, spin drift, turret notes"})):"";
  const cards=L("dope").sort((a,b)=>rifleLabel(a).localeCompare(rifleLabel(b)));
  $("dopeView").innerHTML=`<div class="vhead"><div><h2>DOPE</h2><p>Your confirmed holds for each rifle and load. Print a card for your stock or turret cap.</p></div><button class="btn" type="button" data-act="new">+ New DOPE card</button></div>
  ${form}
  ${cards.length?`<div class="cards">${cards.map(c=>`<article class="card"><div><h3>${esc(rifleLabel(c))}</h3><div class="sub2">${esc([c.load,c.optic,`${c.zero||"?"} yd zero`,c.units,c.mv?c.mv+" fps":""].filter(Boolean).join(" · "))}</div>${c.confirmed?`<div class="sub2">Confirmed ${esc(fmtDate(c.confirmed))}${c.conditions?` · ${esc(c.conditions)}`:""}</div>`:""}</div>
    <div class="scroll">${dopeTable(c)}</div>${c.notes?`<p class="hint">${esc(c.notes)}</p>`:""}
    <div class="vbtns"><button class="btn ghost" type="button" data-act="edit" data-id="${esc(c.id)}">Edit</button><button class="btn ghost" type="button" data-act="print" data-id="${esc(c.id)}">Print card</button></div></article>`).join("")}</div>`
  :`<div class="empty"><b>No DOPE yet</b>Make a card per rifle and load. Enter your elevation and wind holds as you confirm them at distance.</div>`}`;
};
SAVE.dope=async d=>{if(!d.rifleId&&!String(d.rifleName||"").trim()){toast("Pick or name the rifle");return}d.rows=(d.rows||[]).filter(r=>r&&r.dist!==""&&r.dist!=null).sort((a,b)=>+a.dist-+b.dist);await upsertC("dope",d);ED.dope=null;toast("DOPE saved");render()};
DEL.dope=async d=>{await removeC("dope",d.id)};
ACT.dope=(act,b)=>{
  if(act==="fill"){collect("dope");const ed=ED.dope;const have=new Map((ed.draft.rows||[]).filter(r=>r.dist!==""&&r.dist!=null).map(r=>[+r.dist,r]));for(let y=100;y<=1000;y+=100)if(!have.has(y))have.set(y,{dist:y});ed.draft.rows=[...have.values()].sort((a,b)=>+a.dist-+b.dist);renderExtra();return}
  if(act==="print"){const c=L("dope").find(x=>x.id===b.dataset.id);if(!c)return;
    $("printSheet").innerHTML=`<div class="dopecard"><div class="ph"><div><h1>${esc(rifleLabel(c))}</h1><small>${esc([c.load,c.optic].filter(Boolean).join(" · "))}</small><br><small>${esc([`${c.zero||"?"} yd zero`,c.units,c.mv?c.mv+" fps":"",c.bc?"BC "+c.bc:"",c.height?`SH ${c.height}"`:""].filter(Boolean).join(" · "))}</small></div><small>${c.confirmed?esc(fmtDate(c.confirmed)):""}</small></div>${dopeTable(c,"")}${c.conditions?`<small>${esc(c.conditions)}</small>`:""}${c.notes?`<p><small>${esc(c.notes)}</small></p>`:""}</div>`;
    printingKit=true;window.print()}
};

/* ---------- MAINTENANCE ---------- */
var SUGG=[
 {t:i=>i.category==="Firearms",task:"Clean & lube",everyDays:90,everyRounds:500},
 {t:i=>i.category==="Firearms",task:"Detail strip & inspect",everyDays:365,everyRounds:2000},
 {t:i=>/nvg|pvs|nod|night vision|thermal|bnvd|ps31|1431|dtnvs/.test(itemText(i)),task:"Swap battery / function check",everyDays:60},
 {t:i=>i.category==="Lights & Lasers",task:"Replace battery",everyDays:180},
 {t:i=>/optic|scope|red dot|aimpoint|eotech|trijicon|holosun|lpvo|vortex|nightforce/.test(itemText(i))&&i.category!=="Firearms",task:"Check optic zero & screws",everyDays:180},
 {t:i=>/tourniquet| tq |cat gen|sof-t|sof t/.test(itemText(i)),task:"Inspect tourniquet",everyDays:180},
 {t:i=>/ifak|trauma|med kit|first aid|blowout/.test(itemText(i)),task:"Check med expirations",everyDays:180},
 {t:i=>i.category==="Comms & Radios"&&/radio|baofeng|yaesu|kenwood|icom|motorola|prc|uv-5r/.test(itemText(i)),task:"Charge & check battery",everyDays:30},
 {t:i=>/plates|level iii|level iv|sapi|armor insert/.test(itemText(i))&&!/carrier/.test(itemText(i))&&i.category==="Armor & Carriers",task:"Inspect plates for damage",everyDays:365},
 {t:i=>/helmet/.test(itemText(i)),task:"Check helmet pads & retention",everyDays:365},
];
var suggCache=[];
function maintRows(){
  const order={over:0,soon:1,ok:2};
  return L("maint").map(m=>{const it=itemById(m.itemId);const isGun=it?.category==="Firearms";const cur=isGun?roundsFired(it.id):0;let status="ok",parts=[],key=1e9;
    if(+m.everyDays){if(!m.lastDone){status="soon";parts.push("not logged yet");key=0}else{const left=daysBetween(today(),addDays(m.lastDone,+m.everyDays));key=Math.min(key,left);parts.push(left<0?`${-left} days overdue`:left===0?"due today":`due in ${left} days`);if(left<0)status="over";else if(left<=14&&status!=="over")status="soon"}}
    if(isGun&&+m.everyRounds){const left=+m.everyRounds-(cur-(+m.lastRounds||0));key=Math.min(key,left/10);parts.push(left<0?`${(-left).toLocaleString()} rds over`:`${left.toLocaleString()} rds to go`);if(left<0)status="over";else if(left<=+m.everyRounds*0.2&&status!=="over")status="soon"}
    return {m,it,status,txt:parts.join(" · ")||"no interval set",key,cur,isGun}}).sort((a,b)=>order[a.status]-order[b.status]||a.key-b.key);
}
NEWREC.maint=()=>({});
RENDER.maint=()=>{
  const ed=ED.maint,d=ed?.draft||{};const rows=maintRows();const items=live().slice().sort(byName);
  const have=new Set(L("maint").map(m=>m.itemId+"|"+(m.task||"").toLowerCase()));
  suggCache=[];live().forEach(i=>SUGG.forEach(s=>{if(s.t(i)&&!have.has(i.id+"|"+s.task.toLowerCase()))suggCache.push({i,s})}));
  const form=ed?edForm("maint",ed.isNew?"Add maintenance task":"Edit task",
    fld("itemId","Item",d.itemId,{type:"select",span:2,opts:[["","— pick an item —"],...items.map(i=>[i.id,`${i.name}${i.category==="Firearms"?" (firearm)":""}`])]})+fld("task","Task",d.task,{list:"maintTasks",span:2,ph:"Clean & lube"})+
    fld("everyDays","Every (days)",d.everyDays,{type:"number",step:1,ph:"90"})+fld("everyRounds","Every (rounds, guns only)",d.everyRounds,{type:"number",step:1,ph:"500"})+fld("lastDone","Last done",d.lastDone,{type:"date"})+fld("lastRounds","Round count when last done",d.lastRounds,{type:"number",step:1})+
    fld("notes","Notes",d.notes,{span:4,ph:"Parts used, what you found"})):"";
  const pill=s=>s==="over"?`<span class="pill gap">Overdue</span>`:s==="soon"?`<span class="pill warn">Due soon</span>`:`<span class="pill ok">OK</span>`;
  $("maintView").innerHTML=`<div class="vhead"><div><h2>Maintenance</h2><p>Reminders by date and, for guns, by rounds fired from your range log. Click Done when you finish a task.</p></div><button class="btn" type="button" data-act="new">+ Add task</button></div>
  ${form}
  <section class="stats"><div class="stat"><b>${rows.filter(r=>r.status==="over").length}</b><span>Overdue</span></div><div class="stat"><b>${rows.filter(r=>r.status==="soon").length}</b><span>Due soon</span></div><div class="stat"><b>${rows.length}</b><span>Tasks tracked</span></div><div class="stat"><b>${suggCache.length}</b><span>Suggested</span></div></section>
  ${rows.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Item</th><th>Task</th><th>Last done</th><th>Next</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr class="click" data-act="edit" data-id="${esc(r.m.id)}"><td>${esc(r.it?.name||"(deleted item)")}${r.isGun?`<small>${r.cur.toLocaleString()} rds</small>`:""}</td><td>${esc(r.m.task||"—")}</td><td>${esc(fmtDate(r.m.lastDone))}</td><td>${esc(r.txt)}</td><td>${pill(r.status)}</td><td><button class="btn ghost" type="button" data-act="done" data-id="${esc(r.m.id)}">Done</button></td></tr>`).join("")}</tbody></table></div>`
  :`<div class="empty"><b>No tasks yet</b>Add tasks from the suggestions below, or click <em>+ Add task</em>.</div>`}
  ${suggCache.length?`<div class="slotsHead">Suggested for your gear <span>${suggCache.length}</span></div><div class="scroll"><table class="tbl"><tbody>${suggCache.slice(0,12).map((x,k)=>`<tr><td>${esc(x.i.name)}</td><td>${esc(x.s.task)}</td><td>every ${x.s.everyDays} days${x.s.everyRounds?` or ${x.s.everyRounds} rds`:""}</td><td><button class="btn ghost" type="button" data-act="sugg" data-i="${k}">Add</button></td></tr>`).join("")}</tbody></table></div>${suggCache.length>1?`<div><button class="btn ghost" type="button" data-act="suggall">Add all ${suggCache.length} suggestions</button></div>`:""}`:""}`;
};
SAVE.maint=async d=>{if(!d.itemId){toast("Pick an item");return}if(!String(d.task||"").trim()){toast("Name the task");return}await upsertC("maint",d);ED.maint=null;toast("Task saved");render()};
DEL.maint=async d=>{await removeC("maint",d.id)};
ACT.maint=async(act,b)=>{
  if(act==="done"){const r=maintRows().find(x=>x.m.id===b.dataset.id);if(!r)return;const m={...r.m,lastDone:today(),lastRounds:r.isGun?r.cur:r.m.lastRounds,history:[...(r.m.history||[]),{date:today(),rounds:r.isGun?r.cur:null}]};await upsertC("maint",m);toast(`${m.task} logged`);render();return}
  const add=x=>({id:uid(),itemId:x.i.id,task:x.s.task,everyDays:x.s.everyDays,everyRounds:x.s.everyRounds||"",lastDone:"",lastRounds:x.i.category==="Firearms"?roundsFired(x.i.id):"",createdAt:now(),updatedAt:now()});
  if(act==="sugg"){const x=suggCache[+b.dataset.i];if(!x)return;db.maint.push(add(x));await persist();toast("Task added");render();return}
  if(act==="suggall"){suggCache.forEach(x=>db.maint.push(add(x)));await persist();toast("Tasks added");render()}
};

/* ---------- WISHLIST ---------- */
var PRI={High:0,Medium:1,Low:2};
NEWREC.wish=()=>({priority:"Medium",status:"want"});
RENDER.wish=()=>{
  const ed=ED.wish,d=ed?.draft||{};const want=L("wish").filter(w=>w.status!=="got").sort((a,b)=>(PRI[a.priority]??1)-(PRI[b.priority]??1)||byName(a,b));const got=L("wish").filter(w=>w.status==="got");
  const showEst=w=>+w.estPrice&&!(GearLogic.saleRestricted(w)&&w.priceSource==="market");
  const cost=want.reduce((a,w)=>a+(showEst(w)?+w.estPrice:0),0);
  const draftRestricted=GearLogic.saleRestricted(d);
  const form=ed?edForm("wish",ed.isNew?"Add to wishlist":"Edit wishlist item",
    fld("name","Item",d.name,{span:2,req:1,ph:"Ballistic glasses"})+fld("brand","Brand / model",d.brand,{ph:"Revision StingerHawk"})+fld("category","Category",d.category,{type:"select",opts:CATS.map(c=>[c,c])})+
    fld("estPrice",draftRestricted?"Insured value ($)":"Est. price ($)",draftRestricted&&d.priceSource==="market"?"":d.estPrice,{type:"number",step:1})+fld("priority","Priority",d.priority,{type:"select",opts:[["High","High"],["Medium","Medium"],["Low","Low"]]})+(draftRestricted?"":fld("link","Link",d.link,{type:"url",span:2,ph:"https://"}))+
    fld("notes","Notes",d.notes,{span:4})+(!draftRestricted&&d.priceSource==="market"?`<p class="hint span4" style="grid-column:1/-1">Market check ${esc(d.priceDate||"")}: ${esc(d.priceNote||"")}</p>`:"")):"";
  $("wishView").innerHTML=`<div class="vhead"><div><h2>Wishlist</h2><p>Gear you want. <em>Add kit gaps</em> adds essentials you don't own anything for, from the kits you've packed. Market check prices ordinary gear. Firearms, suppressors, frames, and ammunition are not priced or linked.</p></div><div class="vbtns"><button class="btn ghost" type="button" data-act="gaps">Add kit gaps</button><button class="btn ghost" type="button" data-act="checkall">Market check all</button><button class="btn" type="button" data-act="new">+ Add item</button></div></div>
  ${form}
  <section class="stats"><div class="stat"><b>${want.length}</b><span>On the list</span></div><div class="stat"><b>${money(cost)}</b><span>Est. total</span></div><div class="stat"><b>${want.filter(w=>w.priority==="High").length}</b><span>High priority</span></div><div class="stat"><b>${got.length}</b><span>Bought</span></div></section>
  ${want.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Priority</th><th>Item</th><th>Needed for</th><th class="n">Est. price</th><th></th></tr></thead><tbody>${want.map(w=>{const restricted=GearLogic.saleRestricted(w);return `<tr class="click" data-act="edit" data-id="${esc(w.id)}"><td><span class="pill ${w.priority==="High"?"gap":w.priority==="Medium"?"warn":""}">${esc(w.priority||"Medium")}</span></td><td><b>${esc(w.name)}</b><small>${esc([w.brand,w.category].filter(Boolean).join(" · "))}${!restricted&&w.link&&/^https?:\/\//.test(w.link)?` · <a href="${esc(w.link)}" target="_blank" rel="noopener">link</a>`:""}</small></td><td>${esc((w.kitsNeeding||[]).join(", ")||"—")}</td><td class="n">${showEst(w)?money(w.estPrice):"—"}${restricted?"":(w.marketCheck==="requested"&&!window.LOOKUP_URL)?`<span class="tag" style="display:block">check queued</span>`:w.priceSource==="market"?`<span class="tag" style="display:block">market</span>`:""}</td><td><span class="vbtns">${!restricted&&(window.LOOKUP_URL||w.marketCheck!=="requested")?`<button class="btn ghost" type="button" data-act="check" data-id="${esc(w.id)}">Price check</button>`:""}<button class="btn" type="button" data-act="got" data-id="${esc(w.id)}">Got it</button></span></td></tr>`}).join("")}</tbody></table></div>`
  :`<div class="empty"><b>Wishlist is empty</b>Click <em>Add kit gaps</em> to fill it from what your kits are missing, or add items yourself.</div>`}
  ${got.length?`<div class="slotsHead">Bought <span>${got.length}</span></div><p class="hint">${got.map(w=>esc(w.name)).join(" · ")}</p>`:""}`;
};
SAVE.wish=async d=>{if(!String(d.name||"").trim()){toast("Name the item");return}await upsertC("wish",d);ED.wish=null;toast("Saved");render()};
DEL.wish=async d=>{await removeC("wish",d.id)};
ACT.wish=async(act,b)=>{
  if(act==="gaps"){
    const gaps={};KITS.forEach(k=>{const {a}=coverage(k);k.req.forEach(s=>{if(!a[s])(gaps[s]=gaps[s]||[]).push(k.name)})});
    let n=0,u=0;
    for(const [s,ks] of Object.entries(gaps)){const ex=db.wish.find(w=>!w.deleted&&w.gapSlot===s&&w.status!=="got");
      if(ex){ex.kitsNeeding=ks;ex.updatedAt=now();u++;continue}
      db.wish.push({id:uid(),name:S[s][0],category:S[s][1][0],gapSlot:s,kitsNeeding:ks,priority:ks.length>=4?"High":ks.length>=2?"Medium":"Low",status:"want",notes:S[s][3],createdAt:now(),updatedAt:now()});n++}
    await persist();toast(n?`Added ${n} kit gap${n>1?"s":""}`:"No new gaps to add");render();return}
  if(act==="check"||act==="checkall"){const list=(act==="check"?db.wish.filter(w=>w.id===b.dataset.id):db.wish.filter(w=>!w.deleted&&w.status!=="got"&&w.marketCheck!=="requested")).filter(w=>!GearLogic.saleRestricted(w));list.forEach(w=>{w.marketCheck="requested";w.marketCheckAt=now();w.updatedAt=now()});await persist();toast(list.length?`Queued ${list.length} for a price check`:"Nothing to queue");render();return}
  if(act==="got"){const w=db.wish.find(x=>x.id===b.dataset.id);if(!w)return;
    const restricted=GearLogic.saleRestricted(w);const est=restricted&&w.priceSource==="market"?0:+w.estPrice||0;
    const item={id:uid(),name:w.brand?`${w.name}`:w.name,brand:w.brand||"",category:w.category||"Misc",qty:1,condition:"New",retailNew:restricted?0:est,value:restricted?est:Math.round(est*0.9),weight:null,weightStatus:"pending",notes:w.notes&&!w.gapSlot?w.notes:"",createdAt:now(),updatedAt:now()};
    all.push(item);w.status="got";w.gotAt=now();w.updatedAt=now();await persist();showTab("inv");openForm(all.find(i=>i.id===item.id));toast("Added to inventory. Fill in the details.");return}
};

/* ---------- LOANS ---------- */
NEWREC.loans=()=>({out:today()});
RENDER.loans=()=>{
  const ed=ED.loans,d=ed?.draft||{};const out=L("loans").filter(x=>!x.returned).sort((a,b)=>(a.due||"9").localeCompare(b.due||"9"));const back=L("loans").filter(x=>x.returned).sort((a,b)=>(b.returned||"").localeCompare(a.returned||""));
  const avail=live().filter(i=>!onLoan(i.id)||i.id===d.itemId).sort(byName);
  const itemBlank=(!d.itemId&&d.itemName)?d.itemName:"— pick an item —";
  const form=ed?edForm("loans",ed.isNew?"Lend an item":"Edit loan",
    fld("itemId","Item",d.itemId,{type:"select",span:2,opts:[[ "",itemBlank ],...avail.map(i=>[i.id,i.name])]})+fld("borrower","Borrowed by",d.borrower,{req:1,ph:"Name"})+fld("contact","Contact",d.contact,{ph:"Phone or email"})+
    fld("out","Lent on",d.out,{type:"date"})+fld("due","Due back",d.due,{type:"date"})+fld("returned","Returned on",d.returned,{type:"date"})+fld("cond","Condition when lent",d.cond,{ph:"Good, no marks"})+fld("notes","Notes",d.notes,{span:4})):"";
  const nm=x=>esc(itemById(x.itemId)?.name||x.itemName||"(deleted item)");
  $("loansView").innerHTML=`<div class="vhead"><div><h2>Loans</h2><p>Who has your gear and when it's due back. Add a friend's Gear Locker email and the loan shows up in their app too.</p></div><button class="btn" type="button" data-act="new">+ Lend item</button></div>
  ${form}
  ${out.length?`<div class="slotsHead">Out now <span>${out.length}</span></div><div class="scroll"><table class="tbl"><thead><tr><th>Item</th><th>Borrowed by</th><th>Lent</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${out.map(x=>{const over=x.due&&x.due<today();return `<tr class="click" data-act="edit" data-id="${esc(x.id)}"><td><b>${nm(x)}</b></td><td>${esc(x.borrower)}${x.contact?`<small>${esc(x.contact)}</small>`:""}</td><td>${esc(fmtDate(x.out))}</td><td>${esc(fmtDate(x.due))}</td><td>${over?`<span class="pill gap">Overdue</span>`:`<span class="pill warn">Out</span>`}</td><td><button class="btn ghost" type="button" data-act="returned" data-id="${esc(x.id)}">Returned</button></td></tr>`}).join("")}</tbody></table></div>`
  :`<div class="empty"><b>Nothing on loan</b>When you lend something out, click <em>+ Lend item</em> so you know who has it.</div>`}
  ${back.length?`<div class="slotsHead">Returned <span>${back.length}</span></div><div class="scroll"><table class="tbl"><tbody>${back.slice(0,25).map(x=>`<tr class="click" data-act="edit" data-id="${esc(x.id)}"><td>${nm(x)}</td><td>${esc(x.borrower)}</td><td>${esc(fmtDate(x.out))} → ${esc(fmtDate(x.returned))}</td></tr>`).join("")}</tbody></table></div>`:""}`;
};
SAVE.loans=async d=>{
  if(GearLogic.loanNeedsItem(d)){toast("Pick an item");return}
  if(!String(d.borrower||"").trim()){toast("Who borrowed it?");return}
  if(d.itemId){const it=itemById(d.itemId);if(it){d.itemName=it.name||"";d.itemBrand=it.brand||"";d.itemColor=it.color||"";d.itemCategory=it.category||""}}
  await upsertC("loans",d);ED.loans=null;toast("Loan saved");render()};
DEL.loans=async d=>{await removeC("loans",d.id)};
ACT.loans=async(act,b)=>{if(act==="returned"){const x=L("loans").find(y=>y.id===b.dataset.id);if(!x)return;await upsertC("loans",{...x,returned:today()});toast("Marked returned");render()}};

/* ---------- tabs ---------- */
var TABS=[["inv","Inventory"],["arms","Arms Room"],["kits","Kits"],["range","Range Log"],["dope","DOPE"],["ammo","Ammo"],["comms","Comms"],["maint","Maintenance"],["wish","Wishlist"],["loans","Loans"]];
var viewId=k=>k==="kits"?"kitView":k+"View";
var curTab="inv";
function badgeFor(k){
  if(k==="maint")return maintRows().filter(r=>r.status==="over").length;
  if(k==="ammo")return ammoSummary().filter(s=>s.low).length;
  if(k==="loans")return L("loans").filter(x=>!x.returned&&x.due&&x.due<today()).length;
  return 0;
}
function scrollTabIntoView(k){try{if(!window.matchMedia||!matchMedia("(max-width:700px)").matches)return;var b=document.querySelector('#tabs [data-tab="'+k+'"]');if(b&&b.scrollIntoView)b.scrollIntoView({inline:"nearest",block:"nearest"})}catch(e){}}
function updateBadges(){var el=$("tabs");if(!el)return;var x=el.scrollLeft;el.innerHTML=TABS.map(([k,l])=>{const n=badgeFor(k);return `<button class="tab" role="tab" type="button" data-tab="${k}" aria-selected="${k===curTab}">${l}${n?`<span class="badge" title="${n} need attention">${n}</span>`:""}</button>`}).join("");el.scrollLeft=x;scrollTabIntoView(curTab)}
$("tabs").onclick=e=>{const b=e.target.closest("[data-tab]");if(b)showTab(b.dataset.tab)};
function afterRender(){document.body.classList.toggle("nolookups",!lookupsOn());updateBadges();if(curTab==="arms")renderArms();else if(curTab==="kits")renderKits();else if(COLOF[curTab])renderExtra()}
function showTab(k){
  if(!TABS.some(t=>t[0]===k))k="inv";
  curTab=k;TABS.forEach(([t])=>{$(viewId(t)).hidden=t!==k});
  ["printBtn","csvBtn","addBtn"].forEach(id=>$(id).hidden=k!=="inv");
  updateBadges();if(k==="arms")renderArms();else if(k==="kits")renderKits();else if(COLOF[k])renderExtra();
  try{localStorage.setItem("gearLocker.tab",k)}catch{}
}
try{curKit=localStorage.getItem("gearLocker.curKit")||curKit;const qtab=new URLSearchParams(location.search).get("tab");const t=qtab||localStorage.getItem("gearLocker.tab");setTimeout(()=>showTab(t||"inv"))}catch{setTimeout(()=>showTab("inv"))}

