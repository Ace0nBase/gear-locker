/* ---------- v11: color picker, record IDs, lends, reminders, price watch ---------- */
var COLORS=["Black","Coyote Brown","Ranger Green","OD Green","Multicam","Multicam Black","Multicam Tropic","Multicam Arid","FDE","Tan 499","Khaki","Wolf Grey","Grey","Navy","Woodland / M81","AOR1","AOR2","Kryptek","Olive","Brown"];
function setColor(v){
  v=String(v||"").trim();const sel=$("fColorSel");
  const hit=COLORS.find(c=>c.toLowerCase()===v.toLowerCase())||COLORS.find(c=>v&&c.toLowerCase().replace(/[^a-z]/g,"")===v.toLowerCase().replace(/[^a-z]/g,""));
  if(!v){sel.value="";$("fColor").value="";$("fColor").hidden=true;return}
  if(hit){sel.value=hit;$("fColor").value=hit;$("fColor").hidden=true}else{sel.value="__other";$("fColor").value=v;$("fColor").hidden=false}
}
$("fColorSel").innerHTML=`<option value="">—</option>`+COLORS.map(c=>`<option>${esc(c)}</option>`).join("")+`<option value="__other">Other…</option>`;
$("fColorSel").addEventListener("change",()=>{const v=$("fColorSel").value;if(v==="__other"){$("fColor").hidden=false;$("fColor").value="";$("fColor").focus()}else{$("fColor").hidden=true;$("fColor").value=v}});

/* serial record: "Not on the record" unless it's a gun, suppressor or knife */
var _openForm11=openForm;
openForm=function(item){
  _openForm11(item);setColor(item?.color||"");
  $("fArm").dataset.touched="";
  $("fArm").value=item?(item.arm==="no"?"no":ARM[item.arm]?item.arm:(autoArm(item)||"no")):(autoArm({category:$("fCat").value,name:"",brand:""})||"no");
  recFields();
};
$("fArm").addEventListener("change",()=>{$("fArm").dataset.touched="1"});
var syncArmDefault=()=>{if($("fArm").dataset.touched)return;const a=autoArm({category:$("fCat").value,name:$("fName").value,brand:$("fBrand").value});if(!editing||!ARM[editing.arm])$("fArm").value=a||"no";recFields()};
$("fCat").addEventListener("change",syncArmDefault);$("fName").addEventListener("change",syncArmDefault);

/* every item on the record gets an ID (fixes knives added before) */
function fillArmIds(){
  const taken=[];let n=0;const t=now();
  ARM_KEYS.forEach(k=>live().filter(i=>armOf(i)===k&&!i.armId).sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||"")).forEach(i=>{const id=nextArmId(k,taken);taken.push(id);i.armId=id;if(!i.arm)i.arm=k;i.updatedAt=t;n++}));
  if(n)persist();return n;
}
{const _ra=renderArms;renderArms=function(){fillArmIds();_ra()}}

/* ---------- loans with friends who use War Box ---------- */
var borrowed=[],lentRemote={},lendUnsubs=[];
function tokenEmail(){return String(cloudUser&&cloudUser.email||"")}
function lendDoc(x){const it=itemById(x.itemId)||{};let from="";try{from=localStorage.getItem("gearLocker.shareName")||""}catch{}
  var email=String(x.friendEmail||"").trim();
  return {lender:cloudUser.uid,lenderName:from||String(cloudUser.email||"").split("@")[0],lenderEmail:tokenEmail(),borrowerEmail:email,borrowerEmailLower:email.toLowerCase(),borrowerName:x.borrower||"",
    item:{name:it.name||x.itemName||"",brand:it.brand||x.itemBrand||"",color:it.color||x.itemColor||"",category:it.category||x.itemCategory||""},out:x.out||"",due:x.due||"",returned:x.returned||"",updatedAt:now()}}
async function mirrorLend(x,removed){
  if(!fsdb||!cloudUser||!x||!x.id)return;
  const plan=GearLogic.loanSharePlan(x,{removed:!!removed,verified:!!cloudUser.emailVerified});
  if(plan.needsVerify)toast("Confirm your email first, then this loan can show up in your friend's War Box.",5000);
  const local=(db.loans||[]).find(y=>y.id===x.id);
  const row=local||x;
  if(plan.writeLend)row.lendShared=true;
  else if(plan.deleteLend&&!row.deleted)row.lendShared=false;
  const batch=fsdb.batch();
  batch.set(userRef().collection("loans").doc(x.id),stampRow(row));
  const ref=fsdb.collection("lends").doc(x.id);
  if(plan.writeLend)batch.set(ref,lendDoc(row));
  if(plan.deleteLend)batch.delete(ref);
  pushed["loans/"+x.id]=row.updatedAt;
  try{await batch.commit()}
  catch(e){delete pushed["loans/"+x.id];toast("Couldn't send the loan to your friend's app: "+(e.code==="permission-denied"?"loan sharing isn't switched on yet":e.message),5000)}
}
async function recoverOrphanLends(){
  if(!fsdb||!cloudUser||!cloudUser.emailVerified)return;
  if(typeof cloudReady==="undefined"||!cloudReady.has("loans"))return;
  const lends=Object.entries(lentRemote).map(([id,data])=>({id,...data}));
  const missing=GearLogic.orphanLoansFromLends(db.loans||[],lends,now());
  if(!missing.length)return;
  const batch=fsdb.batch();
  missing.forEach(rec=>{
    const i=db.loans.findIndex(y=>y.id===rec.id);
    if(i>=0)db.loans[i]=rec;else db.loans.push(rec);
    batch.set(userRef().collection("loans").doc(rec.id),stampRow(rec));
    pushed["loans/"+rec.id]=rec.updatedAt;
  });
  try{await batch.commit();if(curTab==="loans")renderExtra()}
  catch(e){missing.forEach(rec=>delete pushed["loans/"+rec.id])}
}
var borrowedParts={};
function noteBorrowed(which,docs){borrowedParts[which]=docs;var m=new Map();Object.values(borrowedParts).forEach(arr=>(arr||[]).forEach(b=>m.set(b.id,b)));var prev=new Set(borrowed.map(b=>b.id));borrowed=[...m.values()];var fresh=borrowed.filter(b=>!prev.has(b.id)&&!b.returned);if(prev.size||fresh.length===borrowed.length){fresh.slice(0,1).forEach(b=>toast((b.lenderName||"A friend")+" lent you: "+(b.item&&b.item.name||"gear"),4000))}afterRender();if(curTab==="loans")renderExtra()}
function watchLends(){
  lendUnsubs.forEach(u=>u());lendUnsubs=[];borrowedParts={};if(!fsdb||!cloudUser||!tokenEmail()||!cloudUser.emailVerified)return;
  var em=tokenEmail();
  lendUnsubs.push(fsdb.collection("lends").where("borrowerEmail","==",em).onSnapshot(s=>noteBorrowed("exact",s.docs.map(d=>({id:d.id,...d.data()}))),()=>{}));
  if(em===em.toLowerCase())lendUnsubs.push(fsdb.collection("lends").where("borrowerEmailLower","==",em).onSnapshot(s=>noteBorrowed("lower",s.docs.map(d=>({id:d.id,...d.data()}))),()=>{}));
  lendUnsubs.push(fsdb.collection("lends").where("lender","==",cloudUser.uid).onSnapshot(s=>{lentRemote={};s.docs.forEach(d=>lentRemote[d.id]=d.data());recoverOrphanLends();if(curTab==="loans")renderExtra();updateBadges()},()=>{}));
}
{const _save=SAVE.loans;SAVE.loans=async d=>{
  if(d.friendEmail&&!/^\S+@\S+\.\S+$/.test(String(d.friendEmail).trim())){toast("That email doesn't look right");return}
  if(!d.remindAt&&d.due)d.remindAt=d.due+"T09:00";
  const before=new Set(L("loans").map(y=>y.id));await _save(d);const x=d.id?L("loans").find(y=>y.id===d.id):L("loans").find(y=>!before.has(y.id));if(x)await mirrorLend(x)}}
{const _del=DEL.loans;DEL.loans=async d=>{const x=L("loans").find(y=>y.id===d.id);await _del(d);if(x)await mirrorLend(x,true)}}
ACT.loans=async(act,b)=>{
  const x=L("loans").find(y=>y.id===b.dataset.id);
  if(act==="returned"&&x){const r=await upsertC("loans",{...x,returned:today()});await mirrorLend(r);toast("Marked returned");render();return}
  if(act==="ics"&&x){downloadIcs(x);return}
  if(act==="iback"){const bb=borrowed.find(y=>y.id===b.dataset.id);if(!bb)return;try{await fsdb.collection("lends").doc(bb.id).update({borrowerReturned:today(),updatedAt:now()});toast(`Let ${bb.lenderName||"them"} know you gave it back`)}catch(e){toast("Couldn't update: "+e.message)}return}
};
function downloadIcs(x){
  const it=itemById(x.itemId);const when=(x.remindAt||(x.due?x.due+"T09:00":""))||localDateTime(new Date(Date.now()+7*864e5));
  const d=new Date(when);const f=t=>t.toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const title=`${x.borrower} still has your ${it?.name||x.itemName||"gear"}`;
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//War Box//EN","BEGIN:VEVENT",`UID:${x.id}@warbox`,`DTSTAMP:${f(new Date())}`,`DTSTART:${f(d)}`,`DTEND:${f(new Date(+d+15*60e3))}`,
    `SUMMARY:${title.replace(/[,;]/g," ")}`,`DESCRIPTION:Lent ${fmtDate(x.out)}${x.due?" · due back "+fmtDate(x.due):""}. Mark it returned in War Box when you get it back.`.replace(/[,;]/g," "),
    "BEGIN:VALARM","ACTION:DISPLAY","TRIGGER:PT0M",`DESCRIPTION:${title.replace(/[,;]/g," ")}`,"END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([ics],{type:"text/calendar"}));a.download="war-box-loan-reminder.ics";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);
}
var loanDue=x=>!x.returned&&x.remindAt&&new Date(x.remindAt)<=new Date();
{const _bf=badgeFor;badgeFor=function(k){
  if(k==="loans")return L("loans").filter(x=>!x.returned&&((x.due&&x.due<today())||loanDue(x)||lentRemote[x.id]?.borrowerReturned)).length+borrowed.filter(b=>!b.returned&&b.due&&b.due<today()).length;
  if(k==="wish")return L("wish").filter(w=>w.status!=="got"&&!GearLogic.saleRestricted(w)&&w.deal&&w.deal.hit&&w.dealSeen!==w.deal.date).length;
  return _bf(k)}}
{const _rl=RENDER.loans;RENDER.loans=()=>{
  _rl();const v=$("loansView");
  if(cloudUser){const head0=v.querySelector(".vhead");if(head0)head0.insertAdjacentHTML("afterend",cloudUser.emailVerified?`<p class="hint">Your sign-in email is <b>${esc(cloudUser.email||"")}</b>. Loans from friends match that address. If it is all lowercase, they can type it with any capitals.</p>`:`<div class="banner"><p>Confirm <b>${esc(cloudUser.email||"your email")}</b> before loans can move between accounts. Your own loan notes stay in War Box.</p></div>`)}
  // richer form fields
  const fe=v.querySelector('form[data-ed="loans"]');
  if(fe&&!fe.querySelector('[name="friendEmail"]')){const d=ED.loans?.draft||{};const anchor=fe.querySelector('[name="out"]')?.closest(".f");
    const extra=document.createElement("div");extra.style.display="contents";
    extra.innerHTML=fld("friendEmail","Their War Box email (optional)",d.friendEmail,{type:"email",span:2,ph:"friend@email.com"})+fld("remindAt","Remind me on",d.remindAt||(d.due?d.due+"T09:00":""),{type:"datetime-local"})+
      `<p class="hint" style="grid-column:1/-1;margin:0">With their email, the loan shows up in their War Box after you both confirm your email. Type their sign-in email. "Remind me" flags it in your app; use Add to calendar on the loan for a phone alert.</p>`;
    anchor?anchor.before(extra):fe.querySelector(".actions").before(extra)}
  // reminder banner + per-row status + calendar button
  const due=L("loans").filter(loanDue);const said=L("loans").filter(x=>!x.returned&&lentRemote[x.id]?.borrowerReturned);
  const ban=[...due.map(x=>`<li><b>${esc(x.borrower)}</b> still has your ${esc(itemById(x.itemId)?.name||x.itemName||"gear")}${x.due?` (due ${esc(fmtDate(x.due))})`:""}. <button class="lnk" type="button" data-act="returned" data-id="${esc(x.id)}">It's back</button></li>`),
    ...said.map(x=>`<li><b>${esc(x.borrower)}</b> says they returned your ${esc(itemById(x.itemId)?.name||x.itemName||"gear")} on ${esc(fmtDate(lentRemote[x.id].borrowerReturned))}. <button class="lnk" type="button" data-act="returned" data-id="${esc(x.id)}">Confirm returned</button></li>`)];
  const head=v.querySelector(".vhead");
  if(ban.length)head.insertAdjacentHTML("afterend",`<div class="gaps"><h3>Reminders</h3><ul>${ban.join("")}</ul></div>`);
  v.querySelectorAll('tr[data-act="edit"]').forEach(tr=>{const x=L("loans").find(y=>y.id===tr.dataset.id);if(!x||x.returned)return;const td=tr.lastElementChild;
    td.insertAdjacentHTML("afterbegin",`<button class="btn ghost" type="button" data-act="ics" data-id="${esc(x.id)}">Add to calendar</button>`);
    if(x.friendEmail){const c=tr.children[1];c.insertAdjacentHTML("beforeend",`<small>${lentRemote[x.id]?"in their War Box":"sending…"}</small>`)}});
  // gear you've borrowed
  if(borrowed.length){const open=borrowed.filter(b=>!b.returned);const done=borrowed.filter(b=>b.returned);
    v.insertAdjacentHTML("beforeend",`<div class="slotsHead">Borrowed from friends <span>${open.length}</span></div>
     ${open.length?`<div class="scroll"><table class="tbl"><thead><tr><th>Item</th><th>From</th><th>Lent</th><th>Due</th><th></th></tr></thead><tbody>${open.map(b=>`<tr><td><b>${esc(b.item?.name||"")}</b><small>${esc([b.item?.brand,b.item?.color].filter(Boolean).join(" · "))}</small></td><td>${esc(b.lenderName||b.lenderEmail||"")}</td><td>${esc(fmtDate(b.out))}</td><td>${b.due?`${esc(fmtDate(b.due))}${b.due<today()?` <span class="pill gap">Overdue</span>`:""}`:"—"}</td><td>${b.borrowerReturned?`<span class="pill ok">You gave it back</span>`:`<button class="btn ghost" type="button" data-act="iback" data-id="${esc(b.id)}">I gave it back</button>`}</td></tr>`).join("")}</tbody></table></div>`:`<p class="hint">Nothing borrowed right now.</p>`}
     ${done.length?`<p class="hint">Returned: ${done.slice(0,10).map(b=>esc(b.item?.name||"")).join(" · ")}</p>`:""}`)}
}}
var lendsFor="";
{const _mf=maybeFirstPush;maybeFirstPush=function(){_mf();if(cloudUser&&lendsFor!==cloudUser.uid&&!firstLoad){lendsFor=cloudUser.uid;setTimeout(()=>{watchLends();loanNudge();watchStatus()},600)}}}
function loanNudge(){const due=L("loans").filter(loanDue);if(due.length)toast(due.length===1?`${due[0].borrower} still has your ${itemById(due[0].itemId)?.name||"gear"}`:`${due.length} loans need a check-in`,5000)}

/* ---------- wishlist price watch ---------- */
async function apiPost(path,body){const tok=await firebase.auth().currentUser.getIdToken();const r=await fetch(window.LOOKUP_URL.replace(/\/$/,"")+path,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+tok},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||("Error "+r.status));return j}
var watchTimer=null;
function syncWatches(){clearTimeout(watchTimer);watchTimer=setTimeout(async()=>{if(!window.LOOKUP_URL||!cloudUser)return;
  const list=L("wish").filter(w=>w.status!=="got"&&+w.target>0&&!GearLogic.saleRestricted(w)).map(w=>({id:w.id,name:w.name,brand:w.brand||"",category:w.category||"",target:+w.target}));
  try{const j=await apiPost("/watch/sync",{watches:list});if(j.dropped)toast(`Price alerts are limited to ${j.max} items`,4000)}catch(e){if(list.length)toast(lookupFailMessage(e&&e.message,"price alerts"),4000)}},800)}
var vapidPublic="";
function rememberPush(j){if(j&&j.vapidPublicKey)vapidPublic=j.vapidPublicKey}
async function watchStatus(){if(!window.LOOKUP_URL||!cloudUser)return;try{const j=await apiPost("/watch/status",{});rememberPush(j);applyWatch(j.watches||[])}catch{}}
function showDealBanner(){var el=$("dealBanner");if(!el)return;var hits=(db.wish||[]).filter(w=>!w.deleted&&w.status!=="got"&&!GearLogic.saleRestricted(w)&&w.deal&&w.deal.hit&&w.dealSeen!==w.deal.date);if(!hits.length){el.hidden=true;return}el.hidden=false;$("dealMsg").textContent=hits.length===1?hits[0].name+" is at or under your target price.":hits.length+" wishlist prices hit your target.";$("dealGo").textContent="See wishlist";$("dealGo").onclick=()=>showTab("wish")}
function urlB64ToUint8(s){s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";var bin=atob(s),out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
async function enablePricePush(){if(!window.isSecureContext){toast("Phone alerts need the installed site (https). You'll still see them in the app.");return}var ios=/iphone|ipad|ipod/i.test(navigator.userAgent);var standalone=navigator.standalone===true||matchMedia("(display-mode: standalone)").matches;if(ios&&!standalone){toast("On iPhone, add War Box to your Home Screen, open it from the icon, then turn on alerts.",7000);return}if(!("PushManager" in window)||!("serviceWorker" in navigator)){toast("This browser can't do phone alerts. You'll still see them in the app.");return}if(!vapidPublic){toast("Phone alerts aren't switched on yet. You'll still see them in the app.",5000);return}var perm=await Notification.requestPermission();if(perm!=="granted"){toast("Notifications are blocked in the phone settings.");return}var reg=await navigator.serviceWorker.ready;var sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8(vapidPublic)});await apiPost("/watch/push",{subscription:sub.toJSON()});toast("Phone alerts are on for price hits.")}
function applyWatch(ws){let ch=false,news=[];ws.forEach(r=>{const w=db.wish.find(x=>x.id===r.id);if(!w||!r.best)return;if(GearLogic.saleRestricted(w))return;const best={...r.best};if(best.linksDropped||GearLogic.gunMarketUrl(best.url))best.url="";if(best.note)best.note=GearLogic.stripGunMarketText(best.note);if(JSON.stringify(w.deal)!==JSON.stringify(best)){w.deal=best;w.dealCheckedAt=r.lastCheck||"";w.updatedAt=now();ch=true;if(best.hit&&w.dealSeen!==best.date)news.push(w)}});
  if(ch){persist();if(curTab==="wish")renderExtra();updateBadges()}
  if(news.length)toast(news.length===1?`Price alert: ${news[0].name} for ${money(news[0].deal.price)} at ${news[0].deal.where}`:`${news.length} price alerts on your wishlist`,6000);if(typeof showDealBanner==="function")showDealBanner()}
{const _sw=SAVE.wish;SAVE.wish=async d=>{if(GearLogic.saleRestricted(d)){delete d.target;delete d.marketSources;delete d.priceNote;delete d.deal;d.link="";if(d.priceSource==="market"){delete d.priceSource;d.estPrice=""}}else{if(GearLogic.gunMarketUrl(d.link))d.link="";if(d.target!==undefined&&d.target!=="")d.target=Math.max(0,Math.round(+d.target||0))}await _sw(d);syncWatches()}}
{const _dw=DEL.wish;DEL.wish=async d=>{await _dw(d);syncWatches()}}
{const _aw=ACT.wish;ACT.wish=async(act,b)=>{
  if(act==="watchnow"){const w=db.wish.find(x=>x.id===b.dataset.id);if(!w)return;b.disabled=true;b.textContent="Searching…";
    if(GearLogic.saleRestricted(w)){toast("Price search skips firearms and ammunition.");renderExtra();return}
    try{await apiPost("/watch/sync",{watches:L("wish").filter(x=>x.status!=="got"&&+x.target>0&&!GearLogic.saleRestricted(x)).map(x=>({id:x.id,name:x.name,brand:x.brand||"",category:x.category||"",target:+x.target}))});
      const j=await apiPost("/watch/check",{id:w.id});applyWatch(j.watches||[]);const d=db.wish.find(x=>x.id===w.id)?.deal;toast(d?.price?`Lowest found: ${money(d.price)} at ${d.where}`:"No listings found right now",5000)}
    catch(e){toast(lookupFailMessage(e.message),5000)}renderExtra();return}
  if(act==="dealseen"){const w=db.wish.find(x=>x.id===b.dataset.id);if(w&&w.deal){w.dealSeen=w.deal.date;w.updatedAt=now();await persist();updateBadges();renderExtra()}return}
  const r=await _aw(act,b);if(act==="got")syncWatches();return r}}
{const _rw=RENDER.wish;RENDER.wish=()=>{
  _rw();const v=$("wishView");
  const fe=v.querySelector('form[data-ed="wish"]');
  if(fe&&!fe.querySelector('[name="target"]')){const d=ED.wish?.draft||{};const anchor=fe.querySelector('[name="priority"]')?.closest(".f");
    const box=document.createElement("div");box.style.display="contents";
    box.innerHTML=fld("target","Alert me at or below ($)",d.target,{type:"number",step:1,ph:"Price you'd pay"})+`<p class="hint wishAlertHint" style="grid-column:1/-1;margin:0">War Box checks saved alerts about once a day and flags a price that hits your number. Phone alerts, if you turn them on, use that same check.</p><button class="btn ghost" type="button" id="pushOn">Turn on phone alerts</button>`;
    var pb=box.querySelector("#pushOn");if(pb)pb.onclick=()=>enablePricePush().catch(e=>toast(e.message||"Couldn't turn on phone alerts"));
    anchor?anchor.after(box):fe.querySelector(".actions").before(box)}
  if(fe){const applyWishSale=()=>{const g=n=>fe.querySelector(`[name="${n}"]`);const draft={name:g("name")?.value||"",brand:g("brand")?.value||"",category:g("category")?.value||""};const restricted=GearLogic.saleRestricted(draft);const link=g("link")?.closest(".f");if(link)link.hidden=restricted;const priceLab=g("estPrice")?.closest(".f")?.querySelector("label");if(priceLab)priceLab.textContent=restricted?"Insured value ($)":"Est. price ($)";const target=g("target")?.closest(".f");if(target)target.hidden=restricted;const hint=fe.querySelector(".wishAlertHint");if(hint)hint.hidden=restricted;const push=fe.querySelector("#pushOn");if(push)push.hidden=restricted};fe.addEventListener("input",applyWishSale);fe.addEventListener("change",applyWishSale);applyWishSale()}
  v.querySelectorAll('tr[data-act="edit"]').forEach(tr=>{const w=db.wish.find(x=>x.id===tr.dataset.id);if(!w||GearLogic.saleRestricted(w))return;const cell=tr.children[1];
    if(+w.target>0){const d=w.deal;const hit=d&&d.hit;
      cell.insertAdjacentHTML("beforeend",`<div class="watch ${hit?"hit":""}">${hit?"Price alert: ":"Watching ≤ "+money(w.target)+(d&&d.price?" · lowest ":"")}${d&&d.price?`<b>${money(d.price)}</b>${d.where?` at ${esc(d.where)}`:""}${d.condition?` (${esc(d.condition)})`:""}`:d?" · nothing listed yet":" · first check within a day"}${hit?` · your max ${money(w.target)}`:""}</div>`);
      const btns=tr.querySelector(".vbtns");if(btns){btns.insertAdjacentHTML("afterbegin",`<button class="btn ghost" type="button" data-act="watchnow" data-id="${esc(w.id)}">Search now</button>`);if(hit&&w.dealSeen!==d.date)btns.insertAdjacentHTML("afterbegin",`<button class="btn ghost" type="button" data-act="dealseen" data-id="${esc(w.id)}">Seen it</button>`)}}});
}}

