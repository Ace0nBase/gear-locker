// On-device import screen. File bytes stay in memory until this sheet closes.
import {
  FIELD_LABELS, LIMITS, confidenceLabel, headerHash, loadMaps, mapColumns,
  maskSerial, serialAriaLabel, planImport, readImportFile, rememberMap, summaryLine, undoImportState,
  changedAfterImport, escapeSaveReport, loadHistory, saveHistory, undoOpen, countPlan, chunk, WRITE_BATCH,
} from "./import-engine.js";

const PRIVACY = "Your file is read on this phone. Nothing is uploaded until you save, and then only to your own account.";
const PHOTO_PRIVACY = "The photo is read on this phone. Nothing is uploaded until you save, and then only to your own account.";
const SOURCE_LABEL = {
  myarmory: "My Armory",
  armscache: "myArmsCache",
  guntrack: "GUNTRACK",
  generic: "a spreadsheet",
};
const STEP_META = [
  { n: 1, name: "File", steps: ["pick", "detected"] },
  { n: 2, name: "Columns", steps: ["columns"] },
  { n: 3, name: "Where", steps: ["where"] },
  { n: 4, name: "Preview", steps: ["preview"] },
  { n: 5, name: "Save", steps: ["summary"] },
];
const FIELDS = Object.keys(FIELD_LABELS);

const S = blank();

function blank() {
  return {
    step: "pick",
    confirm: false,
    files: [],
    tables: [],
    active: 0,
    choices: {},
    targets: {},
    rowTargets: {},
    rowCategories: {},
    rowDecisions: {},
    rowFixes: {},
    dateOrders: {},
    included: {},
    showMatched: {},
    showSerials: false,
    filter: "all",
    previewFrom: 0,
    importId: "",
    error: null,
    reading: "",
    saving: false,
    cancelSave: false,
    saveProgress: null,
    savedId: "",
    worker: null,
    camera: null,
  };
}

function el(tag, opts, children) {
  const node = document.createElement(tag);
  const o = opts || {};
  if (o.className) node.className = o.className;
  if (o.text != null) node.textContent = o.text;
  if (o.attrs) {
    Object.entries(o.attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "hidden") node.hidden = !!v;
      else node.setAttribute(k, v === true ? "" : String(v));
    });
  }
  if (o.on) Object.entries(o.on).forEach(([k, fn]) => node.addEventListener(k, fn));
  (children || []).forEach(ch => { if (ch) node.append(ch); });
  return node;
}

function categories() {
  const base = (typeof CATS !== "undefined" ? CATS : []).slice();
  ["Magazines & Belts", "Triggers & Parts", "Ammo Storage & Loaders", "Ammunition", "Reloading", "Lower receiver"].forEach(name => {
    if (!base.includes(name)) base.push(name);
  });
  return base;
}

function sheet() { return document.getElementById("importSheet"); }
function body() { return document.getElementById("importBody"); }

function openSheet() {
  const sh = sheet();
  if (!sh) return;
  sh.hidden = false;
  if (typeof syncLock === "function") syncLock();
  const sc = sh.querySelector(".sheet");
  if (sc) sc.scrollTop = 0;
}

function closeSheet() {
  stopWorker();
  stopCamera();
  S.files = [];
  S.tables = [];
  const sh = sheet();
  if (sh) sh.hidden = true;
  if (typeof syncLock === "function") syncLock();
}

function discard() {
  S.confirm = false;
  S.step = "pick";
  closeSheet();
}

function stopWorker() {
  if (S.worker) {
    try { S.worker.terminate(); } catch { /* already gone */ }
    S.worker = null;
  }
}

function stopCamera() {
  if (S.camera) {
    try { S.camera.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    S.camera = null;
  }
}

function openPick() {
  Object.assign(S, blank());
  S.importId = "";
  S.step = "pick";
  openSheet();
  paint();
}

function openScan() {
  Object.assign(S, blank());
  S.step = "scan";
  openSheet();
  paint();
}

function askClose() {
  if (S.step === "done" || S.step === "scan") { discard(); return; }
  S.confirm = true;
  paint();
}

function go(step) {
  S.confirm = false;
  S.step = step;
  if (step === "preview" || step === "summary") S.previewFrom = 0;
  paint();
}

function flatFromFiles() {
  const tables = [];
  S.files.forEach(file => {
    (file.result.tables || []).forEach(table => {
      tables.push({ ...table, fileName: file.name });
    });
  });
  S.tables = tables;
  const maps = loadMaps(localStorage);
  tables.forEach((table, ti) => {
    const saved = maps[headerHash(table.columns.map(c => c.key))];
    if (!Array.isArray(saved)) return;
    S.choices[ti] = S.choices[ti] || {};
    table.columns.forEach((col, i) => {
      if (col.locked || !saved[i]) return;
      S.choices[ti][col.index] = saved[i];
      col.usedLastTime = true;
    });
  });
}

function tablesForPlan() {
  return S.tables.map((table, i) => ({
    ...table,
    included: S.included[i] != null ? S.included[i] : table.included !== false,
    dateOrder: S.dateOrders[i] || table.dateOrder,
  }));
}

function currentPlan() {
  if (!S.importId) S.importId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  return planImport(tablesForPlan(), {
    items: typeof all !== "undefined" ? all : [],
    ammo: typeof db !== "undefined" && db.ammo ? db.ammo : [],
    now: new Date().toISOString(),
    importId: S.importId,
    categories: categories(),
    columnChoices: S.choices,
    targets: S.targets,
    rowTargets: S.rowTargets,
    rowCategories: S.rowCategories,
    rowDecisions: S.rowDecisions,
    rowFixes: S.rowFixes,
    dateOrders: S.dateOrders,
  });
}

function fieldOf(table, ti, col) {
  const choice = S.choices[ti] && S.choices[ti][col.index];
  return choice || col.field || "ignore";
}

function sepLabel(sep) {
  if (sep === "\t") return "tab";
  if (sep === ",") return "comma";
  if (sep === ";") return "semicolon";
  if (sep === "|") return "pipe";
  return sep ? "custom" : "";
}

async function parseOne(file, encoding) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  try {
    const result = await new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker("js/import-worker.js", { type: "module" }); }
      catch (err) { reject(err); return; }
      S.worker = worker;
      const timer = setTimeout(() => { stopWorker(); reject(new Error("slow")); }, 120000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        stopWorker();
        resolve(event.data && event.data.result);
      };
      worker.onerror = () => { clearTimeout(timer); stopWorker(); reject(new Error("worker")); };
      const copy = bytes.slice().buffer;
      worker.postMessage({ id: file.name, name: file.name, encoding: encoding || "", bytes: copy }, [copy]);
    });
    if (result) return result;
  } catch { /* main-thread fallback below */ }
  return readImportFile(bytes, { name: file.name, encoding: encoding || "" });
}

async function takeFiles(list) {
  const files = [...list].filter(Boolean);
  if (!files.length) return;
  S.files = [];
  S.error = null;
  S.reading = files.length > 1 ? `Reading 1 of ${files.length}` : "Reading the file";
  paint();
  const kept = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > LIMITS.fileBytes) {
      S.error = { code: "too-big", limit: "file", name: file.name };
      S.step = "huge";
      S.reading = "";
      paint();
      return;
    }
    S.reading = files.length > 1 ? `Reading ${i + 1} of ${files.length}` : "Reading the file";
    paint();
    const result = await parseOne(file, "");
    if (!result || !result.ok) {
      if (!kept.length) {
        S.error = { ...(result || { code: "unsupported" }), name: file.name };
        S.step = result && result.code === "too-big" ? "huge" : "error";
        S.reading = "";
        paint();
        return;
      }
      continue;
    }
    kept.push({ file, name: file.name, result });
  }
  S.reading = "";
  S.files = kept;
  if (!kept.length) { S.step = "error"; S.error = { code: "empty" }; paint(); return; }
  flatFromFiles();
  S.step = "detected";
  paint();
}

async function reparse(index, encoding) {
  const entry = S.files[index];
  if (!entry) return;
  S.reading = "Reading the file";
  paint();
  const result = await parseOne(entry.file, encoding);
  S.reading = "";
  if (!result || !result.ok) {
    S.error = { ...(result || { code: "unsupported" }), name: entry.name };
    S.step = result && result.code === "too-big" ? "huge" : "error";
    paint();
    return;
  }
  entry.result = result;
  S.choices = {};
  flatFromFiles();
  paint();
}

function setSource(ti, source) {
  const table = S.tables[ti];
  if (!table) return;
  const headers = table.columns.map(col => col.dup > 1 ? col.header.replace(/\s+\(\d+\)$/, "") : col.header);
  const mapped = mapColumns(headers, { source });
  table.source = mapped.source;
  table.columns = mapped.columns;
  delete S.choices[ti];
  paint();
}

function paint() {
  const root = body();
  if (!root) return;
  root.replaceChildren();
  const back = document.querySelector("#importSheet .importBack");
  if (back) back.hidden = S.step === "done" || S.confirm;
  if (S.confirm) { root.append(confirmView()); return; }
  const meta = STEP_META.find(row => row.steps.includes(S.step));
  if (meta) root.append(el("p", { className: "stepper", text: `IMPORT · STEP ${meta.n} OF 5 · ${meta.name}` }));
  if (S.reading) root.append(el("p", { className: "privacy", text: S.reading }));
  const view = {
    pick: pickView,
    detected: detectedView,
    columns: columnsView,
    where: whereView,
    preview: previewView,
    summary: summaryView,
    done: doneView,
    error: errorView,
    huge: hugeView,
    scan: scanView,
  }[S.step] || pickView;
  root.append(view());
}

function confirmView() {
  return el("div", { className: "confirmBox" }, [
    el("h2", { text: "Stop importing?" }),
    el("p", { text: "Nothing has been saved." }),
    el("div", { className: "actions" }, [
      el("button", { className: "btn ghost", text: "Keep going", attrs: { type: "button", "data-import": "keep" } }),
      el("button", { className: "btn", text: "Stop", attrs: { type: "button", "data-import": "stop" } }),
    ]),
  ]);
}

function pickView() {
  const box = el("div", {}, [
    el("h2", { text: "Import a file" }),
    el("p", { className: "privacy", text: PRIVACY }),
    el("div", { className: "drop" }, [
      el("p", { text: "Choose a CSV, TSV, text, XLSX, or JSON file. You can pick more than one list." }),
      el("button", { className: "btn", text: "Choose a file", attrs: { type: "button", "data-import": "browse" } }),
    ]),
    el("h3", { text: "Works with" }),
  ]);
  const list = el("ul", { className: "works" });
  [
    ["My Armory", "Data management → CSV Data Management, then export CSV. Backup files are encrypted and can't be read."],
    ["myArmsCache", "Settings → Export CSV. One list per file."],
    ["GUNTRACK", "Menu → Export/Import Data → JSON or XLSX."],
  ].forEach(([name, how]) => {
    list.append(el("li", {}, [el("b", { text: name }), el("span", { text: how })]));
  });
  box.append(list);
  box.append(el("button", { className: "btn ghost", text: "Scan a printed sheet", attrs: { type: "button", "data-import": "scan" } }));
  return box;
}

function detectedView() {
  const box = el("div");
  const first = S.tables[0];
  const label = SOURCE_LABEL[first && first.source] || SOURCE_LABEL.generic;
  box.append(el("h2", { text: first && first.source !== "generic" ? `Looks like a ${label} export` : "Looks like a spreadsheet" }));
  box.append(el("p", { className: "privacy", text: PRIVACY }));
  S.files.forEach((file, fi) => {
    (file.result.tables || []).forEach(table => {
      const bits = [`${table.grid.length} rows`, `${table.columns.length} columns`];
      if (table.encoding) bits.push(table.encoding);
      if (table.separator) bits.push(sepLabel(table.separator));
      if (table.headerRow > 1) bits.push(`Started at row ${table.headerRow}`);
      box.append(el("div", { className: "card" }, [
        el("b", { text: file.name || "File" }),
        el("div", { text: table.name && table.name !== "Sheet" ? table.name : "Sheet" }),
        el("p", { text: bits.join(" · ") }),
        ...(table.warnings || []).map(w => el("p", { className: "pill warn", text: w })),
        table.blanks ? el("p", { text: `${table.blanks} blank rows skipped` }) : null,
        table.formulaBlanks ? el("p", { text: `${table.formulaBlanks} formula without a value` }) : null,
      ]));
    });
    const enc = el("label", { text: "Text encoding " });
    const sel = el("select", { attrs: { "aria-label": "Text encoding", "data-import": "encoding", "data-file": String(fi) } });
    [["", "Detected"], ["utf-8", "UTF-8"], ["windows-1252", "Windows-1252"], ["mac", "Mac Roman"]].forEach(([value, name]) => {
      const opt = el("option", { text: name, attrs: { value } });
      sel.append(opt);
    });
    enc.append(sel);
    box.append(enc);
  });
  const src = el("label", { text: "Change source " });
  const sourceSel = el("select", { attrs: { "aria-label": "Change source", "data-import": "source", "data-table": "0" } });
  [["", "Keep detected"], ["generic", "Generic"], ["myarmory", "My Armory"], ["armscache", "myArmsCache"], ["guntrack", "GUNTRACK"]].forEach(([value, name]) => {
    sourceSel.append(el("option", { text: name, attrs: { value } }));
  });
  src.append(sourceSel);
  box.append(src);
  box.append(el("div", { className: "actions" }, [
    el("button", { className: "btn", text: "Check columns", attrs: { type: "button", "data-import": "goto", "data-step": "columns" } }),
  ]));
  return box;
}

function columnsView() {
  const box = el("div");
  box.append(el("h2", { text: "Columns" }));
  if (S.tables.length > 1) box.append(sheetChips());
  const ti = Math.min(S.active, Math.max(0, S.tables.length - 1));
  const table = S.tables[ti];
  if (!table) { box.append(el("p", { text: "No table." })); return box; }
  const cols = table.columns.map(col => ({ ...col, field: fieldOf(table, ti, col) }));
  const check = cols.filter(c => !c.locked && (c.confidence === "mid" || c.confidence === "lo" || c.suggest));
  const matched = cols.filter(c => !c.locked && c.field !== "ignore" && !check.includes(c));
  const left = cols.filter(c => c.locked || c.field === "ignore");
  box.append(el("h3", { text: "Check these" }));
  box.append(columnList(check, ti, table));
  box.append(el("h3", { text: "Matched" }));
  const shown = S.showMatched[ti] ? matched : matched.slice(0, 4);
  box.append(columnList(shown, ti, table));
  if (matched.length > 4) {
    box.append(el("button", {
      className: "btn ghost",
      text: S.showMatched[ti] ? "Show fewer" : `Show ${matched.length - 4} more`,
      attrs: { type: "button", "data-import": "more-matched", "data-table": String(ti) },
    }));
  }
  box.append(el("h3", { text: "Left out" }));
  box.append(columnList(left, ti, table));
  const acquired = cols.find(c => c.field === "acquired");
  if (acquired) {
    const order = S.dateOrders[ti] || table.dateOrder || "mdy";
    box.append(el("p", { text: order === "dmy" ? "Read as day/month/year" : "Read as month/day/year" }));
    box.append(el("button", {
      className: "btn ghost",
      text: order === "dmy" ? "Switch to month/day/year" : "Switch to day/month/year",
      attrs: { type: "button", "data-import": "date-order", "data-table": String(ti) },
    }));
  }
  if (table.hidden) {
    const on = S.included[ti] != null ? S.included[ti] : false;
    box.append(el("button", {
      className: "btn ghost",
      text: on ? "Hidden sheet is included" : "Include this hidden sheet",
      attrs: { type: "button", "data-import": "include", "data-table": String(ti) },
    }));
  }
  box.append(el("div", { className: "actions" }, [
    el("button", { className: "btn", text: "Choose where they go", attrs: { type: "button", "data-import": "goto", "data-step": "where" } }),
  ]));
  return box;
}

function columnList(cols, ti, table) {
  const wrap = el("div", { className: "cols" });
  if (!cols.length) wrap.append(el("p", { className: "privacy", text: "None" }));
  cols.forEach(col => {
    const conf = col.locked ? "lock" : (col.confidence || "lo");
    const row = el("div", { className: "card colMap" }, [
      el("div", {}, [
        el("b", { text: col.header || "Column" }),
        el("div", { className: `conf ${conf}`, text: confidenceLabel(conf) }),
        col.usedLastTime ? el("div", { text: "Used last time" }) : null,
      ]),
    ]);
    const sel = el("select", {
      attrs: {
        "aria-label": `Field for ${col.header || "column"}`,
        "data-import": "field",
        "data-table": String(ti),
        "data-col": String(col.index),
        disabled: col.locked ? "disabled" : null,
      },
    });
    FIELDS.forEach(id => {
      const opt = el("option", { text: FIELD_LABELS[id], attrs: { value: id } });
      if ((col.locked ? "ignore" : col.field) === id) opt.selected = true;
      sel.append(opt);
    });
    row.append(sel);
    wrap.append(row);
  });
  return wrap;
}

function sheetChips() {
  const row = el("div", { className: "sheetSel" });
  S.tables.forEach((table, ti) => {
    row.append(el("button", {
      className: "chip",
      text: table.fileName || table.name || `Sheet ${ti + 1}`,
      attrs: { type: "button", "data-import": "sheet", "data-table": String(ti), "aria-pressed": ti === S.active ? "true" : "false" },
    }));
  });
  return row;
}

function whereView() {
  const box = el("div");
  box.append(el("h2", { text: "Where they go" }));
  S.tables.forEach((table, ti) => {
    const target = S.targets[ti] || (table.defaultTarget && table.defaultTarget !== "needs" ? table.defaultTarget : "");
    const card = el("div", { className: "card" }, [
      el("b", { text: table.fileName || table.name || `Sheet ${ti + 1}` }),
      segmented(target, ti),
    ]);
    box.append(card);
  });
  const plan = currentPlan();
  const moved = plan.rows.filter(row => row.moved && !row.skipped);
  box.append(el("h3", { text: "Handled differently" }));
  if (!moved.length) box.append(el("p", { className: "privacy", text: "Every row follows its file." }));
  moved.slice(0, 40).forEach(row => {
    box.append(el("div", { className: "card" }, [
      el("b", { text: row.name || "Row" }),
      el("div", { text: targetLabel(row.target) + (row.gearArmory ? " + Armory" : "") }),
      segmented(row.target, row.table, row.row),
    ]));
  });
  box.append(el("div", { className: "actions" }, [
    el("button", { className: "btn", text: "Preview", attrs: { type: "button", "data-import": "goto", "data-step": "preview" } }),
  ]));
  return box;
}

function segmented(current, ti, ri) {
  const row = el("div", { className: "seg" });
  [["armory", "Armory"], ["gear", "Gear"], ["ammo", "Ammo"]].forEach(([id, label]) => {
    row.append(el("button", {
      text: label,
      attrs: {
        type: "button",
        "data-import": ri == null ? "target" : "row-target",
        "data-table": String(ti),
        "data-row": ri == null ? null : String(ri),
        "data-target": id,
        "aria-pressed": current === id ? "true" : "false",
      },
    }));
  });
  return row;
}

function targetLabel(id) {
  return id === "armory" ? "Armory" : id === "ammo" ? "Ammo" : id === "gear" ? "Gear" : id === "needs" ? "Needs a category" : "Skip";
}

function previewView() {
  const plan = currentPlan();
  const box = el("div");
  box.append(el("h2", { text: "Preview" }));
  const counts = plan.counts;
  const tally = el("div", { className: "tally" });
  [["firearms", "Firearms"], ["gear", "Gear"], ["ammo", "Ammo lots"], ["needs", "Needs a category"], ["skipped", "Skipped"]].forEach(([key, label]) => {
    tally.append(el("div", {}, [el("b", { text: String(counts[key] || 0) }), el("div", { text: label })]));
  });
  box.append(tally);
  const filters = el("div", { className: "chips" });
  [["all", "All"], ["needs", "Needs a category"], ["look", "Needs a look"], ["armory", "Armory"], ["gear", "Gear"], ["ammo", "Ammo"]].forEach(([id, label]) => {
    filters.append(el("button", {
      className: "chip",
      text: label,
      attrs: { type: "button", "data-import": "filter", "data-filter": id, "aria-pressed": S.filter === id ? "true" : "false" },
    }));
  });
  box.append(filters);
  box.append(el("button", {
    className: "btn ghost",
    text: S.showSerials ? "Hide serials" : "Show serials",
    attrs: { type: "button", "data-import": "serials" },
  }));
  if ((counts.needs || 0) > 0) box.append(categorySelect(null, true));
  let rows = plan.rows;
  if (S.filter === "look") rows = rows.filter(r => (r.problems && r.problems.length) || r.duplicate);
  else if (S.filter !== "all") rows = rows.filter(r => r.target === S.filter);
  const slice = rows.slice(S.previewFrom, S.previewFrom + 60);
  slice.forEach(row => box.append(previewCard(row)));
  if (rows.length > S.previewFrom + 60) {
    box.append(el("button", { className: "btn ghost", text: "Show the next 60", attrs: { type: "button", "data-import": "more-rows" } }));
  }
  box.append(el("div", { className: "actions" }, [
    el("button", { className: "btn", text: "Review save", attrs: { type: "button", "data-import": "goto", "data-step": "summary" } }),
  ]));
  return box;
}

function previewCard(row) {
  const flag = (row.problems && row.problems.length) || row.duplicate;
  const card = el("div", { className: `card rowCard${row.duplicate ? " dupe" : flag ? " flag" : ""}` });
  card.append(el("b", { text: row.name || "Imported item", attrs: { dir: "auto" } }));
  card.append(el("div", { text: [targetLabel(row.target), row.gearArmory ? "Gear + Armory" : "", row.category || ""].filter(Boolean).join(" · ") }));
  if (row.serial) {
    const masked = !(S.showSerials || (row.duplicate && row.duplicate.kind === "serial"));
    const shown = masked ? (row.serialMasked || maskSerial(row.serial)) : row.serial;
    card.append(el("div", {
      className: "mono",
      text: shown,
      attrs: { dir: "auto", "aria-label": serialAriaLabel(row.serial, masked) },
    }));
  }
  if (row.target === "needs") card.append(categorySelect(row, false));
  if (row.paid != null) card.append(el("div", { text: `What I paid ${moneyPaid(row.paid)}` }));
  (row.problems || []).forEach(p => card.append(el("span", { className: "pill warn", text: p.message || "Needs a look" })));
  if (row.duplicate) {
    const dup = row.duplicate;
    card.append(el("p", { text: dup.kind === "possible" ? "Possible duplicate" : "Already in War Box" }));
    if (dup.serial) card.append(el("div", { className: "mono", text: dup.serial, attrs: { dir: "auto" } }));
    const choice = row.decision || "skip";
    const bar = el("div", { className: "seg" });
    [["skip", "Skip"], ["merge", "Merge"], ["add", "Add anyway"]].forEach(([id, label]) => {
      bar.append(el("button", {
        text: label,
        attrs: {
          type: "button",
          "data-import": "decision",
          "data-table": String(row.table),
          "data-row": String(row.row),
          "data-decision": id,
          "aria-pressed": choice === id ? "true" : "false",
        },
      }));
    });
    card.append(bar);
  }
  const serialProblem = (row.problems || []).some(p => p.kind === "serial");
  if (serialProblem) {
    card.append(textFix(row, "serial", "Serial number"));
    card.append(el("button", {
      className: "btn ghost",
      text: "Later",
      attrs: { type: "button", "data-import": "later", "data-table": String(row.table), "data-row": String(row.row) },
    }));
  }
  if ((row.problems || []).some(p => p.kind === "date")) card.append(textFix(row, "acquired", "Date acquired", "date"));
  if ((row.problems || []).some(p => p.kind === "caliber")) {
    card.append(textFix(row, "caliber", "Caliber"));
    card.append(el("button", {
      className: "btn ghost",
      text: "Skip row",
      attrs: { type: "button", "data-import": "skip-row", "data-table": String(row.table), "data-row": String(row.row) },
    }));
  }
  return card;
}

function categorySelect(row, bulk) {
  const sel = el("select", {
    attrs: {
      "aria-label": bulk ? "Set category for all that need one" : `Category for ${row.name || "row"}`,
      "data-import": bulk ? "bulk-category" : "row-category",
      "data-table": bulk ? null : String(row.table),
      "data-row": bulk ? null : String(row.row),
    },
  });
  sel.append(el("option", { text: bulk ? "Set category for all that need one" : "Choose a category", attrs: { value: "" } }));
  categories().forEach(name => {
    const opt = el("option", { text: name, attrs: { value: name } });
    if (!bulk && S.rowCategories[row.table] && S.rowCategories[row.table][row.row] === name) opt.selected = true;
    sel.append(opt);
  });
  return sel;
}

function textFix(row, key, label, type) {
  const current = (S.rowFixes[row.table] && S.rowFixes[row.table][row.row] && S.rowFixes[row.table][row.row][key]) || "";
  const input = el("input", {
    attrs: {
      type: type || "text",
      dir: "auto",
      "aria-label": label,
      "data-import": "fix",
      "data-table": String(row.table),
      "data-row": String(row.row),
      "data-key": key,
      value: current,
    },
  });
  return el("label", {}, [el("span", { text: label }), input]);
}

function moneyPaid(n) {
  const v = Math.round(+n * 100) / 100;
  return "$" + (isFinite(v) ? v.toFixed(2) : "0.00");
}

function summaryView() {
  const plan = currentPlan();
  const counts = countPlan(plan.rows);
  const box = el("div", {}, [
    el("h2", { text: "Save" }),
    el("p", { text: summaryLine(counts) }),
    el("p", { text: "No automatic prices. What I paid is the number from your file, saved as entered by you." }),
    el("ul", { className: "check" }, [
      el("li", { text: "Duplicates stay skipped unless you chose otherwise." }),
      el("li", { text: "Purchase prices go to What I paid and are marked manual." }),
      el("li", { text: "No store links or price alerts are added." }),
      el("li", { text: "Restricted categories are not priced automatically." }),
    ]),
    el("p", { className: "privacy", text: PRIVACY }),
  ]);
  const total = counts.total || 0;
  const progress = S.saveProgress || { done: 0, total };
  const btn = el("button", {
    className: "btn",
    text: S.saving ? `Saving ${progress.done} of ${progress.total}…` : `Import ${total} item${total === 1 ? "" : "s"}`,
    attrs: { type: "button", "data-import": "save", disabled: total && !S.saving ? null : "disabled" },
  });
  const actions = [btn];
  if (S.saving) {
    actions.push(el("button", {
      className: "btn ghost",
      text: "Undo",
      attrs: { type: "button", "data-import": "undo", "data-id": S.importId },
    }));
  }
  if (counts.needs) box.append(el("p", { text: `${counts.needs} still need a category. Pick one in the preview before they can be saved.` }));
  box.append(el("div", { className: "actions" }, actions));
  return box;
}

function doneView() {
  const row = loadHistory(localStorage).find(item => item.id === S.savedId);
  const total = row && row.counts ? row.counts.total || 0 : 0;
  return el("div", {}, [
    el("h2", { text: `${total} item${total === 1 ? "" : "s"} imported` }),
    el("p", { text: "Undo stays available for 24 hours, including after you reopen War Box. Import history is in Security." }),
    el("div", { className: "actions" }, [
      el("button", { className: "btn", text: "Done", attrs: { type: "button", "data-import": "stop" } }),
    ]),
  ]);
}

function errorText(err) {
  const code = err && err.code;
  if (code === "encrypted-backup") return "My Armory backups are encrypted. Open Data management, then CSV Data Management, and export a CSV. War Box can't read the backup file.";
  if (code === "encrypted-workbook") return "This workbook is password-protected. Save it as CSV or xlsx without a password, then try again.";
  if (code === "binary") return "This doesn't look like a spreadsheet.";
  if (code === "not-workbook") return "This isn't a spreadsheet workbook.";
  if (code === "partial") return (err && err.message) || "A quote was left open.";
  if (code === "empty") return "That file has no rows to import.";
  if (code === "encoding") return "Couldn't read the text in this file.";
  if (err && err.message) return err.message;
  return "War Box can't read this file. Save it as CSV or xlsx and try again.";
}

function errorView() {
  return el("div", {}, [
    el("h2", { text: "Can't read this file" }),
    el("p", { text: errorText(S.error) }),
    el("div", { className: "actions" }, [
      el("button", { className: "btn", text: "Choose another file", attrs: { type: "button", "data-import": "goto", "data-step": "pick" } }),
    ]),
  ]);
}

function hugeView() {
  const limit = S.error && S.error.limit;
  const why = limit === "rows" ? "It has more than 20,000 rows."
    : limit === "columns" ? "It has more than 64 columns."
    : limit === "uncompressed" ? "The spreadsheet expands too far to open safely."
    : "It is over 15 MB.";
  return el("div", {}, [
    el("h2", { text: "This file is too big" }),
    el("p", { text: `${why} Split it into smaller files and import those.` }),
    el("p", { className: "privacy", text: PRIVACY }),
    el("div", { className: "actions" }, [
      el("button", { className: "btn", text: "Choose another file", attrs: { type: "button", "data-import": "goto", "data-step": "pick" } }),
    ]),
  ]);
}

function scanView() {
  const box = el("div", {}, [
    el("h2", { text: "Scan a printed sheet" }),
    el("p", { className: "privacy", text: PHOTO_PRIVACY }),
    el("p", { text: "Not saved to your photos. The camera opens only after you tap the button. The picture stays on this phone and is dropped when you leave." }),
  ]);
  const video = el("video", { className: "scanVideo", attrs: { playsinline: "true", autoplay: "true", muted: "true" } });
  video.hidden = !S.camera;
  box.append(video);
  if (S.camera) video.srcObject = S.camera;
  box.append(el("button", {
    className: "btn",
    text: S.camera ? "Camera is on" : "Open camera",
    attrs: { type: "button", "data-import": "camera", disabled: S.camera ? "disabled" : null },
  }));
  box.append(el("p", { text: "Reading the printed boxes on this phone is not available in this version. Nothing is sent off the phone." }));
  return box;
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (typeof toast === "function") toast("This phone has no camera War Box can open.");
    return;
  }
  try {
    S.camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    paint();
  } catch {
    if (typeof toast === "function") toast("The camera stayed off.");
  }
}

async function saveImport() {
  if (S.saving) return;
  const plan = currentPlan();
  const total = plan.counts.total || 0;
  if (!total) return;
  S.saving = true;
  S.cancelSave = false;
  S.saveProgress = { done: 0, total };
  S.plan = plan;
  paint();
  const at = plan.at || new Date().toISOString();
  const jobs = [
    ...(plan.items || []).map(doc => ({ kind: "item", doc })),
    ...(plan.ammo || []).map(doc => ({ kind: "ammo", doc })),
    ...(plan.merges || []).map(merge => ({ kind: "merge", merge })),
  ];
  saveHistory(localStorage, { id: plan.importId, at, counts: plan.counts, status: "saving", progress: S.saveProgress });
  const parts = chunk(jobs, WRITE_BATCH);
  for (const part of parts) {
    if (S.cancelSave) break;
    part.forEach(entry => {
      if (entry.kind === "item") all.push(entry.doc);
      else if (entry.kind === "ammo") db.ammo.push(entry.doc);
      else {
        const list = entry.merge.collection === "ammo" ? db.ammo : all;
        const row = list.find(item => item.id === entry.merge.id);
        if (row) Object.assign(row, entry.merge.patch);
      }
    });
    S.saveProgress = { done: Math.min(total, S.saveProgress.done + part.length), total };
    saveHistory(localStorage, { id: plan.importId, at, counts: plan.counts, status: "saving", progress: S.saveProgress });
    paint();
    paintUndoBar();
    if (typeof render === "function") render();
    if (typeof persist === "function") await persist();
  }
  if (S.cancelSave) {
    const id = plan.importId;
    const saved = S.saveProgress ? S.saveProgress.done : 0;
    const report = escapeSaveReport(saved, total);
    S.saving = false;
    S.saveProgress = null;
    await undoImport(id, { skipConfirm: true, quiet: true });
    if (typeof toast === "function") toast(report);
    return;
  }
  S.tables.forEach((table, ti) => {
    const fields = table.columns.map(col => (S.choices[ti] && S.choices[ti][col.index]) || col.field);
    rememberMap(localStorage, table.columns.map(col => col.key), fields);
  });
  saveHistory(localStorage, { id: plan.importId, at, counts: plan.counts, status: "saved", progress: { done: total, total } });
  S.savedId = plan.importId;
  S.saving = false;
  S.saveProgress = null;
  S.files = [];
  S.step = "done";
  paint();
  paintUndoBar();
  if (typeof toast === "function") toast(`${total} item${total === 1 ? "" : "s"} imported`);
}

async function undoImport(id, opts) {
  if (S.saving && !(opts && opts.skipConfirm)) {
    if (!id || id === S.importId) S.cancelSave = true;
    return;
  }
  if (typeof all === "undefined" || typeof db === "undefined") return;
  const changed = !(opts && opts.skipConfirm) && changedAfterImport([...(all || []), ...(db.ammo || [])], id);
  if (changed && changed.length) {
    const msg = changed.length === 1
      ? "1 item was changed after import. Remove it anyway?"
      : `${changed.length} items were changed after import. Remove them anyway?`;
    if (!window.confirm(msg)) return;
  }
  const removed = [...(all || []), ...(db.ammo || [])].filter(row => row && row.importId === id && !row.deleted).length;
  const nowIso = new Date().toISOString();
  const next = undoImportState(all, db.ammo, id, nowIso);
  all = next.items;
  db.ammo = next.ammo;
  const prev = loadHistory(localStorage).find(row => row.id === id) || { id, at: nowIso, counts: { total: removed } };
  saveHistory(localStorage, { ...prev, id, status: "undone", undone: true });
  if (typeof render === "function") render();
  if (typeof persist === "function") await persist();
  paintUndoBar();
  const n = prev.counts && prev.counts.total ? prev.counts.total : removed;
  if (typeof toast === "function" && !(opts && opts.quiet)) toast(`Undone: ${n} item${n === 1 ? "" : "s"} removed`);
  const sec = document.getElementById("secSheet");
  if (sec && !sec.hidden && typeof openSecurity === "function") openSecurity();
}

function finishImport(id) {
  const prev = loadHistory(localStorage).find(row => row.id === id);
  if (!prev) return;
  saveHistory(localStorage, { ...prev, status: "saved", undone: false });
  paintUndoBar();
}

function paintUndoBar() {
  const bar = document.getElementById("importUndo");
  if (!bar) return;
  const open = loadHistory(localStorage).find(row => row && !row.undone && row.status !== "undone" && (row.status === "saving" || undoOpen(row)));
  bar.replaceChildren();
  if (!open) { bar.hidden = true; return; }
  bar.hidden = false;
  const total = open.counts && open.counts.total ? open.counts.total : 0;
  const progress = open.progress;
  const savingText = progress && progress.total
    ? `Saving ${progress.done} of ${progress.total}. Incomplete. Undo or finish`
    : "Incomplete. Undo or finish";
  bar.append(el("span", { text: open.status === "saving" ? savingText : `${total} item${total === 1 ? "" : "s"} imported` }));
  if (open.status === "saving") {
    bar.append(el("button", { className: "btn ghost", text: "Finish", attrs: { type: "button", "data-import": "finish", "data-id": open.id } }));
  }
  bar.append(el("button", { className: "btn", text: "Undo", attrs: { type: "button", "data-import": "undo", "data-id": open.id } }));
}

function onClick(event) {
  const node = event.target.closest("[data-import]");
  if (!node) return;
  const act = node.getAttribute("data-import");
  if (act === "open") { openPick(); return; }
  if (act === "scan") { openScan(); return; }
  if (act === "browse") { document.getElementById("importFile")?.click(); return; }
  if (act === "ask-close") { askClose(); return; }
  if (act === "back") { back(); return; }
  if (act === "keep") { S.confirm = false; paint(); return; }
  if (act === "stop") { discard(); return; }
  if (act === "goto") {
    const step = node.getAttribute("data-step") || "pick";
    if (step === "pick") { Object.assign(S, blank()); S.step = "pick"; paint(); return; }
    go(step);
    return;
  }
  if (act === "more-matched") { S.showMatched[node.getAttribute("data-table")] = !S.showMatched[node.getAttribute("data-table")]; paint(); return; }
  if (act === "sheet") { S.active = +node.getAttribute("data-table") || 0; paint(); return; }
  if (act === "date-order") {
    const ti = +node.getAttribute("data-table") || 0;
    const cur = S.dateOrders[ti] || (S.tables[ti] && S.tables[ti].dateOrder) || "mdy";
    S.dateOrders[ti] = cur === "dmy" ? "mdy" : "dmy";
    paint();
    return;
  }
  if (act === "include") {
    const ti = +node.getAttribute("data-table") || 0;
    const on = S.included[ti] != null ? S.included[ti] : false;
    S.included[ti] = !on;
    paint();
    return;
  }
  if (act === "target") {
    S.targets[+node.getAttribute("data-table") || 0] = node.getAttribute("data-target");
    paint();
    return;
  }
  if (act === "row-target") {
    const ti = +node.getAttribute("data-table") || 0;
    const ri = +node.getAttribute("data-row") || 0;
    S.rowTargets[ti] = S.rowTargets[ti] || {};
    S.rowTargets[ti][ri] = node.getAttribute("data-target");
    paint();
    return;
  }
  if (act === "filter") { S.filter = node.getAttribute("data-filter") || "all"; S.previewFrom = 0; paint(); return; }
  if (act === "serials") { S.showSerials = !S.showSerials; paint(); return; }
  if (act === "more-rows") { S.previewFrom += 60; paint(); return; }
  if (act === "decision") {
    const ti = +node.getAttribute("data-table") || 0;
    const ri = +node.getAttribute("data-row") || 0;
    S.rowDecisions[ti] = S.rowDecisions[ti] || {};
    S.rowDecisions[ti][ri] = node.getAttribute("data-decision");
    paint();
    return;
  }
  if (act === "later") {
    const ti = +node.getAttribute("data-table") || 0;
    const ri = +node.getAttribute("data-row") || 0;
    S.rowFixes[ti] = S.rowFixes[ti] || {};
    S.rowFixes[ti][ri] = { ...(S.rowFixes[ti][ri] || {}), serial: "" };
    paint();
    return;
  }
  if (act === "skip-row") {
    const ti = +node.getAttribute("data-table") || 0;
    const ri = +node.getAttribute("data-row") || 0;
    S.rowFixes[ti] = S.rowFixes[ti] || {};
    S.rowFixes[ti][ri] = { ...(S.rowFixes[ti][ri] || {}), skip: true };
    paint();
    return;
  }
  if (act === "save") { saveImport(); return; }
  if (act === "undo") { undoImport(node.getAttribute("data-id")); return; }
  if (act === "finish") { finishImport(node.getAttribute("data-id")); return; }
  if (act === "camera") { openCamera(); return; }
}

function back() {
  const order = ["pick", "detected", "columns", "where", "preview", "summary"];
  const at = order.indexOf(S.step);
  if (at > 0) go(order[at - 1]);
  else askClose();
}

function onChange(event) {
  const node = event.target.closest("[data-import]");
  if (!node) return;
  const act = node.getAttribute("data-import");
  if (act === "field") {
    const ti = +node.getAttribute("data-table") || 0;
    const col = +node.getAttribute("data-col") || 0;
    S.choices[ti] = S.choices[ti] || {};
    S.choices[ti][col] = node.value;
    return;
  }
  if (act === "source") { if (node.value) setSource(+node.getAttribute("data-table") || 0, node.value); return; }
  if (act === "encoding") { reparse(+node.getAttribute("data-file") || 0, node.value); return; }
  if (act === "fix") {
    const ti = +node.getAttribute("data-table") || 0;
    const ri = +node.getAttribute("data-row") || 0;
    const key = node.getAttribute("data-key");
    S.rowFixes[ti] = S.rowFixes[ti] || {};
    S.rowFixes[ti][ri] = { ...(S.rowFixes[ti][ri] || {}), [key]: node.value };
    return;
  }
  if (act === "row-category") {
    const ti = +node.getAttribute("data-table") || 0;
    const ri = +node.getAttribute("data-row") || 0;
    S.rowCategories[ti] = S.rowCategories[ti] || {};
    S.rowCategories[ti][ri] = node.value;
    paint();
    return;
  }
  if (act === "bulk-category") {
    const value = node.value;
    if (!value) return;
    const plan = currentPlan();
    plan.rows.forEach(row => {
      if (!row || row.target !== "needs") return;
      S.rowCategories[row.table] = S.rowCategories[row.table] || {};
      S.rowCategories[row.table][row.row] = value;
    });
    paint();
  }
}

function onEscape() {
  const sh = sheet();
  if (!sh || sh.hidden) return false;
  if (S.saving) {
    S.cancelSave = true;
    return true;
  }
  if (S.step === "scan") stopCamera();
  askClose();
  return true;
}

document.getElementById("importFile")?.addEventListener("change", event => {
  const input = event.target;
  const files = input.files ? [...input.files] : [];
  input.value = "";
  if (S.step === "pick" || S.step === "error" || S.step === "huge") takeFiles(files);
  else { openPick(); takeFiles(files); }
});

document.addEventListener("click", onClick);
document.addEventListener("change", onChange);

const prevAfter = window.afterRender;
window.afterRender = function () {
  if (typeof prevAfter === "function") prevAfter();
  paintUndoBar();
};

window.__warboxOpenImport = openPick;
window.__warboxDiscardImport = discard;
window.__warboxUndoImport = undoImport;
window.__warboxImportEscape = onEscape;
paintUndoBar();
