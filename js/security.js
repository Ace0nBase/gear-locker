/* ---------- v20: kit gaps = things you don't own at all ---------- */
var NO_GAP=new Set(["primary","sidearm"]);
function ownedFor(sid){const kinds=slotDef(sid)[1];return live().some(i=>kinds.some(k=>classify(i).has(k)))}
var kitStarted=k=>{const st=kstate(k.id);return Object.values(st.slots||{}).some(a=>a.length)||!!st.container||(st.extras||[]).length>0};
function realGaps(){const gaps={};KITS.filter(kitStarted).forEach(k=>{const st=kstate(k.id);k.req.forEach(s=>{if(NO_GAP.has(s))return;if((st.slots[s]||[]).length)return;if(ownedFor(s))return;(gaps[s]=gaps[s]||[]).push(k.name)})});return gaps}
function staleGapWishes(){return db.wish.filter(w=>!w.deleted&&w.gapSlot&&w.status!=="got"&&!+w.target&&!w.link&&(NO_GAP.has(w.gapSlot)||ownedFor(w.gapSlot)))}
async function cleanGapWishes(){const old=staleGapWishes();if(!old.length)return 0;const t=now();old.forEach(w=>{w.deleted=true;w.updatedAt=t});await persist();return old.length}
{const _aw=ACT.wish;ACT.wish=async(act,b)=>{
  if(act!=="gaps")return _aw(act,b);
  const removed=await cleanGapWishes();if(!KITS.some(kitStarted)){render();toast("Pack a kit first (try Build it for me on the Kits tab). Gaps come from the kits you use.",6000);return}const gaps=realGaps();let n=0,u=0;
  for(const [s,ks] of Object.entries(gaps)){const ex=db.wish.find(w=>!w.deleted&&w.gapSlot===s&&w.status!=="got");
    if(ex){ex.kitsNeeding=ks;ex.updatedAt=now();u++;continue}
    const d=slotDef(s);db.wish.push({id:uid(),name:d[0],category:(S[s]?.[1]?.[0])||"Misc",gapSlot:s,kitsNeeding:ks,priority:ks.length>=4?"High":ks.length>=2?"Medium":"Low",status:"want",notes:d[2]||"",createdAt:now(),updatedAt:now()});n++}
  await persist();render();
  toast([n?`Added ${n} thing${n>1?"s":""} you don't own yet`:"You own something for every essential",removed?`removed ${removed} you already have`:""].filter(Boolean).join(" · "),5000);
}}
// one-time cleanup of the bad suggestions
{const _mf=maybeFirstPush;let done=false;maybeFirstPush=function(){_mf();if(!done&&cloudUser&&!firstLoad){done=true;setTimeout(async()=>{const n=await cleanGapWishes();if(n){render();toast(`Removed ${n} wishlist item${n>1?"s":""} you already own`,5000)}},1500)}}}

/* ---------- v21: security ---------- */
/* 1) no plain copy of your gear in browser storage when you're signed in. Firebase keeps an offline cache on this device. That cache is not a separate lock and it is not extra encryption you control. */
{const _m=mirror;mirror=function(){if(window.FIREBASE_CONFIG&&cloudUser){try{[LS,LSK,LSD,"gearLocker.offline"].forEach(k=>localStorage.removeItem(k))}catch{}return}return _m()}}
/* 2) sign out wipes this device's copy, including the offline cache */


/* 3) app lock: Face ID / Touch ID / passcode, or a PIN, on this device */
var LOCKK="gearLocker.lock";
var lockCfg=()=>{try{return JSON.parse(localStorage.getItem(LOCKK)||"{}")}catch{return {}}};
var setLockCfg=c=>{try{localStorage.setItem(LOCKK,JSON.stringify(c))}catch{}};
var b64=a=>btoa(String.fromCharCode(...new Uint8Array(a))),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function pinHash(pin,salt){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);return b64(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:unb64(salt),iterations:150000},k,256))}
var canBio=async()=>{try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())}catch{return false}};
async function bioRegister(){const cred=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:"Gear Locker",id:location.hostname},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:(cloudUser?.email||"gear-locker"),displayName:"Gear Locker"},pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"discouraged"},timeout:60000}});return b64(cred.rawId)}
async function bioCheck(id){await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:"public-key",id:unb64(id)}],userVerification:"required",timeout:60000}});return true}
var locked=false,hiddenAt=0;
function showLock(){const c=lockCfg();if(!c.mode||c.mode==="off")return;locked=true;document.body.classList.add("appLocked");const el=$("lockScreen");
  el.innerHTML=`<div class="lockBox"><img src="icon-192.png" alt="" width="72" height="72"><h1>Gear Locker</h1><p>Privacy screen</p>
    ${c.mode==="bio"?`<button class="btn" type="button" id="lkBio">Show with Face ID</button>`:""}
    ${c.pinHash?`<input id="lkPin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" maxlength="12"><button class="btn${c.mode==="bio"?" ghost":""}" type="button" id="lkPinGo">Show with PIN</button>`:""}
    <div class="err" id="lkErr"></div><button class="link" type="button" id="lkOut">Forgot? Sign out and sign back in</button></div>`;
  el.hidden=false;
  $("lkBio")?.addEventListener("click",tryBio);$("lkPinGo")?.addEventListener("click",tryPin);$("lkPin")?.addEventListener("keydown",e=>{if(e.key==="Enter")tryPin()});
  $("lkOut").onclick=()=>{if(typeof beginSignOut==="function")beginSignOut()};
  if(c.mode==="bio")setTimeout(tryBio,250);else setTimeout(()=>$("lkPin")?.focus(),100);
}
function unlock(){locked=false;document.body.classList.remove("appLocked");$("lockScreen").hidden=true;$("lockScreen").innerHTML=""}
var lockFails=0;
async function tryBio(){const c=lockCfg();try{await bioCheck(c.credId);unlock()}catch{$("lkErr").textContent="Face ID didn't go through."+(c.pinHash?" Use your PIN.":" Tap to try again.")}}
async function tryPin(){const c=lockCfg();const v=$("lkPin").value;if(!v)return;if(lockFails>=5&&Date.now()<(c.waitUntil||0)){$("lkErr").textContent="Too many tries. Wait a minute.";return}
  if(await pinHash(v,c.salt)===c.pinHash){lockFails=0;unlock()}else{lockFails++;$("lkPin").value="";$("lkErr").textContent="Wrong PIN.";if(lockFails>=5){c.waitUntil=Date.now()+60e3;setLockCfg(c)}}}
document.addEventListener("visibilitychange",()=>{const c=lockCfg();if(!c.mode||c.mode==="off")return;
  if(document.hidden){hiddenAt=Date.now();document.body.classList.add("appCover")}
  else{document.body.classList.remove("appCover");if(!locked&&Date.now()-hiddenAt>=(+c.after||0)*1000)showLock()}});
window.addEventListener("pagehide",()=>{const c=lockCfg();if(c.mode&&c.mode!=="off")document.body.classList.add("appCover")});
{const c=lockCfg();if(c.mode&&c.mode!=="off"&&!SHARE_ID)showLock()}

/* 4) security screen */
async function openSecurity(){const c=lockCfg();const bio=await canBio();const sh=Object.entries(kits._shares||{});const lends=L("loans").filter(x=>x.friendEmail&&!x.returned);
  const el=$("secSheet");el.querySelector(".panel").innerHTML=`<h2>Security</h2>
   <div class="secBlock"><h3>Privacy screen on this device</h3>
    <p class="hint">This hides your gear from someone looking over your shoulder. It is not a lock on your account. Your sign-in password and your phone's own passcode are what protect your data. The screen also blanks in the app switcher.</p>
    <div class="f"><label for="sLock">Lock with</label><select id="sLock"><option value="off">Off</option>${bio?`<option value="bio"${c.mode==="bio"?" selected":""}>Face ID / Touch ID (+ PIN backup)</option>`:""}<option value="pin"${c.mode==="pin"?" selected":""}>PIN</option></select></div>
    <div class="f"><label for="sAfter">Lock when I leave the app for</label><select id="sAfter">${[[0,"Right away"],[60,"1 minute"],[300,"5 minutes"],[900,"15 minutes"]].map(([v,l])=>`<option value="${v}"${(+c.after||0)===v?" selected":""}>${l}</option>`).join("")}</select></div>
    <div class="f" id="sPinBox"><label for="sPin">${c.pinHash?"New PIN (leave blank to keep the current one)":"PIN (6–12 digits)"}</label><input id="sPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12"></div>
    <button class="btn" type="button" data-sec="lock">Save lock</button>
    <p class="hint">The app also blanks itself in the app switcher while locked mode is on.</p></div>
   <div class="secBlock"><h3>What you've shared</h3>
    ${sh.length?sh.map(([k,sid])=>{const [kind,id]=k.split(":");const nm=kind==="kit"?(KITS.find(x=>x.id===id)?.name+" kit"):(itemById(id)?.name||"(deleted item)");return `<div class="pk"><span class="pkn"><b>${esc(nm)}</b><small>share link · anyone with the link can see it</small></span><button class="btn ghost" type="button" data-sec="unshare" data-k="${esc(k)}">Turn off</button></div>`}).join("")+`<button class="btn ghost" type="button" data-sec="unshareall">Turn off all links</button>`:`<p class="hint">No share links are on. Nothing of yours is viewable without signing in as you.</p>`}
    ${lends.length?`<p class="hint">${lends.length} active loan${lends.length>1?"s are":" is"} visible to the borrower's Gear Locker account (item name, brand, color and category, dates, your name and your email).</p>`:""}</div>
   <div class="secBlock"><h3>Password</h3><p class="hint">Changing your password signs out every other device that's signed in as you.</p>
    <div class="f"><label for="sOld">Current password</label><input id="sOld" type="password" autocomplete="current-password"></div>
    <div class="f"><label for="sNew">New password (12+ characters)</label><input id="sNew" type="password" autocomplete="new-password" minlength="12"></div>
    <button class="btn ghost" type="button" data-sec="pw">Change password</button><div class="err" id="sErr"></div></div>
   <div class="secBlock"><h3>Price &amp; weight lookups</h3><label class="keep"><input type="checkbox" id="sPriv"${kits._settings?.privateArms?" checked":""}> Never send Arms Room items (guns, suppressors, and gear mounted on a weapon) to lookups</label><p class="hint">Lookups send an item's name, brand, category, color, condition, caliber, load, and Arms Room type. Photo ID sends the photo to the AI lookup service. They do not send your notes, serial numbers, or where you store it. With this on, Arms Room records and gear mounted on a weapon are skipped entirely, including photo ID and battery lookup. Headlamps, flashlights, and binoculars still look up. Firearms, suppressors, frames, and ammunition get a weight-only lookup with no prices or stores.</p></div>
   <div class="actions"><span class="spacer"></span><button class="btn" type="button" data-sec="close">Done</button></div>`;
  el.hidden=false;syncLock();const tog=()=>{$("sPinBox").hidden=$("sLock").value==="off"};$("sLock").onchange=tog;tog();}
$("secSheet").addEventListener("click",async e=>{const b=e.target.closest("[data-sec]");if(!b)return;const a=b.dataset.sec;
  if(a==="close"){$("secSheet").hidden=true;syncLock();return}
  if(a==="lock"){const mode=$("sLock").value;const after=+$("sAfter").value;const pin=$("sPin").value.trim();const c=lockCfg();
    if(mode==="off"){setLockCfg({});toast("App lock is off");openSecurity();return}
    if(pin&&!GearLogic.pinLengthOk(pin)){toast("PIN must be 6–12 digits");return}
    if(!pin&&!c.pinHash){toast(mode==="bio"?"Set a backup PIN too, in case Face ID fails":"Enter a PIN");return}
    if(!pin&&c.pinHash)toast("The PIN already saved on this device still works until you change it",4000)
    const n={...c,mode,after};if(pin){n.salt=b64(crypto.getRandomValues(new Uint8Array(16)));n.pinHash=await pinHash(pin,n.salt)}
    if(mode==="bio"&&!c.credId){try{n.credId=await bioRegister()}catch(err){toast("Face ID setup was cancelled",4000);return}}
    setLockCfg(n);toast(mode==="bio"?"Privacy screen uses Face ID, with the PIN as backup":"Privacy screen uses a PIN");openSecurity();return}
  if(a==="unshare"||a==="unshareall"){const keys=a==="unshare"?[b.dataset.k]:Object.keys(kits._shares||{});const m={...(kits._shares||{})};
    for(const k of keys){try{await fsdb.collection("shares").doc(m[k]).delete()}catch{}delete m[k]}kits={...kits,_shares:m};await persist();toast(keys.length>1?"All share links are off":"Link turned off");openSecurity();return}
  if(a==="pw"){const o=$("sOld").value,nw=$("sNew").value;$("sErr").textContent="";if(nw.length<12){$("sErr").textContent="Use at least 12 characters.";return}
    try{const u=firebase.auth().currentUser;await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email,o));await u.updatePassword(nw);toast("Password changed. Other devices are signed out.",5000);$("sOld").value=$("sNew").value=""}
    catch(err){$("sErr").textContent=err.code==="auth/wrong-password"||err.code==="auth/invalid-credential"?"Current password is wrong.":err.code==="auth/weak-password"?"Pick a stronger password.":err.message}return}
});
$("secSheet").addEventListener("change",async e=>{if(e.target.id==="sPriv"){kits={...kits,_settings:{...(kits._settings||{}),privateArms:e.target.checked}};await persist();if(typeof syncPhotoId==="function")syncPhotoId();if(curTab==="maint")renderExtra();toast(e.target.checked?"Arms Room items won't be sent to lookups":"Arms Room items can be looked up")}});
$("secSheet").querySelector(".sheetBg").addEventListener("click",()=>{$("secSheet").hidden=true;syncLock()});
$("acct").insertAdjacentHTML("beforeend",`<button type="button" id="secBtn">Security</button>`);$("secBtn").onclick=openSecurity;
// honor "never send Arms Room items" in every lookup path
{const _rl=runLookups;runLookups=function(ids,quiet){if(kits._settings?.privateArms){const skip=ids.filter(id=>{const i=itemById(id);return i&&GearLogic.armoryLookupBlocked(true,GearLogic.armorySubject(i,i.mountedOn&&itemById(i.mountedOn)))});ids=ids.filter(id=>!skip.includes(id));if(skip.length&&!quiet)toast(`Skipped ${skip.length} Arms Room item${skip.length>1?"s":""} (private)`)}return _rl(ids,quiet)}}

/* ---------- v23: camo landing screen ---------- */
(function(){
  // seeded random so each pattern looks the same every time
  const rng=s=>()=>((s=Math.imul(s^s>>>15,1|s)+0x6D2B79F5|0,s=(s^s+Math.imul(s^s>>>7,61|s))^s>>>14)>>>0)/4294967296;
  const W=1200,H=900;
  // smooth closed blob from a jittered ellipse
  function blob(r,cx,cy,rx,ry,n=9,j=0.38,rot=0){let pts=[];for(let k=0;k<n;k++){const a=k/n*Math.PI*2;const f=1-j/2+r()*j;let x=Math.cos(a)*rx*f,y=Math.sin(a)*ry*f;const c=Math.cos(rot),s=Math.sin(rot);pts.push([cx+x*c-y*s,cy+x*s+y*c])}
    let d=`M${((pts[0][0]+pts[1][0])/2).toFixed(1)} ${((pts[0][1]+pts[1][1])/2).toFixed(1)}`;for(let k=1;k<=n;k++){const p=pts[k%n],q=pts[(k+1)%n];d+=` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${((p[0]+q[0])/2).toFixed(1)} ${((p[1]+q[1])/2).toFixed(1)}`}return d+"Z"}
  // tapered brush stroke
  function stroke(r,x,y,len,th,ang){const n=7;const top=[],bot=[];for(let k=0;k<=n;k++){const t=k/n;const px=x+Math.cos(ang)*len*t,py=y+Math.sin(ang)*len*t;const w=th*Math.sin(Math.PI*Math.min(1,t*1.15))*(0.7+r()*0.6);const nx=-Math.sin(ang),ny=Math.cos(ang);top.push([px+nx*w/2,py+ny*w/2+(r()-.5)*th*.25]);bot.push([px-nx*w/2,py-ny*w/2+(r()-.5)*th*.25])}
    const p=[...top,...bot.reverse()];const m=(a,b)=>`${((a[0]+b[0])/2).toFixed(1)} ${((a[1]+b[1])/2).toFixed(1)}`;let d=`M${m(p[0],p[1])}`;for(let k=1;k<=p.length;k++){const a=p[k%p.length],b=p[(k+1)%p.length];d+=` Q${a[0].toFixed(1)} ${a[1].toFixed(1)} ${m(a,b)}`}return d+"Z"}
  const svg=(bg,body)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;
  const P=[];
  // Desert Battle Dress "chocolate chip" — sand base, two browns, rocks with white halos
  P.push({name:"Desert Chocolate Chip",era:"US DBDU · 1981",make(){const r=rng(11);let b="";
    [["#c8ab7e",40,130,90],["#a07a52",34,100,66]].forEach(([c,n,rx,ry])=>{for(let k=0;k<n;k++)b+=`<path fill="${c}" d="${blob(r,r()*W,r()*H,rx*(.6+r()*.8),ry*(.6+r()*.8),10,.45,r()*3)}"/>`});
    for(let k=0;k<120;k++){const x=r()*W,y=r()*H,s=5+r()*8;b+=`<path fill="#f3efe4" d="${blob(r,x+s*.35,y-s*.3,s*1.05,s*.85,7,.5,r()*3)}"/><path fill="#2b241d" d="${blob(r,x,y,s,s*.8,7,.55,r()*3)}"/>`}
    return svg("#e2d2b0",b)}});
  // Vietnam tiger stripe — olive base, horizontal brushstrokes
  P.push({name:"Tiger Stripe",era:"Vietnam · 1960s",make(){const r=rng(23);let b="";
    for(let k=0;k<26;k++)b+=`<path fill="#8f8a52" d="${stroke(r,r()*W-200,r()*H,260+r()*420,40+r()*40,(r()-.5)*.25)}"/>`;
    for(let k=0;k<34;k++)b+=`<path fill="#3e4227" d="${stroke(r,r()*W-200,r()*H,240+r()*460,22+r()*30,(r()-.5)*.22)}"/>`;
    for(let k=0;k<30;k++)b+=`<path fill="#17170f" d="${stroke(r,r()*W-200,r()*H,200+r()*380,12+r()*18,(r()-.5)*.22)}"/>`;
    return svg("#6d6f3c",b)}});
  // Rhodesian brushstroke — sand base, big diagonal green and brown strokes
  P.push({name:"Rhodesian Brushstroke",era:"Rhodesia · 1960s",make(){const r=rng(37);let b="";
    [["#4f5a2c",26,70],["#6b4a2b",24,62]].forEach(([c,n,th])=>{for(let k=0;k<n;k++){const a=-.7+(r()-.5)*.6;b+=`<path fill="${c}" d="${stroke(r,r()*W-150,r()*H+120,300+r()*360,th*(.7+r()*.6),a)}"/>`}});
    return svg("#c9b98c",b)}});
  // ERDL leaf — green base, brown and black leaf shapes
  P.push({name:"ERDL Leaf",era:"US Marine Corps · 1967",make(){const r=rng(53);let b="";
    [["#7d8a4a",60,70,42],["#5b4630",54,62,36],["#1f2016",60,36,19]].forEach(([c,n,rx,ry])=>{for(let k=0;k<n;k++)b+=`<path fill="${c}" d="${blob(r,r()*W,r()*H,rx*(.6+r()*.8),ry*(.6+r()*.8),9,.5,r()*3)}"/>`});
    return svg("#5d6b3a",b)}});
  const urls=P.map(p=>URL.createObjectURL(new Blob([p.make()],{type:"image/svg+xml"})));
  const gate=$("gate");const bg=document.createElement("div");bg.className="camoBg";bg.setAttribute("aria-hidden","true");
  bg.innerHTML=urls.map((u,k)=>`<div class="camoL${k===0?" on":""}" style="background-image:url('${u}')"></div>`).join("")+`<div class="camoWeave"></div><div class="camoShade"></div><div class="camoTag"><b></b><span></span></div>`;
  gate.prepend(bg);
  const form=$("gateForm");form.classList.add("gateCard");
  const h=form.querySelector("h1");if(h){h.innerHTML=`<img class="gateIcon" src="icon-192.png" alt="" width="64" height="64"><span class="stencil">${"GEAR LOCKER".split("").map((c,k)=>`<i style="--d:${k}">${c===" "?"&nbsp;":c}</i>`).join("")}</span>`}
  let cur=Math.floor(Math.random()*P.length);const tag=bg.querySelector(".camoTag");
  const show=k=>{bg.querySelectorAll(".camoL").forEach((l,i)=>l.classList.toggle("on",i===k));tag.querySelector("b").textContent=P[k].name;tag.querySelector("span").textContent=P[k].era;tag.classList.remove("in");void tag.offsetWidth;tag.classList.add("in")};
  show(cur);
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timer=null;const tick=()=>{if(gate.hidden)return;cur=(cur+1)%P.length;show(cur)};
  if(!reduce)timer=setInterval(tick,9000);
  // tap the pattern tag to flip to the next one
  tag.addEventListener("click",()=>{tick();if(timer){clearInterval(timer);timer=setInterval(tick,9000)}});
})();


/* ---------- v24: invite a friend ---------- */
$("acct").insertAdjacentHTML("beforeend",`<button type="button" id="inviteBtn">Invite a friend</button>`);
/* ---------- v25: invite links open the sign-up screen ---------- */
(function(){
  const qs=new URLSearchParams(location.search);const JOIN=qs.has("join");
  const cleanUrl=()=>{try{qs.delete("join");const q=qs.toString();history.replaceState(null,"",location.pathname+(q?"?"+q:"")+location.hash)}catch{}};
  // the invite button now sends the join link
  const inv=$("inviteBtn");
  if(inv)inv.onclick=async()=>{const url=withAppQuery({join:"1"});
    const text="I'm inviting you to Gear Locker so we can each keep a locker and track loans. Tap the link to make an account, then confirm your email or loans won't show up. Price lookups only work for emails the owner has added. Then in Safari tap Share, then Add to Home Screen:";
    try{if(navigator.share){await navigator.share({title:"Gear Locker",text,url});return}}catch(e){if(e.name==="AbortError")return}
    try{await navigator.clipboard.writeText(text+" "+url);toast("Invite copied. Paste it in a text.")}catch{prompt("Copy this invite:",text+" "+url)}};
  if(!JOIN||SHARE_ID)return;
  const form=$("gateForm");
  // sign-up mode: "Create account" becomes the main button
  function joinMode(preview){
    form.classList.add("joinMode");
    $("gateMsg").innerHTML=preview?"":"You've been invited. Make an account and confirm your email. Price checks stay with the person who invited you unless they add your email.";
    $("gNew").className="btn";$("gIn").className="btn ghost";
    const row=$("gNew").parentElement;row.prepend($("gNew"));
    $("gPass").setAttribute("autocomplete","new-password");$("gPass").placeholder="12+ characters";
  }
  // switch back to normal sign-in when they tap "Sign in" with an existing account
  $("gIn").addEventListener("click",()=>{$("gPass").setAttribute("autocomplete","current-password")},{capture:true});
  // signed out: show the sign-up screen
  const iv=setInterval(()=>{
    if(!$("gateFields").hidden&&!cloudUser){clearInterval(iv);joinMode(false);cleanUrl();return}
    if(cloudUser){clearInterval(iv);cleanUrl();showPreview()}
  },60);
  setTimeout(()=>clearInterval(iv),15000);
  // already signed in (e.g. you tapped your own invite): show what your friend will see
  function showPreview(){
    const gate=$("gate");gate.hidden=false;gate.classList.add("previewing");$("gateFields").hidden=false;joinMode(true);
    form.querySelectorAll("input,button").forEach(x=>{if(x.id!=="gBack")x.disabled=true});
    $("gateMsg").innerHTML=`<span class="pvNote">You're signed in as <b>${esc(cloudUser.email)}</b>, so this link normally opens your locker. This is what your friend sees:</span><br>You've been invited. Make an account and confirm your email. Price checks stay with the person who invited you unless they add your email.`;
    form.insertAdjacentHTML("beforeend",`<button class="btn" type="button" id="gBack" style="margin-top:12px;width:100%">Back to my locker</button>`);
    $("gBack").onclick=()=>{gate.hidden=true;gate.classList.remove("previewing");$("gBack").remove();form.querySelectorAll("input,button").forEach(x=>x.disabled=false);$("gateMsg").textContent="Sign in to open your locker."};
  }
})();

