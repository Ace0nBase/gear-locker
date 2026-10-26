/* ---------- cloud sync (Firebase) ---------- */
var cloudUser=null,fsdb=null,cloudUnsubs=[],pushed={},pushTimer=null,kitsPushed="",cloudReady=new Set(),firstLoad=true;
var CLOUD_COLS=["items",...COLS];
var clean=o=>JSON.parse(JSON.stringify(o));
var inflightWrites={}, kitsServerAt="";
function stampRow(r){var copy=clean(GearLogic.serverRow(r));var wid=GearLogic.newWriteId();copy.writeId=wid;copy.serverUpdatedAt=firebase.firestore.FieldValue.serverTimestamp();inflightWrites[r.id]={writeId:wid,updatedAt:r.updatedAt};return copy}
function adoptServerStamp(row){if(!row)return row;var iso=GearLogic.serverStampIso(row.serverUpdatedAt);if(iso)row.serverUpdatedAt=iso;return row}
function mergeCloudRows(local,remote){var m=new Map();(local||[]).forEach(i=>{if(i&&i.id)m.set(i.id,i)});(remote||[]).forEach(r=>{if(!r||!r.id)return;var p=m.get(r.id);m.set(r.id,p?GearLogic.mergeByServerTime(p,r,inflightWrites):r)});return [...m.values()]}
var arrOf=c=>c==="items"?all:db[c];
function setArr(c,a){if(c==="items")all=a;else db[c]=a}
function userRef(){return fsdb.collection("users").doc(cloudUser.uid)}
function setSync(state,txt){const d=$("syncDot");d.className="sync "+state;d.title=txt||"";}
function pushCloudSoon(){if(!cloudUser||!fsdb)return Promise.resolve();clearTimeout(pushTimer);var delay=GearLogic.cloudWriteDelay(typeof navigator!=="undefined"?navigator.onLine:true);if(delay===0)return pushCloud();pushTimer=setTimeout(pushCloud,delay);return Promise.resolve()}
function offlineNow(){return typeof navigator!=="undefined"&&navigator.onLine===false}
function seenLocal(pairs){
  var unsubs=[];
  var promise=new Promise(resolve=>{
    if(!pairs.length){resolve();return}
    var left=new Set(pairs.map(p=>p[0]+"/"+p[1]));
    var done=false;
    var finish=()=>{if(done)return;done=true;unsubs.splice(0).forEach(u=>{try{u()}catch(e){}});resolve()};
    pairs.forEach(function(p){
      var c=p[0],id=p[1],wid=p[2];
      unsubs.push(userRef().collection(c).doc(id).onSnapshot({includeMetadataChanges:true},function(snap){
        var data=snap.exists?snap.data():null;
        if(data&&data.writeId===wid&&(snap.metadata.hasPendingWrites||!snap.metadata.fromCache)){left.delete(c+"/"+id);if(!left.size)finish()}
      },finish));
    });
  });
  return {promise:promise,cancel:()=>unsubs.splice(0).forEach(u=>{try{u()}catch(e){}})};
}
function commitDurable(commit,pairs){if(!offlineNow())return commit;var watch=seenLocal(pairs);return Promise.race([commit,watch.promise]).finally(()=>watch.cancel())}
async function pushCloud(){
  if(!cloudUser||cloudReady.size<CLOUD_COLS.length+1)return;
  const ops=[];
  CLOUD_COLS.forEach(c=>arrOf(c).forEach(r=>{const k=c+"/"+r.id;if(r.id&&pushed[k]!==r.updatedAt){ops.push([c,r]);pushed[k]=r.updatedAt}}));
  const kj=JSON.stringify(kits);const kitsChanged=kj!==kitsPushed;
  if(!ops.length&&!kitsChanged)return;
  var reported=false;
  var reportFail=e=>{if(reported)return;reported=true;ops.forEach(([c,r])=>delete pushed[c+"/"+r.id]);if(kitsChanged)kitsPushed="";setSync("off","Couldn't sync: "+(e.code||e.message))};
  try{
    for(let i=0;i<ops.length;i+=400){
      const slice=ops.slice(i,i+400);const b=fsdb.batch();const pairs=[];
      slice.forEach(([c,r])=>{const row=stampRow(r);b.set(userRef().collection(c).doc(r.id),row);pairs.push([c,r.id,row.writeId])});
      const commit=b.commit();commit.catch(reportFail);
      await commitDurable(commit,pairs);
    }
    if(kitsChanged){
      var wid=GearLogic.newWriteId();inflightWrites.__kits={writeId:wid,snapshot:kj};kitsPushed=kj;
      var commit=userRef().collection("meta").doc("kits").set({kits:clean(kits),updatedAt:now(),writeId:wid,serverUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      commit.catch(reportFail);
      await commitDurable(commit,[["meta","kits",wid]]);
    }
    if(!offlineNow())setSync("on","Synced");
  }catch(e){reportFail(e)}
}
function onCloudChange(){
  mirror();render();
  if(viewing&&!$("detail").hidden){const v=all.find(x=>x.id===viewing.id);if(v&&!v.deleted)openDetail(v,true)}
  if(dir)writeFile().catch(()=>{});
  if(editing){const fresh=all.find(i=>i.id===editing.id);if(fresh){editing=fresh;showPrice(fresh)}}
  if(typeof showDealBanner==="function")showDealBanner();
}
function subscribeCloud(){
  cloudUnsubs.forEach(u=>u());cloudUnsubs=[];cloudReady=new Set();
  CLOUD_COLS.forEach(c=>{
    cloudUnsubs.push(userRef().collection(c).onSnapshot(snap=>{
      const recs=snap.docs.map(d=>adoptServerStamp(d.data())).filter(r=>r&&r.id);
      recs.forEach(r=>{pushed[c+"/"+r.id]=r.updatedAt;if(inflightWrites[r.id]&&inflightWrites[r.id].writeId===r.writeId)delete inflightWrites[r.id]});
      const before=JSON.stringify(arrOf(c));setArr(c,mergeCloudRows(arrOf(c),recs));
      const first=!cloudReady.has(c);cloudReady.add(c);
      if(JSON.stringify(arrOf(c))!==before)onCloudChange();
      if(first)maybeFirstPush();
      setSync(snap.metadata.fromCache?"":"on",snap.metadata.fromCache?"Offline – changes will sync":"Synced");
    },e=>setSync("off","Sync error: "+(e.code||e.message))));
  });
  cloudUnsubs.push(userRef().collection("meta").doc("kits").onSnapshot(d=>{
    const data=d.exists?d.data():{};const k=data.kits||{};const flight=inflightWrites.__kits||null;const localPending=!!(flight&&JSON.stringify(kits)!==flight.snapshot);
    const merged=GearLogic.mergeKitsByServerTime(kits,k,{localStamp:kitsServerAt,remoteStamp:data.serverUpdatedAt,localPending:localPending,inflightWriteId:flight?flight.writeId:"",remoteWriteId:data.writeId||""});
    kitsPushed=JSON.stringify(k);if(merged.serverUpdatedAt)kitsServerAt=merged.serverUpdatedAt;if(flight&&data.writeId===flight.writeId&&!localPending)delete inflightWrites.__kits;
    const before=JSON.stringify(kits);kits=merged.kits||{};
    const first=!cloudReady.has("meta");cloudReady.add("meta");
    if(JSON.stringify(kits)!==before)onCloudChange();
    if(first)maybeFirstPush();
  },e=>setSync("off","Sync error: "+(e.code||e.message))));
}
function maybeFirstPush(){if(cloudReady.size===CLOUD_COLS.length+1){pushCloud();if(firstLoad){firstLoad=false;render();if(window.LOOKUP_URL)setTimeout(()=>{const q=live().filter(i=>i.marketCheck==="requested").map(i=>i.id);if(q.length)runLookups(q,true)},800)}}}
function gateErr(t){$("gErr").textContent=t||""}
var AUTH_MSG={"auth/invalid-credential":"Email or password is wrong.","auth/wrong-password":"Email or password is wrong.","auth/user-not-found":"No account with that email.","auth/email-already-in-use":"That email already has an account. Sign in instead.","auth/weak-password":"Use at least 12 characters.","auth/invalid-email":"That email doesn't look right.","auth/too-many-requests":"Too many tries. Wait a few minutes.","auth/network-request-failed":"No connection. Check your signal and try again.","auth/operation-not-allowed":"New accounts are turned off for this locker.","auth/admin-restricted-operation":"New accounts are turned off for this locker."};
var authMsg=e=>AUTH_MSG[e?.code]||"Something went wrong. Try again.";
function startAppCheck(){
  if(window.GEAR_QA||window.Capacitor)return;
  var key=window.APP_CHECK_SITE_KEY;
  if(!key||!firebase.appCheck)return;
  try{firebase.appCheck().activate(new firebase.appCheck.ReCaptchaV3Provider(key),true)}catch(e){}
}
function initFirebase(){
  var emulatorFlag=new URLSearchParams(location.search).get("env")==="emulator";
  if(emulatorFlag&&(!window.GEAR_QA||!window.FIREBASE_CONFIG||window.FIREBASE_CONFIG.projectId!=="demo-gear-locker"||window.FIREBASE_CONFIG.apiKey==="AIzaSyBexXFiQtDEnmlL2z0x4FXD7YCbeAHTGC4")){
    window.GEAR_QA_BLOCKED=true;window.FIREBASE_CONFIG=null;window.LOOKUP_URL="";return false}
  if(window.GEAR_QA_BLOCKED||!window.FIREBASE_CONFIG)return false;
  if(firebase.apps.length){
    if((emulatorFlag||window.GEAR_QA)&&firebase.app().options.projectId!=="demo-gear-locker"){window.GEAR_QA_BLOCKED=true;window.FIREBASE_CONFIG=null;window.LOOKUP_URL="";return false}
  }else firebase.initializeApp(window.FIREBASE_CONFIG);
  if(window.GEAR_QA){
    if(firebase.app().options.projectId!=="demo-gear-locker"){window.GEAR_QA_BLOCKED=true;window.FIREBASE_CONFIG=null;window.LOOKUP_URL="";return false}
    if(!window.GEAR_EMULATORS){
      firebase.auth().useEmulator("http://127.0.0.1:9099",{disableWarnings:true});
      firebase.firestore().useEmulator("127.0.0.1",8080);
      window.GEAR_EMULATORS=true;
    }
  }else startAppCheck();
  return true;
}
function verifyContinueUrl(){return window.GEAR_QA?"http://127.0.0.1:5500/?env=emulator":"https://ace0nbase.github.io/gear-locker/"}
function refreshVerify(){var b=$("verifyBanner");if(!b)return;var u=firebase.auth&&firebase.auth().currentUser;if(u&&!u.emailVerified){b.hidden=false;if($("verifyMsg"))$("verifyMsg").textContent="Confirm "+(u.email||"your email")+" so loans and price lookups can use this address. Check your inbox."}else b.hidden=true;var q=$("qaBanner");if(q)q.hidden=!window.GEAR_QA}
function startCloud(){
  if(!initFirebase())return;
  fsdb=firebase.firestore();
  try{fsdb.enablePersistence({synchronizeTabs:true}).catch(()=>{})}catch{}
  const auth=firebase.auth();
  const P=firebase.auth.Auth.Persistence;
  let keep=true;try{keep=localStorage.getItem("gearLocker.keep")!=="0"}catch{}
  $("gKeep").checked=keep;
  auth.setPersistence(keep?P.LOCAL:P.SESSION).catch(()=>{});
  $("gate").hidden=false;$("gateFields").hidden=true;$("gateMsg").textContent="Opening your locker…";
  auth.onAuthStateChanged(async u=>{
    if(!u){
      cloudUser=null;cloudUnsubs.forEach(x=>x());cloudUnsubs=[];
      $("gate").hidden=false;$("acct").hidden=true;$("gateFields").hidden=false;$("gateMsg").textContent="Sign in to open your locker.";refreshVerify();
      return;
    }
    const switched=localStorage.getItem("gearLocker.uid")&&localStorage.getItem("gearLocker.uid")!==u.uid;
    if(switched){try{GearLogic.clearUserLocal(localStorage)}catch{}}
    try{localStorage.setItem("gearLocker.uid",u.uid)}catch{}
    cloudUser=u;$("gate").hidden=true;$("acct").hidden=false;$("acctTxt").textContent=u.email;refreshVerify();setSync("","Connecting…");
    pushed={};firstLoad=true;
    await boot();
    subscribeCloud();
  });
  const applyKeep=async()=>{const k=$("gKeep").checked;try{localStorage.setItem("gearLocker.keep",k?"1":"0")}catch{};try{await auth.setPersistence(k?P.LOCAL:P.SESSION)}catch{}};
  $("gateForm").onsubmit=async e=>{e.preventDefault();gateErr("");$("gIn").disabled=true;await applyKeep();try{await auth.signInWithEmailAndPassword($("gEmail").value.trim(),$("gPass").value)}catch(err){gateErr(authMsg(err))}finally{$("gIn").disabled=false}};
  $("gNew").onclick=async()=>{gateErr("");if(!$("gateForm").reportValidity())return;if(!GearLogic.newPasswordOk($("gPass").value)){gateErr("Use at least 12 characters.");return}$("gNew").disabled=true;await applyKeep();try{await auth.createUserWithEmailAndPassword($("gEmail").value.trim(),$("gPass").value);try{await auth.currentUser.sendEmailVerification({url:verifyContinueUrl(),handleCodeInApp:false})}catch(e){}}catch(err){gateErr(authMsg(err))}finally{$("gNew").disabled=false}};
  $("gReset").onclick=async()=>{const em=$("gEmail").value.trim();if(!em){gateErr("Type your email first.");return}try{await auth.sendPasswordResetEmail(em);gateErr("");$("gateMsg").textContent="Check your email for a reset link."}catch(err){gateErr(authMsg(err))}};
  $("signOut").onclick=async()=>{await pushCloud().catch(()=>{});cloudUnsubs.forEach(x=>x());cloudUnsubs=[];all=[];kits={};db=emptyDb();try{GearLogic.clearUserLocal(localStorage)}catch{}render();await auth.signOut();try{await firebase.firestore().terminate();await firebase.firestore().clearPersistence()}catch{}location.reload()};
  $("verifySend").onclick=async()=>{try{await firebase.auth().currentUser.sendEmailVerification({url:verifyContinueUrl(),handleCodeInApp:false});toast("Confirmation email sent. Check your inbox.")}catch(e){toast(e.message||"Couldn't send the email")}};
  $("verifyDone").onclick=async()=>{try{var u=await confirmEmailNow();if(u&&u.emailVerified)toast("Email confirmed.");else toast("Not confirmed yet. Open the link in the email, then tap this again.",5000)}catch(e){toast("Couldn't check. Try again.")}};
  if($("qaVerify"))$("qaVerify").onclick=async()=>{if(!window.GEAR_QA)return;var u=firebase.auth().currentUser;if(!u){toast("Sign in on this test page first");return}try{var r=await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update",{method:"POST",headers:{Authorization:"Bearer owner","Content-Type":"application/json"},body:JSON.stringify({localId:u.uid,emailVerified:true})});if(!r.ok)throw new Error("emulator");u=await confirmEmailNow();toast(u&&u.emailVerified?"Marked confirmed in the local emulator":"Couldn't mark it confirmed. Is npm run qa still running?")}catch(e){toast("Couldn't mark it confirmed. Is npm run qa still running?")}};
  if($("qaStorage"))$("qaStorage").onclick=qaStorageCheck;
async function confirmEmailNow(){var user=firebase.auth().currentUser;if(!user)return null;await GearLogic.refreshAuthClaims(user);cloudUser=firebase.auth().currentUser;refreshVerify();if(cloudUser&&cloudUser.emailVerified)watchLends();return cloudUser}
async function storageCode(ref){try{await ref.getMetadata();return "ok"}catch(e){return e&&e.code||"error"}}
async function qaStorageCheck(){
  if(!window.GEAR_QA||!firebase.auth().currentUser){toast("Sign in on this test page first");return}
  if(firebase.app().options.projectId!=="demo-gear-locker"){toast("Storage check refused: this is not the local emulator");return}
  try{await qaStorageCheckRun()}
  catch(e){toast("Storage check couldn't finish. Is npm run qa still running?",6000)}
}
async function qaStorageCheckRun(){
  await new Promise((res,rej)=>{if(firebase.storage)return res();var s=document.createElement("script");s.src="https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js";s.onload=res;s.onerror=rej;document.head.appendChild(s)});
  var uid=firebase.auth().currentUser.uid;
  var st=firebase.storage();
  try{st.useEmulator("127.0.0.1",9199)}catch(e){}
  await st.ref("users/"+uid+"/qa-privacy.txt").putString("local qa");
  var otherName="qa-other";
  var otherApp=firebase.apps.find(a=>a.name===otherName)||firebase.initializeApp(firebase.app().options,otherName);
  var otherAuth=firebase.auth(otherApp);
  try{otherAuth.useEmulator("http://127.0.0.1:9099",{disableWarnings:true})}catch(e){}
  var otherEmail="qa-storage-"+uid.slice(0,6)+"@"+"example.test";
  try{await otherAuth.signInWithEmailAndPassword(otherEmail,"local-qa-check-1")}
  catch(e){await otherAuth.createUserWithEmailAndPassword(otherEmail,"local-qa-check-1")}
  var otherSt=firebase.storage(otherApp);
  try{otherSt.useEmulator("127.0.0.1",9199)}catch(e){}
  var otherCode=await storageCode(otherSt.ref("users/"+uid+"/qa-privacy.txt"));
  var anonName="qa-anon";
  var anonApp=firebase.apps.find(a=>a.name===anonName)||firebase.initializeApp(firebase.app().options,anonName);
  var anonAuth=firebase.auth(anonApp);
  try{anonAuth.useEmulator("http://127.0.0.1:9099",{disableWarnings:true})}catch(e){}
  if(anonAuth.currentUser)await anonAuth.signOut();
  var anonSt=firebase.storage(anonApp);
  try{anonSt.useEmulator("127.0.0.1",9199)}catch(e){}
  var signedOutCode=await storageCode(anonSt.ref("users/"+uid+"/qa-privacy.txt"));
  var verdict=GearLogic.storagePrivacyVerdict(otherCode,signedOutCode);
  if(verdict.pass)toast("Storage check passed. Your file saved. Another account and a signed-out check were blocked.");
  else if(verdict.countedMissingAsBlocked)toast("Storage check failed. The file was missing, so this does not prove another account was blocked.",6000);
  else toast("Storage check failed. Another account or a signed-out check was not blocked ("+otherCode+" / "+signedOutCode+").",6000);
}
}
var APP_VERSION="29";try{document.getElementById("ver").textContent="v"+APP_VERSION}catch{}
if("serviceWorker" in navigator&&GearLogic.serviceWorkerAllowed(location,window.GEAR_QA)){
  const hadSW=!!navigator.serviceWorker.controller;let reloading=false;
  navigator.serviceWorker.register("sw.js").then(reg=>{const chk=()=>reg.update().catch(()=>{});document.addEventListener("visibilitychange",()=>{if(!document.hidden)chk()});setInterval(chk,20*60e3);chk()}).catch(()=>{});
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(!hadSW||reloading)return;reloading=true;if(!anySheetOpen())location.reload();else toast("Gear Locker updated. Close and reopen to finish.",6000)});
}

/* ---------- item detail ---------- */
var viewing=null;
var detailClickers=[];
function kitsUsing(id){const out=[];KITS.forEach(k=>{const {a}=coverage(k);const st=kits[k.id]||{};const box=containerFor(k);const ids=new Set([...Object.values(a).filter(Boolean).map(i=>i.id),...(st.extras||[]),...(box?[box.id]:[])]);if(ids.has(id)||ridersOf(ids).some(i=>i.id===id))out.push(k)});return out}
function openDetail(i,quiet){
  if(!i)return;viewing=i;$("form").hidden=true;editing=null;
  const parent=itemById(i.mountedOn);const kids=live().filter(x=>x.mountedOn===i.id).sort(byName);
  const gun=itemById(i.forGun);const gunGear=i.category==="Firearms"?live().filter(x=>x.forGun===i.id&&x.mountedOn!==i.id).sort(byName):[];
  const ln=onLoan(i.id);const tasks=maintRows().filter(r=>r.m.itemId===i.id);const ks=kitsUsing(i.id);
  const isGun=i.category==="Firearms";
  const restricted=GearLogic.saleRestricted(i);
  const sess=isGun?L("sessions").filter(s=>(s.lines||[]).some(l=>l.firearmId===i.id)):[];
  const links=marketSourceText(i);
  const f=(label,val,sub,opt)=>(!val&&opt)?"":`<div><dt>${esc(label)}</dt><dd>${val||"—"}${sub?`<small>${sub}</small>`:""}</dd></div>`;
  const wt=i.weight!=null&&i.weight!==""?esc(fmtWt(i.weight)):lookingUp.has(i.id)?"Looking up…":lookupsOn()?(i.weightStatus==="notfound"?"Not found":"Pending"):"—";
  const priceState=restricted?(i.value?"Entered by you":""):lookingUp.has(i.id)?"Looking up…":/^estimate/i.test(i.priceNote||"")&&i.priceSource==="market"?`Estimate ${esc(i.priceDate||"")}`:(i.marketCheck==="requested"&&!window.LOOKUP_URL)?"Market check queued":i.priceSource==="market"?`Market check ${esc(i.priceDate||"")}`:i.priceSource==="manual"?"Entered by you":"";
  const canLookup=lookupsOn()&&(window.LOOKUP_URL||(!restricted&&i.marketCheck!=="requested"&&!isGun));
  $("detail").innerHTML=`
   <div class="dh"><div><h2>${esc(i.name)}${i.nick?` <span class="tag" style="font-size:.8rem">${esc(i.nick)}</span>`:""}</h2><div class="dsub">${esc([i.brand,i.color,i.category].filter(Boolean).join(" · "))}</div></div>
     <div class="vbtns"><button class="btn" type="button" data-dact="edit">Edit</button><button class="btn ghost" type="button" data-dact="share">Share</button>${canLookup?(lookingUp.has(i.id)?`<button class="btn ghost" type="button" disabled>Looking up…</button>`:`<button class="btn ghost" type="button" data-dact="mkt">${restricted||isGun?"Look up weight":"Market check"}</button>`):""}</div></div>
   <dl>
     ${f("Category",esc(i.category||""))}${f("Where it is",parent?`On <button class="lnk" type="button" data-dview="${esc(parent.id)}">${esc(parent.name)}</button>`:i.setupOn?esc(i.setupOn):"Spare (not set up on anything)")}${f("Quantity",esc(String(+i.qty||0)))}${f("Condition",esc((i.condition||"").replace("-"," ")))}
     ${f(restricted?"Insured value":"Value each",i.value?money(i.value):"",priceState)}${f("Total value",i.value?money((+i.value)*(+i.qty||1)):"")}${f("What I paid",i.paid?m2(i.paid):"",i.paid&&(+i.qty||1)>1?`${m2((+i.paid)*(+i.qty||1))} for all ${+i.qty}`:i.paid&&i.value&&!restricted?(+i.value>=+i.paid?`worth ${money(i.value-i.paid)} more now`:`worth ${money(i.paid-i.value)} less now`):"",1)}
     ${restricted?"":f("New retail",i.retailNew?money(i.retailNew):"","",1)+f("Used range",(i.usedLow||i.usedHigh)?`${money(i.usedLow)}–${money(i.usedHigh)}`:"","",1)}
     ${f("Weight each",wt,i.weightNote?esc(i.weightNote):i.weightSource==="manual"?"Entered by you":"")}${f("Stored at",esc(i.location||""))}
     ${f("Goes with",gun?`<button class="lnk" type="button" data-dview="${esc(gun.id)}">${esc(gun.name)}</button>`:"","",1)}
     
     ${isGun?f("Caliber",esc(i.caliber||""))+f("Rounds fired",roundsFired(i.id).toLocaleString(),sess.length?`${sess.length} logged session${sess.length>1?"s":""}`:""):""}
     ${f("On loan",ln?`${esc(ln.borrower)}`:"",ln?`since ${esc(fmtDate(ln.out))}${ln.due?` · due ${esc(fmtDate(ln.due))}`:""}`:"",1)}
   </dl>
   ${!restricted&&(i.priceNote||links)?`<div class="sect"><h3>Market data</h3>${i.priceNote?`<div class="note">${esc(i.priceNote)}</div>`:""}${links?`<div class="links" style="margin-top:6px">${links}</div>`:""}</div>`:""}
   ${armDetail(i)}
   ${i.lookupError&&!lookingUp.has(i.id)?`<div class="sect"><h3>${restricted?"Weight lookup":"Market check"}</h3><div class="note">Last lookup didn't work: ${esc(i.lookupError)}</div></div>`:""}
   ${kids.length?`<div class="sect"><h3>Mounted on this (${kids.length})</h3><div class="links">${kids.map(k=>`<button class="lnk" type="button" data-dview="${esc(k.id)}">${esc(k.name)}</button>`).join("")}</div></div>`:""}
   ${gunGear.length?`<div class="sect"><h3>Gear for this gun (${gunGear.length})</h3><div class="links">${gunGear.map(k=>`<button class="lnk" type="button" data-dview="${esc(k.id)}">${esc(k.name)}</button>`).join("")}</div></div>`:""}
   ${ks.length?`<div class="sect"><h3>Packed in kits (${ks.length})</h3><div class="links">${ks.map(k=>`<button class="lnk" type="button" data-dkit="${k.id}">${esc(k.name)}</button>`).join("")}</div></div>`:""}
   ${tasks.length?`<div class="sect"><h3>Maintenance</h3>${tasks.map(r=>`<div>${esc(r.m.task)} · <span class="pill ${r.status==="over"?"gap":r.status==="soon"?"warn":"ok"}">${r.status==="over"?"Overdue":r.status==="soon"?"Due soon":"OK"}</span> <small>${esc(r.txt)}</small></div>`).join("")}</div>`:""}
   ${i.notes?`<div class="sect"><h3>Notes</h3><div class="note">${esc(i.notes)}</div></div>`:""}`;
  const wasOpen=!$("detail").hidden;$("detail").hidden=false;if(!wasOpen||!quiet)resetSheetScroll("detailSheet");syncLock();
}
$("detail").addEventListener("click",async e=>{
  const b=e.target.closest("[data-dact],[data-dview],[data-dkit],[data-combine]");if(!b||!viewing)return;
  if(b.dataset.dview){openDetail(itemById(b.dataset.dview));return}
  if(b.dataset.dkit){curKit=b.dataset.dkit;closeDetail();showTab("kits");return}
  const a=b.dataset.dact;
  if(a==="close"){closeDetail();return}
  if(a==="edit"){openForm(viewing);return}
  if(a==="share"){openShare("item",viewing.id);return}
  if(a==="ser"){showSer=!showSer;openDetail(viewing,true);if(curTab==="arms")renderArms();return}
  if(a==="mkt"){const r=all.find(x=>x.id===viewing.id);if(!r)return;if(GearLogic.saleRestricted(r)&&!window.LOOKUP_URL){toast("Weight lookup needs a connection");return}if(window.LOOKUP_URL){const p=runLookups([r.id]);openDetail(r,true);await p;return}Object.assign(r,{marketCheck:"requested",marketCheckAt:now(),updatedAt:now()});render();await persist();openDetail(r);toast("Market check queued");return}
  if(window.detailClickers){for(const fn of detailClickers){if(await fn(b,e)===true)return}}
});

/* ---------- lookup API (instant prices + weights) ---------- */
async function apiLookup(list){
  const u=firebase.auth().currentUser;if(!u)throw new Error("Sign in first");
  const tok=await u.getIdToken();
  const r=await fetch(window.LOOKUP_URL.replace(/\/$/,"")+"/lookup",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+tok},body:JSON.stringify({items:list})});
  if(!r.ok){let m="";try{m=(await r.json()).error||""}catch{};throw new Error(m||("Lookup failed ("+r.status+")"))}
  return (await r.json()).results||[];
}
var lookupBody=i=>{const restricted=GearLogic.saleRestricted(i);return {id:i.id,name:i.name,brand:i.brand||"",category:i.category||"",condition:i.condition||"",color:i.color||"",notes:"",arm:i.arm||"",caliber:i.caliber||"",load:i.load||"",weightOnly:restricted}};
function applyLookup(id,res){
  const it=all.find(x=>x.id===id);if(!it||it.deleted||!res||!res.ok)return false;
  const n=v=>v==null||v===""||!isFinite(+v)?null:Math.round(+v);
  const restricted=GearLogic.saleRestricted(it);
  if(restricted){it.retailNew=0;delete it.usedLow;delete it.usedHigh;delete it.priceNote;it.marketSources=[];if(it.priceSource==="market")it.priceSource="manual"}
  else{
    if(n(res.retailNew)!=null)it.retailNew=n(res.retailNew);
    if(n(res.usedLow)!=null)it.usedLow=n(res.usedLow);
    if(n(res.usedHigh)!=null)it.usedHigh=n(res.usedHigh);
    if(n(res.value)!=null&&it.valueSource!=="manual")it.value=n(res.value);
    else if(it.valueSource!=="manual"&&it.retailNew&&n(res.value)==null)it.value=Math.round(it.retailNew*(FACTOR[it.condition]??0.6));
    it.priceSource="market";it.priceDate=today();it.priceNote=String(res.priceNote||"").slice(0,240);
    it.marketSources=(Array.isArray(res.sources)?res.sources:[]).filter(s=>/^https:\/\//.test(s?.url||"")).slice(0,4).map(s=>({label:String(s.label||"source").slice(0,40),url:s.url}));
  }
  if(res.weightOz!=null&&isFinite(+res.weightOz)&&+res.weightOz>0&&it.weightSource!=="manual"){it.weight=Math.round(+res.weightOz*10)/10;it.weightSource="lookup";it.weightStatus="done";it.weightNote=String(res.weightNote||"").slice(0,80)}
  else if(it.weight==null||it.weight==="")it.weightStatus="notfound";
  it.marketCheck="done";delete it.lookupError;it.updatedAt=now();
  if(!$("form").hidden&&editing&&editing.id===it.id){editing=it;$("fRetail").value=it.retailNew||"";if(!valueTouched)$("fVal").value=it.value||"";if(!$("fWt").value&&it.weight!=null)$("fWt").value=it.weight;showPrice(it)}
  return true;
}
async function runLookups(ids,quiet){
  if(!window.LOOKUP_URL||!cloudUser)return;
  ids=[...new Set(ids)].filter(id=>!lookingUp.has(id)&&all.some(i=>i.id===id&&!i.deleted));
  if(!ids.length)return;
  ids.forEach(id=>lookingUp.add(id));render();
  let ok=0,fail="";
  for(let k=0;k<ids.length;k+=4){
    const chunk=ids.slice(k,k+4);
    try{const res=await apiLookup(chunk.map(id=>lookupBody(all.find(i=>i.id===id))));res.forEach(r=>{if(applyLookup(r.id,r))ok++;else{const it=all.find(x=>x.id===r.id);if(it&&!it.deleted){it.lookupError=String(r.error||"No result").slice(0,160);fail=fail||it.lookupError}}})}
    catch(e){fail=e.message||"Lookup failed";chunk.forEach(id=>{const it=all.find(x=>x.id===id);if(it&&!it.deleted)it.lookupError=fail.slice(0,160)});if(/turned off|confirm your email|daily lookup limit/i.test(fail)){ids.slice(k).forEach(id=>lookingUp.delete(id));render();break}}
    chunk.forEach(id=>lookingUp.delete(id));render();await persist();
    if(viewing&&!$("detail").hidden&&chunk.includes(viewing.id))openDetail(all.find(i=>i.id===viewing.id),true);
  }
  if(!$("form").hidden&&editing){const busy=lookingUp.has(editing.id);$("mktBtn").disabled=busy;$("mktBtn").textContent=busy?"Looking up…":(GearLogic.saleRestricted(editing)?"Look up weight":"Market check")}
  if(fail)toast("Market check: "+fail,6000);else if(!quiet||ids.length>1)toast(`Looked up ${ok} item${ok===1?"":"s"}`);
}
var _saveCurrent=saveCurrent;
saveCurrent=async function(extra){
  const before=editing?{...editing}:null;const manualVal=valueTouched&&$("fVal").value!=="";
  const rec=await _saveCurrent(extra);if(!rec)return rec;
  if(manualVal&&(!before||+before.value!==+rec.value))rec.valueSource="manual";
  else if(!manualVal&&rec.valueSource==="manual"&&!$("fVal").value)delete rec.valueSource;
  if(rec.valueSource!==before?.valueSource)await persist();
  const restricted=GearLogic.saleRestricted(rec);
  if(restricted){
    let scrub=false;
    if(rec.retailNew){rec.retailNew=0;scrub=true}
    if(rec.usedLow!=null){delete rec.usedLow;scrub=true}
    if(rec.usedHigh!=null){delete rec.usedHigh;scrub=true}
    if(Array.isArray(rec.marketSources)&&rec.marketSources.length){rec.marketSources=[];scrub=true}
    if(rec.priceNote){delete rec.priceNote;scrub=true}
    if(rec.priceSource==="market"){rec.priceSource="manual";scrub=true}
    if(scrub)await persist();
  }
  const changed=!before||before.name!==rec.name||before.brand!==rec.brand||before.category!==rec.category||before.arm!==rec.arm||(!restricted&&before.condition!==rec.condition);
  const needs=restricted?(rec.weight==null||rec.weight===""):(rec.priceSource!=="market"||rec.weight==null||rec.weight==="");
  if(window.LOOKUP_URL&&cloudUser&&!extra&&(changed||needs))runLookups([rec.id],true);
  return rec;
};
if(window.LOOKUP_URL){
  $("mktBtn").onclick=async()=>{if(!$("form").reportValidity())return;const rec=await saveCurrent({});if(!rec)return;closeForm();formFrom=null;lookingUp.add(rec.id);openDetail(all.find(i=>i.id===rec.id),true);lookingUp.delete(rec.id);runLookups([rec.id])};
  $("bulkMktBtn").onclick=()=>{const ids=live().filter(i=>{const restricted=GearLogic.saleRestricted(i);if(restricted)return i.weight==null||i.weight==="";return i.priceSource!=="market"||i.weight==null||i.weight===""}).map(i=>i.id);if(!ids.length){toast("Everything already has prices and weights");return}toast(`Looking up ${ids.length} item${ids.length>1?"s":""}…`);runLookups(ids)};
  $("bulkMktBtn").textContent="Look up all";
  const _wish=ACT.wish;
  ACT.wish=async(act,b)=>{
    if(act!=="check"&&act!=="checkall")return _wish(act,b);
    const list=(act==="check"?db.wish.filter(w=>w.id===b.dataset.id):db.wish.filter(w=>!w.deleted&&w.status!=="got"&&w.priceSource!=="market")).filter(w=>w&&!GearLogic.saleRestricted(w));
    if(!list.length){toast("Nothing to price");return}
    toast(`Pricing ${list.length}…`);
    for(let k=0;k<list.length;k+=4){
      const chunk=list.slice(k,k+4);
      try{const res=await apiLookup(chunk.map(w=>({id:w.id,name:w.name,brand:w.brand||"",category:w.category||"",condition:"New",notes:"",kind:"wish",arm:w.arm||"",caliber:w.caliber||""})));
        res.forEach(r=>{const w=db.wish.find(x=>x.id===r.id);if(!w||!r.ok||GearLogic.saleRestricted(w))return;if(r.retailNew!=null)w.estPrice=Math.round(+r.retailNew);w.priceSource="market";w.priceDate=today();w.priceNote=String(r.priceNote||"").slice(0,240);w.marketSources=(r.sources||[]).filter(s=>/^https:\/\//.test(s?.url||"")).slice(0,4);w.marketCheck="done";w.updatedAt=now()})}
      catch(e){toast(e.message||"Pricing failed");break}
    }
    await persist();render();
  };
}

/* ---------- sheets, scroll lock, add button ---------- */
var lockY=0;
function anySheetOpen(){return !$("secSheet").hidden||!$("timerSheet").hidden||!$("drillSheet").hidden||!$("battSheet").hidden||!$("buildSheet").hidden||!$("moveSheet").hidden||!$("form").hidden||!$("detail").hidden||!$("swapSheet").hidden||!$("shareSheet").hidden||!!document.querySelector(".view:not([hidden]) .edSheet")}
function syncLock(){
  const want=anySheetOpen(),has=document.body.classList.contains("locked");
  if(want&&!has){lockY=window.scrollY;document.body.style.top=`-${lockY}px`;document.body.classList.add("locked")}
  else if(!want&&has){document.body.classList.remove("locked");document.body.style.top="";window.scrollTo(0,lockY)}
}
function resetSheetScroll(id){const sh=document.querySelector(`#${id} .sheet`);if(sh)sh.scrollTop=0}
function closeDetail(){$("detail").hidden=true;viewing=null;syncLock()}
document.addEventListener("click",e=>{
  const c=e.target.closest("[data-close]");if(!c)return;
  if(c.dataset.close==="form")cancelForm();else if(c.dataset.close==="detail")closeDetail();
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if(!$("drillSheet").hidden){drillEd=null;renderDrillEd();return}
  if(!$("timerSheet").hidden){closeTimer();return}
  if(!$("battSheet").hidden){battEdit=null;renderBattSheet();return}
  if(!$("buildSheet").hidden){buildFor=null;renderBuild();return}
  if(!$("moveSheet").hidden){moveState=null;renderMove();return}
  if(!$("shareSheet").hidden){shareState=null;renderShare();return}
  if(!$("swapSheet").hidden){swap=null;renderSwap();return}
  if(!$("form").hidden){cancelForm();return}
  if(!$("detail").hidden){closeDetail();return}
  if(curTab==="arms"&&armImport){armImport=null;renderArms();return}
  if(COLOF[curTab]&&ED[curTab]){ED[curTab]=null;renderExtra()}
});
$("fab").onclick=()=>{if(curTab==="arms")openArmForm();else if(curTab==="inv")openForm();else if(COLOF[curTab])openEd(curTab,NEWREC[curTab]?NEWREC[curTab]():{})};
var _showTab=showTab;
showTab=function(k){
  if(!$("form").hidden)closeForm();if(!$("detail").hidden)closeDetail();
  VIEWS.forEach(v=>{if(ED[v])ED[v]=null});
  _showTab(k);$("fab").hidden=!(curTab==="inv"||curTab==="arms"||COLOF[curTab]);syncLock();window.scrollTo(0,0);
};

