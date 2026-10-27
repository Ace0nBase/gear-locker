/* ================= v16: Kits rebuilt ================= */
/* ---- what is this item? (record first, then category, then name) ---- */
var RX={
  nvg:/\bpvs|bnvd|night ?vision|\bnods?\b|gpnvg|rpnvg|\b1431\b|ps-?31|\bmum-?14|dtnvs|\bnvg\b|\bpvs-?1[45]/,
  therm:/thermal|\brh ?25|infiray|pulsar|\bflir\b|clip-?on|thermion|axion|\bmh25|\bzh38|\bcl42|\bsaim/,
  optic:/red ?dot|\brd\b|aimpoint|\bt-?[12]\b|\bm68\b|\bcco\b|\bcomp ?m[45]|eotech|\bexps|\b55[28]\b|\bxps|\bhws\b|holo(graphic|sun)?|trijicon|\brmr|\brmsc|\bacog|vortex|razor|\blpvo|scope|\b1-[468]x?|1-10|magnifier|\bg[34]5\b|\bg33\b|leupold|delta ?point|\bdpp\b|romeo|tango ?\d|nightforce|\bmro\b|\b50[78]|\bacro\b|swampfox|primary arms|\bffp\b|\bsfp\b|\bprism\b/,
  pistolDot:/\brmr|\brmrcc|\brmsc|delta ?point|\bdpp\b|\b50[78]|\bacro\b|romeo ?(zero|1|2|x)|\bdeltapoint|\bhs ?50|\bscs\b|\b407k|\b507k|\bvenom|\bjpoint/,
  lpvo:/\b1-[468]|\b1-10|\blpvo|razor|tango ?[468]|\bvudu|\bnx8|\batacr|\bpst\b|scope/,
  mag:/magnifier|\bg[34]5\b|\bg33\b|\b[35]x\b(?!.*1-)/,
  mount:/shroud|wilcox|\bg24\b|l4g24|j-?arm|dovetail|nvg mount|nod mount|bridge|rhino|skull ?crusher|\bmount\b/,
  laser:/\bpeq|dbal|\bngal|laser|trinity|perst|\bmawl|ld-?ir|\ba2pl|\bir aim|\bcqbl|\bnoctis/,
  wlight:/surefire|modlite|cloud defensive|streamlight|weapon ?light|\bscout\b|\bm6[0-4]0|\bm3[0-4]0|\brein\b|\bowl\b|\bok1\b|\btlr|x300|x400|\bapl\b|\brm1\b|protac|\bm3ir|\bwml|\bhl-?x|\bplhv/,
  pistolLight:/x300|x400|\btlr-?[1-9]|\bapl\b|\bxc[12]\b|\bprotac rail|\bwml|\bplhv|\btlr ?[1-9]/,
  helmet:/helmet|ops-?core|high ?cut|\bbump\b|team wendy|\bfast\b|\bach\b|\bmich\b|\bsentry\b|\bxp\b.*helmet|crye airframe|airframe/,
  chest:/chest ?rig|split ?rig|\b34 ?a\b|34 ?alpha|\bd3cr|micro ?rig|\bmk ?[345]\b|\bhsp\b|spiritus|\brig\b|\bplacard\b/,
  plateCarrier:/plate ?carrier|\bjpc|\bavs\b|\bapc\b|\bspc\b|fcpc|lv-?119|slickster|\bcarrier\b|tegris|\blpc\b|\bpc\b/,
  plates:/\bplates?\b|level ?i|\blvl|\bsapi|esapi|armor insert|hesco|\binserts?\b/,
  magword:/magazine|\bmags?\b|pmag|lancer|gen ?m3|stanag|\b\d\d ?r(ou)?n?d|\bl5\b|\bets\b/,
  pistolword:/pistol|glock|\bg(17|19|26|43|48|45|34)\b|9mm|\bp320|\bp365|\b365\b|m&p|\.45|\b45\b|\.40|\b10mm|handgun|1911|\bp226|\bp229|\bcz\b|shield|hellcat/,
  pouch:/pouch|\bkywi|\btacos?\b|placard|shingle|holder|carrier|\bflap\b/,
  camo:/multicam|\bm81\b|woodland|\baor[12]?\b|kryptek|camo|marpat|\bocp\b|\bucp\b|tiger ?stripe|digital|atacs|pencott|realtree|mossy/,
};
var GENERIC_KINDS=["headset","radio","ifak","tq","headlamp","pack","water","sling","holster","knife","tool","gloves","boots","camo","rain","insul","coldhead","eyepro","drybag","pfd","bug","sun","nav","shelter","fire","filter","clean","rangebag","guncase","pistolcase","ammocan","timer","targets","loader","notebook","bipod","mat","toolkit","kneepads","simgear","trainer","snapcaps","traumabag","antenna","ptt","progcable","spot","batteries","belt"];
var itemNameText=i=>` ${[i.name,i.brand,i.armType].join(" ")} `.toLowerCase();
function gunType(i){const t=itemNameText(i)+" "+String(i.armType||"").toLowerCase();if(/shotgun|\b12 ?ga|\b20 ?ga/.test(t))return "long";if(/pistol|revolver|handgun/.test(t)||RX.pistolword.test(t)||/\b(43x|502|p365|security six|high ?power|pt ?92|92 ?af|pocket|\.22 pistol)\b/.test(t))return "pistol";return "long"}
var COMPACT=/\b(43x?|48|26|27|42|365|p365|hellcat|shield|pocket|lcp|p3at|\.380|380|nano|g43|g26|cc\b|subcompact|micro|502|naa)\b/;
function classify(i){
  if(i._kinds)return i._kinds;
  const out=new Set();const c=i.category||"";const nm=itemNameText(i);const nt=` ${i.notes||""} `.toLowerCase();const arm=armOf(i);
  const done=()=>{Object.defineProperty(i,"_kinds",{value:out,enumerable:false,configurable:true});return out};
  if(c==="Firearms"||arm==="FA"){out.add(gunType(i)==="pistol"?"gun_pistol":"gun_long");return done()}
  if(c==="Suppressors"||arm==="SU"){out.add("suppressor");return done()}
  if(arm==="LA"){if(RX.therm.test(nm)||RX.therm.test(nt))out.add("thermal");else if(RX.nvg.test(nm)||RX.nvg.test(nt))out.add("nvg");else out.add("laser");return done()}
  if(arm==="WL"){out.add("wlight");if(RX.pistolLight.test(nm))out.add("light_pistol");else out.add("light_rifle");return done()}
  if(arm==="OP"||(c==="NVG & Optics"&&RX.optic.test(nm)&&!RX.nvg.test(nm)&&!RX.therm.test(nm))){
    out.add("optic");const at=String(i.armType||"").toLowerCase();
    if(/magnif/.test(at)||RX.mag.test(nm))out.add("optic_mag");else if(/1-\d|lpvo|scope/.test(at)||RX.lpvo.test(nm))out.add("optic_lpvo");else if(RX.pistolDot.test(nm))out.add("optic_pistol");else out.add("optic_rd");
    return done()}
  if(arm==="KN"){out.add("knife");return done()}
  if(c==="NVG & Optics"||c==="Helmet & Head"){
    if(RX.therm.test(nm)||(RX.therm.test(nt)&&c==="NVG & Optics"))out.add("thermal");
    else if(RX.nvg.test(nm))out.add("nvg");
    else if(RX.mount.test(nm)&&!RX.optic.test(nm))out.add("mount");
  }
  if(c==="Lights & Lasers"){
    if(RX.laser.test(nm))out.add("laser");
    else if(RX.wlight.test(nm)&&!/headlamp|head lamp/.test(nm)){out.add("wlight");out.add(RX.pistolLight.test(nm)?"light_pistol":"light_rifle")}
  }
  if(c==="Helmet & Head"&&RX.helmet.test(nm)&&!/cover|mount|bag|shroud|pad/.test(nm))out.add("helmet");
  if(c==="Armor & Carriers"||c==="Belts & Rigs"){
    if(RX.chest.test(nm)&&!/belt\b/.test(nm))out.add("carrier_chest");
    else if(c==="Armor & Carriers"&&RX.plates.test(nm)&&!/carrier|rig|bag/.test(nm))out.add("plates");
    else if(c==="Armor & Carriers"&&RX.plateCarrier.test(nm))out.add("carrier_plate");
  }
  const magCat=c==="Mags & Ammo Storage";
  if((c==="Pouches"||magCat||c==="Belts & Rigs"||c==="Armor & Carriers")&&(RX.pouch.test(nm)&&(RX.magword.test(nm)||/kywi|taco|placard|shingle/.test(nm)))&&!/dump|admin|radio|med|ifak|utility|gp\b/.test(nm))
    out.add(RX.pistolword.test(nm)?"magpouch_pistol":"magpouch_rifle");
  else if(magCat&&RX.magword.test(nm)&&!/loader|coupler|holster|can\b|box\b/.test(nm))out.add(RX.pistolword.test(nm)?"mag_pistol":"mag_rifle");
  // everything else: the slot library, gated by category
  GENERIC_KINDS.forEach(k=>{const d=S[k];if(!d)return;const [,cats,kws,,ex]=d;if(!cats.includes(c))return;const t=nm+" "+(k==="ifak"||k==="traumabag"?nt:"");if(ex.some(x=>t.includes(x)))return;if(kws.some(x=>hasKw(t,x)))out.add(k)});
  if(out.has("traumabag"))out.delete("ifak");
  if(out.has("magpouch_rifle")||out.has("magpouch_pistol")){out.delete("ifak")}
  return done();
}
// clear the cache when items change
{const _r=render;render=function(){all.forEach(i=>{if(i&&i._kinds)delete i._kinds});return _r.apply(this,arguments)}}

/* ---- slots ---- */
S.thermal=S.thermal||["Thermal",["NVG & Optics"],["thermal"],"A thermal for detection.",[]];
S.primary=S.primary||["Primary weapon",["Firearms"],[],"The rifle or shotgun for this job.",[]];
S.sidearm=S.sidearm||["Sidearm",["Firearms"],[],"The pistol for this job.",[]];
var SLOT={
  primary:["Primary weapon",["gun_long"],"The rifle or shotgun for this job."],
  sidearm:["Sidearm",["gun_pistol"],"The pistol for this job."],
  carrier:["Plate carrier / chest rig",["carrier_plate","carrier_chest"],"Something to run mags and med up front."],
  plates:["Armor plates",["plates"],"Rifle-rated plates sized for your carrier."],
  belt:["Battle belt",["belt"],"A belt for holster, pistol mags and TQ."],
  riflemag:["Rifle mag pouches",["magpouch_rifle"],"Pouches for your rifle mags."],
  pistolmag:["Pistol mag pouches",["magpouch_pistol"],"One or two pistol mag pouches."],
  mags:["Magazines",["mag_rifle","mag_pistol"],"Loaded mags for the guns you're bringing."],
  nvg:["Night vision",["nvg"],"NODs for moving and shooting in the dark."],
  thermal:["Thermal",["thermal"],"A thermal for detection. Pairs well with NODs."],
  mount:["NVG mount",["mount"],"Helmet shroud and mount for your NODs."],
  laser:["IR laser / aiming device",["laser"],"An IR aimer for shooting under NODs."],
  wlight:["Weapon light",["wlight"],"White light on the gun."],
  helmet:["Helmet",["helmet"],"Ballistic or bump helmet."],
};
var slotDef=sid=>SLOT[sid]||(S[sid]?[S[sid][0],[sid],S[sid][3]]:[sid,[sid],""]);
var MULTI=new Set(["mags","tq","riflemag","pistolmag","batteries","targets","ammocan","water"]);
// kit lists: guns, thermal as its own slot, one magazine slot
var KIT_GUNS={jungle:["primary","sidearm"],desert:["primary","sidearm"],maritime:["primary","sidearm"],arctic:["primary","sidearm"],urban:["sidearm","primary"],woodland:["primary","sidearm"],mountain:["primary","sidearm"],night:["primary","sidearm"],range:["",""],pistol:["sidearm",""],carbine:["primary","sidearm"],lowlight:["primary","sidearm"],precision:["primary",""],fof:["",""],medtrain:["",""],comms:["",""],comp:["sidearm","primary"],gethome:["","sidearm"]};
KITS.forEach(k=>{
  const fix=a=>[...new Set(a.map(s=>s==="pistolmags"?"mags":s))];
  k.req=fix(k.req);k.opt=fix(k.opt).filter(s=>!k.req.includes(s));
  const g=KIT_GUNS[k.id]||["",""];
  if(g[0]&&!k.req.includes(g[0]))k.req.unshift(g[0]);
  if(g[1]&&!k.req.includes(g[1])&&!k.opt.includes(g[1]))k.opt.unshift(g[1]);
  if(k.id==="range"){k.opt.unshift("primary","sidearm")}
  if(["night","lowlight","maritime","urban","woodland"].includes(k.id)&&!k.req.includes("thermal")&&!k.opt.includes("thermal"))k.opt.push("thermal");
  if(["jungle","desert","carbine","night","lowlight","urban","woodland","maritime"].includes(k.id)&&!k.req.includes("mags")&&!k.opt.includes("mags"))k.req.push("mags");
  if(k.id==="urban"){k.req=k.req.filter(s=>s!=="plates");if(!k.opt.includes("plates"))k.opt.push("plates")}
});

/* ---- environments: what fits ---- */
var ENV={
  jungle:{rig:"chest",heavy:-2,gun:{suppressed:2,short:1},why:"Hot, wet and thick: light loads beat armor."},
  desert:{rig:"plate",gun:{lpvo:3},why:"Long sightlines and open ground."},
  maritime:{rig:"chest",heavy:-3,gun:{suppressed:1,short:1},why:"Weight can drown you; stay light."},
  arctic:{rig:"chest",gun:{},why:"Layers under gear; keep it simple with gloves on."},
  urban:{rig:"plate",lowvis:true,gun:{conceal:3,short:2,suppressed:1},why:"Blend in: no loud camo, compact guns."},
  woodland:{rig:"chest",gun:{},why:"Moving through trees and brush."},
  mountain:{rig:"chest",heavy:-2,gun:{lpvo:2},why:"Elevation and distance: weight matters."},
  night:{rig:"plate",night:true,gun:{laser:4,light:2,suppressed:2},why:"NODs and IR aiming first."},
  lowlight:{night:true,gun:{laser:4,light:3},why:"Dusk into dark: white light and IR."},
  gethome:{lowvis:true,gun:{conceal:4},why:"Low profile on foot."},
  pistol:{gun:{pistolOptic:2,light:1}},comp:{gun:{pistolOptic:2}},precision:{gun:{lpvo:4}},carbine:{gun:{light:1}},range:{gun:{}}
};
var envOf=kit=>ENV[kit.id]||{};
var isCamo=i=>RX.camo.test(` ${i.color||""} ${i.name||""} `.toLowerCase());
var gunCal=g=>String(g.caliber||"").toLowerCase().replace(/\s/g,"");
function calFits(sup,gun){const s=gunCal(sup),g=gunCal(gun);if(!s||!g)return false;const n=x=>/22|\.22/.test(x)?"22":/9|380|\.38|357/.test(x)?"9":/45/.test(x)?"45":/(5\.56|556|223|\.22?3)/.test(x)?"556":/(7\.62|308|300|30|6\.5|\.30)/.test(x)?"30":x;
  const a=n(s),b=n(g);if(a===b)return true;if(a==="30"&&b==="556")return true;if(a==="45"&&b==="9")return true;return false}
function gunGear(g){const kids=ridersOf(new Set([g.id]));const has=k=>kids.some(i=>classify(i).has(k));return {kids,optic:has("optic"),lpvo:has("optic_lpvo"),pistolOptic:kids.some(i=>classify(i).has("optic_pistol")||classify(i).has("optic_rd")),light:has("wlight"),laser:has("laser"),sup:has("suppressor")}}
function supFor(g){return live().filter(i=>classify(i).has("suppressor")&&calFits(i,g))}
function fit(kit,sid,i){
  const env=envOf(kit);let sc=10;const why=[];const k=classify(i);
  if(k.has("gun_long")||k.has("gun_pistol")){
    const gg=gunGear(i),p=env.gun||{};const pistol=k.has("gun_pistol");
    if(gg.optic){sc+=2;why.push("has an optic")}
    if(gg.light){sc+=1+(p.light||0)+(env.night?2:0);why.push("light mounted")}else if(env.night||p.light)why.push("no light on it");
    if(gg.laser){sc+=1+(p.laser||0);why.push("IR laser mounted")}else if(p.laser)sc-=2,why.push("no IR laser");
    if(p.lpvo&&gg.lpvo){sc+=p.lpvo;why.push("LPVO for distance")}
    if(p.pistolOptic&&pistol&&gg.pistolOptic){sc+=p.pistolOptic;why.push("dot on the slide")}
    if(p.suppressed&&(gg.sup||supFor(i).length)){sc+=p.suppressed;why.push(gg.sup?"suppressor on it":"you have a suppressor for it")}
    if(pistol&&p.conceal){const comp=COMPACT.test(itemNameText(i));sc+=comp?p.conceal*2:-p.conceal;why.push(comp?"compact, easy to conceal":"full-size, harder to hide")}
    if(!pistol&&p.short&&/sbr|short|\bk\b|10\.3|11\.5|12\.5|mcx|rattler|spear lt|\bsd\b/.test(itemNameText(i))){sc+=p.short;why.push("short and handy")}
    if(i.condition==="Needs-repair"){sc-=8;why.push("needs repair")}
    return {sc,why};
  }
  if(sid==="carrier"&&env.rig){
    if(env.rig==="chest"&&k.has("carrier_chest")){sc+=6;why.push(`a rig fits ${kit.name.toLowerCase()} better than a plate carrier`)}
    if(env.rig==="chest"&&k.has("carrier_plate")){sc-=2;why.push("plate carrier is heavy here")}
    if(env.rig==="plate"&&k.has("carrier_plate")){sc+=4;why.push("armor makes sense here")}
  }
  const vis=["carrier","riflemag","pistolmag","pack","camo","belt","helmet","rain","insul","sun","coldhead","gloves","boots","holster"].includes(sid);
  if(vis&&env.lowvis){if(isCamo(i)){sc-=7;why.push("camo pattern stands out")}else if(i.color){sc+=2;why.push("low-key color")}}
  if(vis&&!env.lowvis&&kit.colors.length&&i.color){const c=i.color.toLowerCase();if(kit.colors.some(x=>c.includes(x))){sc+=3;why.push("color fits")}else{sc-=2;why.push("color is off for this")}}
  if(env.heavy&&+i.weight>48){sc+=env.heavy;why.push("heavy")}
  if(i.condition==="Needs-repair"){sc-=6;why.push("needs repair")}else if(i.condition==="New"||i.condition==="Good")sc+=1;
  return {sc,why};
}
function cands(kit,sid){const kinds=slotDef(sid)[1];return live().filter(i=>!onLoan(i.id)&&kinds.some(k=>classify(i).has(k))).map(i=>({i,...fit(kit,sid,i)})).sort((a,b)=>b.sc-a.sc)}
// mags that feed the guns in this kit
function magFits(m,kit){const st=kstate(kit.id);const guns=[...(st.slots.primary||[]),...(st.slots.sidearm||[])].map(p=>itemById(p.id)).filter(Boolean);if(!guns.length)return true;const mk=classify(m);return guns.some(g=>(classify(g).has("gun_pistol")?mk.has("mag_pistol"):mk.has("mag_rifle")))}

/* ---- kit state: each slot holds picks [{id|name, qty}] ---- */
function kstate(id){
  const st=kits[id]||{};
  if(!st.slots){st.slots={};Object.entries(st.picks||{}).forEach(([s,v])=>{if(!v||v==="none")return;const sid=s==="pistolmags"?"mags":s;const it=itemById(v);if(it)(st.slots[sid]=st.slots[sid]||[]).push({id:v,qty:MULTI.has(sid)?(+it.qty||1):1})});kits={...kits,[id]:st}}
  return st;
}
var pickItem=p=>p.id?itemById(p.id):null;
var pickName=p=>p.id?(itemById(p.id)?.name||"(removed)"):p.name;
function kitPacked(kit){const st=kstate(kit.id);const ids=new Set();Object.values(st.slots).forEach(a=>a.forEach(p=>{if(p.id&&itemById(p.id))ids.add(p.id)}));(st.extras||[]).forEach(x=>{if(itemById(x))ids.add(x)});const box=containerFor(kit);if(box)ids.add(box.id);return ids}
coverage=function(kit){
  const st=kstate(kit.id);const ids=kitPacked(kit);const riders=ridersOf(ids);const a={};
  [...kit.req,...kit.opt].forEach(sid=>{const ps=(st.slots[sid]||[]).filter(p=>p.name||itemById(p.id));if(ps.length){a[sid]=pickItem(ps[0])||{id:"",name:ps[0].name,custom:true};return}
    const kinds=slotDef(sid)[1];const r=riders.find(i=>kinds.some(k=>classify(i).has(k)));a[sid]=r||null});
  const have=kit.req.filter(s=>a[s]).length;return {a,have,need:kit.req.length,pct:Math.round(100*have/Math.max(1,kit.req.length))};
};
solve=kit=>coverage(kit).a;
kitsUsing=function(id){return KITS.filter(k=>{const ids=kitPacked(k);return ids.has(id)||ridersOf(ids).some(i=>i.id===id)})};
async function saveKit(id,st){kits={...kits,[id]:{...st,updatedAt:now()}};renderKits();await persist()}
function suggestFor(kit,sid,used){
  let list=cands(kit,sid).filter(x=>!used.has(x.i.id));
  if(sid==="mags")list=list.filter(x=>magFits(x.i,kit));
  return list[0]||null;
}

/* ---- render ---- */
var kitUI={custom:"",open:""};
renderKits=function(){
  const kit=KITS.find(k=>k.id===curKit)||KITS[0];
  const chip=k=>{const c=coverage(k);return `<button type="button" class="chip kchip" aria-pressed="${k.id===curKit}" data-k="${k.id}">${esc(k.name)}<small>${c.pct}%</small></button>`};
  $("kitChips").innerHTML=`<div class="kgroup"><span class="klabel">Training</span>${KITS.filter(k=>k.type==="train").map(chip).join("")}</div><div class="kgroup"><span class="klabel">Environments</span>${KITS.filter(k=>k.type==="env").map(chip).join("")}</div>`;
  const st=kstate(kit.id);const {a,have,need,pct}=coverage(kit);const env=envOf(kit);
  const box=containerFor(kit);const ids=kitPacked(kit);const riders=ridersOf(ids).filter(i=>!ids.has(i.id));
  const used=new Set([...ids,...riders.map(i=>i.id)]);
  const extras=(st.extras||[]).map(itemById).filter(Boolean);
  const allItems=[...ids].map(itemById).filter(Boolean);
  const qOf=id=>{let q=0;Object.values(st.slots).forEach(arr=>arr.forEach(p=>{if(p.id===id)q+=+p.qty||1}));return q||1};
  const val=[...allItems.map(i=>({i,q:qOf(i.id)})),...riders.map(i=>({i,q:+i.qty||1}))].reduce((s,x)=>s+GearLogic.countedValue(x.i)*x.q,0);
  const wt=[...allItems.map(i=>({i,q:qOf(i.id)})),...riders.map(i=>({i,q:+i.qty||1}))].reduce((s,x)=>s+(x.i.weight!=null&&x.i.weight!==""?(+x.i.weight)*x.q:0),0);
  const boxOpts=`<option value="">${!box&&autoContainer(kit)?`Choose a bag (suggest: ${esc(autoContainer(kit).name)})`:"No bag chosen"}</option>`+containers().map(i=>`<option value="${esc(i.id)}"${st.container===i.id?" selected":""}>${esc(i.name)}${i.color?` (${esc(i.color)})`:""}</option>`).join("");
  const row=(sid,ess)=>{
    const [label,,tip]=slotDef(sid);const ps=(st.slots[sid]||[]).filter(p=>p.name||itemById(p.id));const cover=!ps.length&&a[sid]?a[sid]:null;
    const sg=!ps.length&&!cover?suggestFor(kit,sid,used):null;
    const list=cands(kit,sid).filter(x=>!ps.some(p=>p.id===x.i.id));
    const pill=ps.length||cover?`<span class="pill ok">Packed</span>`:`<span class="pill ${ess?"gap":""}">${ess?"Gap":"Optional"}</span>`;
    const chips=ps.map((p,ix)=>{const it=pickItem(p);const max=it?(+it.qty||1):99;const multi=MULTI.has(sid)||(it&&(+it.qty||1)>1)||!p.id;
      return `<div class="pk"><span class="pkn"><b>${esc(pickName(p))}</b>${it?`<small>${esc([it.brand,it.color,it.caliber].filter(Boolean).join(" · "))}${it&&+it.qty>1?` · you have ${+it.qty}`:""}</small>`:`<small>not in your inventory</small>`}</span>
        ${multi?`<span class="pkq"><button type="button" class="qb" data-q="-" data-s="${sid}" data-i="${ix}" aria-label="Fewer">−</button><b>${+p.qty||1}</b><button type="button" class="qb" data-q="+" data-s="${sid}" data-i="${ix}" data-max="${max}" aria-label="More">+</button></span>`:""}
        <button type="button" class="qb x" data-rm="${sid}" data-i="${ix}" aria-label="Remove">✕</button></div>`}).join("");
    const coverTxt=cover?`<div class="meta">Covered: <b>${esc(cover.name)}</b> is on ${esc(itemById(cover.mountedOn)?.name||"packed gear")}</div>`:"";
    const sgTxt=sg?`<div class="sug"><span>Best fit: <b>${esc(sg.i.name)}</b>${sg.why.length?` · ${esc(sg.why.slice(0,2).join(", "))}`:""}</span><button class="btn ghost" type="button" data-pack="${sid}" data-id="${esc(sg.i.id)}">Pack it</button></div>`:(!ps.length&&!cover?`<div class="meta">${esc(tip)}</div>`:"");
    const adding=kitUI.custom===sid;
    const add=adding?`<div class="cust"><input id="custName" placeholder="What are you bringing?" value=""><input id="custQty" type="number" min="1" value="1" style="width:5em"><button class="btn" type="button" data-custadd="${sid}">Add</button><button class="btn ghost" type="button" data-custx="1">Cancel</button></div>`
      :`<select class="addSel" data-add="${sid}" aria-label="Add to ${esc(label)}"><option value="">${ps.length?"+ Add another…":"+ Pack…"}</option>${list.slice(0,30).map(x=>`<option value="${esc(x.i.id)}">${esc(x.i.name)}${x.i.color?` (${esc(x.i.color)})`:""}${+x.i.qty>1?` ×${+x.i.qty}`:""}${x.why[0]?` — ${esc(x.why[0])}`:""}</option>`).join("")}<option value="__custom">Something not in my inventory…</option></select>`;
    return `<div class="slot2"><div class="sh"><div class="lbl">${esc(label)}${ess?"":"<small>optional</small>"}</div>${pill}</div>${chips}${coverTxt}${sgTxt}${add}</div>`;
  };
  const gaps=kit.req.filter(s=>!a[s]);
  $("kitDetail").innerHTML=`
   <div class="kitHead"><div><h2>${esc(kit.name)}</h2><p>${esc(kit.blurb)}${env.why?` <b>${esc(env.why)}</b>`:""}</p>${env.lowvis?`<div class="palette">Low-vis: solid, subdued colors. Camo patterns get flagged.</div>`:kit.colors.length?`<div class="palette">Best colors: ${esc(kit.colors.slice(0,6).join(", "))}</div>`:""}</div>
     <div class="meter"><b>${have}/${need}</b> <span>essentials packed</span><div class="bar"><i style="width:${pct}%"></i></div><span>${allItems.length+riders.length} items · ${money(val)}</span><br><span>${wt?fmtWt(wt):"weight —"}</span></div>
     <div class="kitBtns"><label class="packin"><span>Pack it in</span><select id="kitBox">${boxOpts}</select></label><button class="btn" type="button" id="kitAuto">Build it for me</button><button class="btn ghost" type="button" id="kitShare">Share</button><button class="btn ghost" type="button" id="kitPrint">Print list</button><button class="btn ghost" type="button" id="kitReset">Clear kit</button></div></div>
   ${gaps.length?`<div class="gaps"><h3>${gaps.length} essential${gaps.length>1?"s":""} not packed</h3><p class="hint" style="margin:0">Pack from your inventory, or pick "Something not in my inventory" to bring it anyway.</p></div>`:""}
   <div class="slots"><div class="slotsHead">Essentials <span>${have} of ${need}</span></div>${kit.req.map(s=>row(s,true)).join("")}</div>
   <div class="slots"><div class="slotsHead">Optional <span>${kit.opt.filter(s=>a[s]).length} of ${kit.opt.length}</span></div>${kit.opt.map(s=>row(s,false)).join("")}</div>
   ${riders.length?`<div class="slots"><div class="slotsHead">Comes along (mounted on packed gear) <span>${riders.length}</span></div><div class="riders">${riders.map(i=>`<div class="rider"><b>${+i.qty>1?i.qty+"× ":""}${esc(i.name)}</b><span>on ${esc(itemById(i.mountedOn)?.name||"")}</span><span>${esc(wtText(i))}</span></div>`).join("")}</div></div>`:""}
   <div class="slots"><div class="slotsHead">Also bring <span>${extras.length}</span></div><div class="extras" style="padding-top:10px">${extras.map(i=>`<span class="x">${esc(i.name)}<button type="button" data-rmx="${esc(i.id)}" aria-label="Remove">×</button></span>`).join("")}
     <select id="addExtra" style="width:auto;max-width:100%"><option value="">+ Add any item…</option>${live().filter(i=>!used.has(i.id)).sort(byName).map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}</select></div></div>`;
  if(kitUI.custom)setTimeout(()=>$("custName")?.focus(),30);
};
// fresh listeners (drop the old ones)
$("kitChips").onclick=e=>{const b=e.target.closest("[data-k]");if(!b)return;curKit=b.dataset.k;kitUI={custom:""};try{localStorage.setItem("gearLocker.curKit",curKit)}catch{};renderKits()};
$("kitDetail").addEventListener("change",async e=>{
  const kit=KITS.find(k=>k.id===curKit);const st=kstate(curKit);const t=e.target;
  if(t.dataset.add){const sid=t.dataset.add;if(t.value==="__custom"){kitUI.custom=sid;renderKits();return}if(!t.value)return;
    const it=itemById(t.value);const q=sid==="mags"?Math.min(+it.qty||1,classify(it).has("mag_pistol")?3:6):MULTI.has(sid)?(+it.qty||1):1;
    st.slots[sid]=[...(st.slots[sid]||[]),{id:t.value,qty:q}];await saveKit(curKit,st);return}
  if(t.id==="kitBox"){st.container=t.value||undefined;await saveKit(curKit,st);return}
  if(t.id==="addExtra"&&t.value){st.extras=[...(st.extras||[]),t.value];await saveKit(curKit,st)}
});
$("kitDetail").addEventListener("click",async e=>{
  const kit=KITS.find(k=>k.id===curKit);const st=kstate(curKit);const b=e.target.closest("button");if(!b)return;
  if(b.id==="kitWeigh"){const ids=new Set([...kitPacked(kit),...ridersOf(kitPacked(kit)).map(i=>i.id)]);const need=[...ids].map(itemById).filter(i=>i&&(i.weight==null||i.weight==="")&&!(classify(i).has("mag_rifle")||classify(i).has("mag_pistol"))).map(i=>i.id);if(!need.length){toast("Everything here has a weight");return}b.disabled=true;b.textContent="Looking up "+need.length+"…";runLookups(need).then(()=>renderKits());return}
  if(b.dataset.q){const arr=st.slots[b.dataset.s];const p=arr[+b.dataset.i];const max=+b.dataset.max||99;p.qty=Math.max(1,Math.min(b.dataset.q==="+"?max:999,(+p.qty||1)+(b.dataset.q==="+"?1:-1)));await saveKit(curKit,st);return}
  if(b.dataset.rm){st.slots[b.dataset.rm].splice(+b.dataset.i,1);await saveKit(curKit,st);return}
  if(b.dataset.rmx){st.extras=(st.extras||[]).filter(x=>x!==b.dataset.rmx);await saveKit(curKit,st);return}
  if(b.dataset.pack){const it=itemById(b.dataset.id);const sid=b.dataset.pack;const q=sid==="mags"?Math.min(+it.qty||1,classify(it).has("mag_pistol")?3:6):MULTI.has(sid)?(+it.qty||1):1;st.slots[sid]=[...(st.slots[sid]||[]),{id:b.dataset.id,qty:q}];await saveKit(curKit,st);return}
  if(b.dataset.custx){kitUI.custom="";renderKits();return}
  if(b.dataset.custadd){const n=$("custName").value.trim();if(!n){$("custName").focus();return}const q=Math.max(1,parseInt($("custQty").value)||1);const sid=b.dataset.custadd;st.slots[sid]=[...(st.slots[sid]||[]),{name:n.slice(0,80),qty:q}];kitUI.custom="";await saveKit(curKit,st);return}
  if(b.id==="kitAuto"){let n=0;const order=[...kit.req.filter(s=>s==="primary"||s==="sidearm"),...kit.opt.filter(s=>s==="primary"||s==="sidearm"),...kit.req,...kit.opt];const done=new Set();
    for(const sid of order){if(done.has(sid))continue;done.add(sid);const {a}=coverage(kit);if(a[sid])continue;const used=new Set([...kitPacked(kit),...ridersOf(kitPacked(kit)).map(i=>i.id)]);
      if(sid==="mags"){const ms=cands(kit,"mags").filter(x=>!used.has(x.i.id)&&magFits(x.i,kit));const types=new Set();ms.forEach(x=>{const ty=classify(x.i).has("mag_pistol")?"p":"r";if(types.has(ty))return;types.add(ty);st.slots.mags=[...(st.slots.mags||[]),{id:x.i.id,qty:Math.min(+x.i.qty||1,ty==="p"?3:6)}];n++});continue}
      const sg=suggestFor(kit,sid,used);if(sg&&sg.sc>4){const q=MULTI.has(sid)?(+sg.i.qty||1):1;st.slots[sid]=[...(st.slots[sid]||[]),{id:sg.i.id,qty:q}];kits={...kits,[kit.id]:st};n++}}
    if(!st.container){const sb=autoContainer(kit);if(sb){st.container=sb.id;n++}}
    await saveKit(curKit,st);toast(n?`Packed ${n} best-fit item${n>1?"s":""} for ${kit.name}`:"Nothing else in your inventory fits");return}
  if(b.id==="kitReset"){if(!b.dataset.armed){b.dataset.armed="1";b.textContent="Tap again to clear";return}await saveKit(curKit,{slots:{},extras:[],container:undefined});toast("Kit cleared");return}
  if(b.id==="kitShare"){openShare("kit",curKit);return}
  if(b.id==="kitPrint"){buildKitPrint(kit);printingKit=true;window.print();return}
});
function buildKitPrint(kit){const st=kstate(kit.id);const box=containerFor(kit);const ids=kitPacked(kit);const riders=ridersOf(ids).filter(i=>!ids.has(i.id));
  const line=(sid,ess)=>{const ps=(st.slots[sid]||[]);const lbl=slotDef(sid)[0];if(!ps.length){const c=coverage(kit).a[sid];return `<tr><td><span class="box"></span></td><td>${esc(lbl)}${ess?"":" <small>(opt.)</small>"}</td><td>${c?esc(c.name)+" (on "+esc(itemById(c.mountedOn)?.name||"")+")":ess?"<b>— NOT PACKED —</b>":"—"}</td><td></td><td></td></tr>`}
    return ps.map((p,k)=>{const it=pickItem(p);return `<tr><td><span class="box"></span></td><td>${k?"":esc(lbl)}${!k&&!ess?" <small>(opt.)</small>":""}</td><td>${+p.qty>1?`<b>${+p.qty}×</b> `:""}${esc(pickName(p))}</td><td>${esc(it?.brand||"")}</td><td>${esc(it?.location||"")}</td></tr>`}).join("")};
  $("printSheet").innerHTML=`<div class="ph"><div><h1>${esc(kit.name.toUpperCase())} — PACKING LIST</h1><small>Printed ${new Date().toLocaleDateString()} · Pack it in: ${box?esc(box.name):"—"}</small></div><small>WAR BOX</small></div>
  <table><thead><tr class="cat"><th colspan="5">ESSENTIALS</th></tr><tr><th>✓</th><th>Slot</th><th>Item</th><th>Brand</th><th>Stored</th></tr></thead><tbody>${kit.req.map(s=>line(s,true)).join("")}</tbody></table>
  <table><thead><tr class="cat"><th colspan="5">OPTIONAL</th></tr></thead><tbody>${kit.opt.filter(s=>(st.slots[s]||[]).length).map(s=>line(s,false)).join("")||"<tr><td colspan=5>—</td></tr>"}</tbody></table>
  ${riders.length?`<table><thead><tr class="cat"><th colspan="5">MOUNTED ON PACKED GEAR</th></tr></thead><tbody>${riders.map(i=>`<tr><td><span class="box"></span></td><td>On ${esc(itemById(i.mountedOn)?.name||"")}</td><td>${+i.qty>1?i.qty+"× ":""}${esc(i.name)}</td><td>${esc(i.brand||"")}</td><td></td></tr>`).join("")}</tbody></table>`:""}`}
// share a kit: everything packed with counts
{const _os=openShare;openShare=function(kind,id){if(kind!=="kit")return _os(kind,id);const kit=KITS.find(k=>k.id===id);const ids=kitPacked(kit);const rows=[...ids].map(itemById).filter(Boolean);ridersOf(ids).forEach(r=>{if(!rows.includes(r))rows.push(r)});
  let from="";try{from=localStorage.getItem("gearLocker.shareName")||""}catch{}const existing=(kits._shares||{})["kit:"+id];
  shareState={kind,id,title:kit.name+" kit",rows,from,prices:false,link:existing?shareUrl(existing):"",sid:existing||""};renderShare()}}

/* ---- gun builder: best setup from what you own ---- */
var ROLES={long:[["optic","Optic",i=>classify(i).has("optic")&&!classify(i).has("optic_mag")&&!classify(i).has("optic_pistol")],["magnifier","Magnifier",i=>classify(i).has("optic_mag")],["light","Weapon light",i=>classify(i).has("wlight")&&!classify(i).has("light_pistol")],["laser","IR laser",i=>classify(i).has("laser")],["suppressor","Suppressor",i=>classify(i).has("suppressor")],["sling","Sling",i=>classify(i).has("sling")]],
  pistol:[["optic","Optic (slide dot)",i=>classify(i).has("optic_pistol")],["light","Weapon light",i=>classify(i).has("light_pistol")||(classify(i).has("wlight")&&RX.pistolLight.test(itemNameText(i)))],["suppressor","Suppressor",i=>classify(i).has("suppressor")],["holster","Holster",i=>classify(i).has("holster")]]};
function buildPlan(g){
  const type=gunType(g)==="pistol"?"pistol":"long";const kids=ridersOf(new Set([g.id]));const out=[];
  ROLES[type].forEach(([key,label,test])=>{
    if(key==="magnifier"&&(!kids.some(i=>classify(i).has("optic_rd"))||kids.some(i=>classify(i).has("optic_lpvo"))))return;
    const on=key==="holster"?live().filter(i=>i.forGun===g.id&&test(i)):kids.filter(test);
    let pool=live().filter(i=>i.id!==g.id&&test(i)&&!on.includes(i)&&!onLoan(i.id));
    if(key==="suppressor")pool=pool.filter(i=>calFits(i,g));
    if(key==="holster"){const MOD=/\b(g?\d{2}x?|p\d{3}|p?365|43x?|48|hellcat|shield|m&p|1911|92|x300|tlr-?\d)\b/gi;const gm=(String(g.name)+" "+String(g.brand)).toLowerCase();
      const models=t=>(String(t).toLowerCase().match(MOD)||[]).filter(x=>!/x300|tlr/.test(x)).map(x=>x.replace(/^g/,""));
      const gModels=models(gm);pool=pool.filter(i=>{const hm=models(i.name+" "+(i.notes||""));return !hm.length||hm.some(x=>gModels.includes(x))||i.forGun===g.id});
      pool.sort((a,b)=>(models(b.name).some(x=>gModels.includes(x))?1:0)-(models(a.name).some(x=>gModels.includes(x))?1:0))}
    const score=i=>(i.mountedOn?0:5)+(i.forGun?0:2)+(i.condition==="Needs-repair"?-5:0)+(+i.value||0)/1000;
    pool.sort((a,b)=>score(b)-score(a));
    out.push({key,label,on,best:pool[0]||null,others:pool.slice(1,6)});
  });
  return {type,roles:out};
}
var buildFor=null;
function openBuild(id){buildFor=id;renderBuild()}
function renderBuild(){
  const el=$("buildSheet");const g=buildFor&&itemById(buildFor);if(!g){el.hidden=true;buildFor=null;syncLock();return}
  const plan=buildPlan(g);const where=i=>i.mountedOn&&itemById(i.mountedOn)?`now on ${itemById(i.mountedOn).name}`:i.forGun&&itemById(i.forGun)?`goes with ${itemById(i.forGun).name}`:"spare";
  el.querySelector(".panel").innerHTML=`<h2>Build: ${esc(g.name)}</h2><p class="hint">${plan.type==="pistol"?"Pistol":"Rifle"} · ${esc(g.caliber||"caliber not set")}. Best setup from what you own. Mounting something moves it onto this gun.</p>
   ${plan.roles.map(r=>`<div class="slot2"><div class="sh"><div class="lbl">${esc(r.label)}</div>${r.on.length?`<span class="pill ok">On it</span>`:r.best?`<span class="pill warn">Option</span>`:`<span class="pill">None owned</span>`}</div>
     ${r.on.map(i=>`<div class="pk"><span class="pkn"><b>${esc(i.name)}</b><small>${esc([i.brand,i.armType].filter(Boolean).join(" · "))}</small></span><button class="qb x" type="button" data-unmount="${esc(i.id)}" data-role="${r.key}" aria-label="Take off">✕</button></div>`).join("")}
     ${!r.on.length&&r.best?`<div class="sug"><span>Best: <b>${esc(r.best.name)}</b> · ${esc(where(r.best))}</span><button class="btn ghost" type="button" data-mountit="${esc(r.best.id)}" data-role="${r.key}">${r.key==="holster"?"Use it":"Mount it"}</button></div>`:""}
     ${r.others.length&&!r.on.length?`<select class="addSel" data-mountsel="${r.key}"><option value="">Other options…</option>${r.others.map(i=>`<option value="${esc(i.id)}">${esc(i.name)} (${esc(where(i))})</option>`).join("")}</select>`:""}
     ${!r.on.length&&!r.best&&r.key==="suppressor"?`<div class="meta">No suppressor in ${esc(g.caliber||"this caliber")} on your list.</div>`:""}</div>`).join("")}
   <div class="actions"><span class="spacer"></span><button class="btn" type="button" data-bclose="1">Done</button></div>`;
  el.hidden=false;syncLock();
}
async function mountOn(itemId,role,g){const it=all.find(x=>x.id===itemId&&!x.deleted);if(!it)return;
  if(role==="holster"){it.forGun=g.id}else{it.mountedOn=g.id;it.setupOn=""}
  it.updatedAt=now();render();await persist();renderBuild();toast(`${it.name} ${role==="holster"?"set for":"mounted on"} ${g.name}`)}
$("buildSheet").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;const g=itemById(buildFor);
  if(b.dataset.bclose||b.dataset.close==="build"){buildFor=null;renderBuild();if(g&&viewing)openDetail(itemById(g.id),true);return}
  if(b.dataset.mountit&&g){await mountOn(b.dataset.mountit,b.dataset.role,g);return}
  if(b.dataset.unmount&&g){const it=all.find(x=>x.id===b.dataset.unmount);if(!it)return;if(b.dataset.role==="holster")it.forGun="";else{it.mountedOn="";mergeIntoSpare(it)}it.updatedAt=now();render();await persist();renderBuild()}});
$("buildSheet").addEventListener("change",async e=>{const s=e.target.closest("[data-mountsel]");if(!s||!s.value)return;await mountOn(s.value,s.dataset.mountsel,itemById(buildFor))});
$("buildSheet").querySelector(".sheetBg").addEventListener("click",()=>{buildFor=null;renderBuild()});
{const _od=openDetail;openDetail=function(i,quiet){_od(i,quiet);if(!i||!classify(i).has("gun_long")&&!classify(i).has("gun_pistol"))return;const v=$("detail").querySelector(".dh .vbtns");if(v&&!v.querySelector("[data-dact='build']"))v.insertAdjacentHTML("beforeend",`<button class="btn ghost" type="button" data-dact="build">Build</button>`)}}
detailClickers.push(function(b){if(b.dataset.dact==="build"&&viewing){openBuild(viewing.id);return true}});
// Armory: a Build button on each gun
{const _ra=renderArms;renderArms=function(){_ra();document.querySelectorAll("#armsView .armRow").forEach(r=>{const g=itemById(r.dataset.id);if(g&&(classify(g).has("gun_long")||classify(g).has("gun_pistol"))&&!r.nextElementSibling?.classList?.contains("buildLink"))r.insertAdjacentHTML("afterend",`<button type="button" class="lnk buildLink" data-build="${esc(g.id)}">Build ${esc(g.name)} →</button>`)})}}
$("armsView").addEventListener("click",e=>{const b=e.target.closest("[data-build]");if(b){e.stopPropagation();openBuild(b.dataset.build)}},true);

