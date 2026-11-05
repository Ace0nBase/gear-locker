/* Plans: Free 10, Pro 100, Armory 500 lookups a month, plus the 100-lookup pack.
   Purchase buttons run only inside the native shell. The public site keeps working without them. */
var billingReady = false;

function nativePurchases() {
  try {
    var cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return null;
    if (cap.Plugins && cap.Plugins.Purchases) return cap.Plugins.Purchases;
    if (typeof cap.registerPlugin === "function") return cap.registerPlugin("Purchases");
  } catch (e) {}
  return null;
}

function billingKey() {
  return String(window.REVENUECAT_API_KEY || "").trim();
}

function billingIds() {
  var ids = window.GearLogic && GearLogic.BILLING_IDS;
  return ids || { pro: "warbox_pro", armory: "warbox_armory", pack: "warbox_lookups_100" };
}

function productKind(id) {
  var raw = String(id || "");
  if (window.GearLogic && typeof GearLogic.billingPlanForProductId === "function") {
    var plan = GearLogic.billingPlanForProductId(raw);
    if (plan) return plan;
  }
  var ids = billingIds();
  if (raw === ids.pack) return "pack";
  return "";
}

function packageProductId(pkg) {
  var product = pkg && (pkg.product || pkg.storeProduct) || {};
  return String(product.identifier || product.productIdentifier || pkg && pkg.identifier || "");
}

function packageList(offerings) {
  var current = offerings && (offerings.current || (offerings.offerings && offerings.offerings.current));
  var list = current && (current.availablePackages || current.available_packages) || [];
  return Array.isArray(list) ? list : [];
}

function durationName(pkg) {
  var kind = String(pkg && (pkg.packageType || pkg.package_type) || "").toUpperCase();
  if (kind === "MONTHLY" || kind === "MONTH") return "Monthly";
  if (kind === "ANNUAL" || kind === "YEARLY" || kind === "YEAR") return "Annual";
  return "";
}

function priceLabel(pkg) {
  var product = pkg && (pkg.product || pkg.storeProduct) || {};
  return String(product.priceString || product.price_string || "");
}

async function syncBillingUser() {
  var purchases = nativePurchases();
  var key = billingKey();
  if (!purchases || !key) return null;
  var user = window.firebase && firebase.auth && firebase.auth().currentUser;
  var uid = user && user.uid;
  if (!billingReady) {
    await purchases.configure(uid ? { apiKey: key, appUserID: uid } : { apiKey: key });
    billingReady = true;
  } else if (uid && typeof purchases.logIn === "function") {
    await purchases.logIn({ appUserID: uid });
  }
  return purchases;
}

async function loadOfferings() {
  var purchases = await syncBillingUser();
  if (!purchases || typeof purchases.getOfferings !== "function") return [];
  var offerings = await purchases.getOfferings();
  return packageList(offerings);
}

async function loadPlan() {
  try {
    if (!window.LOOKUP_URL || !window.firebase || !firebase.auth || !firebase.auth().currentUser) return null;
    var tok = await firebase.auth().currentUser.getIdToken();
    var r = await fetch(String(window.LOOKUP_URL).replace(/\/$/, "") + "/account/plan", {
      method: "POST",
      headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function planSentence(plan) {
  var limits = window.GearLogic && GearLogic.DEFAULT_PLAN_LIMITS || { free: 10, pro: 100, armory: 500 };
  var name = plan && plan.plan === "pro" || plan && plan.plan === "armory" ? plan.plan : "free";
  var title = name === "pro" ? "Pro" : name === "armory" ? "Armory" : "Free";
  var base = plan && plan.planLimit != null ? plan.planLimit : limits[name];
  var extra = plan && plan.packRemaining > 0 ? plan.packRemaining : 0;
  var line = title + " includes " + base + " lookups a month.";
  if (extra) line += " " + extra + " extra lookups from a pack are still unused.";
  return line;
}

function purchaseFailed(err) {
  var text = String(err && (err.message || err.errorMessage) || "");
  if (err && (err.userCancelled || err.userCanceled || /cancel/i.test(text))) return "";
  return "The purchase didn't go through. Try again.";
}

function buttonLabel(pkg) {
  var duration = durationName(pkg);
  var price = priceLabel(pkg);
  if (duration && price) return duration + " · " + price;
  if (duration) return duration;
  if (price) return price;
  return "Buy";
}

function renderPackages(block, packages, kind) {
  var rows = packages.filter(function (pkg) { return productKind(packageProductId(pkg)) === kind; });
  if (!rows.length) return "";
  return rows.map(function (pkg, i) {
    return `<button class="btn ghost" type="button" data-bill="buy" data-kind="${kind}" data-i="${i}">${esc(buttonLabel(pkg))}</button>`;
  }).join("");
}

async function renderBillingBlock() {
  var panel = document.querySelector("#secSheet .panel");
  if (!panel) return;
  var block = document.getElementById("planBlock");
  if (!block) {
    block = document.createElement("div");
    block.className = "secBlock";
    block.id = "planBlock";
    var about = Array.prototype.find.call(panel.querySelectorAll("h3"), function (h) { return h.textContent === "About"; });
    if (about && about.parentElement) about.parentElement.before(block);
    else panel.append(block);
  }
  var plan = await loadPlan();
  var packages = [];
  var native = !!nativePurchases() && !!billingKey();
  if (native) {
    try { packages = await loadOfferings(); }
    catch (e) { packages = []; }
  }
  block._packages = packages;
  var proButtons = native ? renderPackages(block, packages, "pro") : "";
  var armoryButtons = native ? renderPackages(block, packages, "armory") : "";
  var packButtons = native ? renderPackages(block, packages, "pack") : "";
  var trial = window.GearLogic && GearLogic.PRO_TRIAL_DAYS || 7;
  var storeNote = native ? "" : `<p class="hint">Subscriptions and lookup packs are sold in the War Box app.</p>`;
  var empty = native && !proButtons && !armoryButtons && !packButtons ? `<p class="hint">Plans aren't available in this build yet. You can keep using War Box.</p>` : "";
  block.innerHTML = `<h3>Plans</h3>
    <p class="hint">${esc(planSentence(plan))}</p>
    <p class="hint">Pro is ${window.GearLogic && GearLogic.DEFAULT_PLAN_LIMITS ? GearLogic.DEFAULT_PLAN_LIMITS.pro : 100} lookups a month and includes a ${trial}-day trial. Armory is ${window.GearLogic && GearLogic.DEFAULT_PLAN_LIMITS ? GearLogic.DEFAULT_PLAN_LIMITS.armory : 500} lookups a month. A pack adds 100 lookups that stay until you use them.</p>
    ${proButtons ? `<p class="hint">War Box Pro</p><div class="vbtns">${proButtons}</div>` : ""}
    ${armoryButtons ? `<p class="hint">War Box Armory</p><div class="vbtns">${armoryButtons}</div>` : ""}
    ${packButtons ? `<p class="hint">100 extra lookups</p><div class="vbtns">${packButtons}</div>` : ""}
    ${empty}
    ${storeNote}
    ${native ? `<button class="btn ghost" type="button" data-bill="restore">Restore purchases</button>` : ""}`;
}

async function buyPackage(kind, index) {
  var block = document.getElementById("planBlock");
  var packages = (block && block._packages || []).filter(function (pkg) { return productKind(packageProductId(pkg)) === kind; });
  var picked = packages[index];
  if (!picked) return;
  try {
    var purchases = await syncBillingUser();
    if (!purchases || typeof purchases.purchasePackage !== "function") {
      toast("Purchases aren't available in this build yet.");
      return;
    }
    await purchases.purchasePackage({ aPackage: picked });
    toast("You're set. New lookups use the allowance on this account.");
    await renderBillingBlock();
  } catch (err) {
    var msg = purchaseFailed(err);
    if (msg) toast(msg, 5000);
  }
}

async function restorePurchases() {
  try {
    var purchases = await syncBillingUser();
    if (!purchases || typeof purchases.restorePurchases !== "function") {
      toast("Purchases aren't available in this build yet.");
      return;
    }
    await purchases.restorePurchases();
    toast("Purchases restored.");
    await renderBillingBlock();
  } catch (err) {
    var msg = purchaseFailed(err);
    if (msg) toast(msg, 5000);
  }
}

document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-bill]");
  if (!b) return;
  if (b.dataset.bill === "buy") buyPackage(b.dataset.kind, +b.dataset.i);
  if (b.dataset.bill === "restore") restorePurchases();
});

if (typeof openSecurity === "function") {
  var _openSecurityBilling = openSecurity;
  openSecurity = async function () {
    await _openSecurityBilling.apply(this, arguments);
    try { await renderBillingBlock(); } catch (e) {}
  };
}

if (typeof beginSignOut === "function") {
  var _beginSignOutBilling = beginSignOut;
  beginSignOut = async function (forced) {
    try {
      var purchases = nativePurchases();
      if (purchases && billingReady && typeof purchases.logOut === "function") await purchases.logOut();
    } catch (e) {}
    billingReady = false;
    return _beginSignOutBilling.apply(this, arguments);
  };
}
