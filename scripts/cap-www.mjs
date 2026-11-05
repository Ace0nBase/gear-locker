// Copy the public site into www/ for the native shell.
// The live site stays at the repo root. This folder is generated and is not published.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "www");
const banned = /\bAndroid\b|\bDesktop\b|\bPC\b|\bEdge\b/;

const files = [
  "index.html",
  "config.js",
  "manifest.webmanifest",
  "sw.js",
  "icon-192.png",
  "icon-512.png",
  "maskable-192.png",
  "maskable-512.png",
  "apple-touch-icon.png",
  "favicon.svg",
  "favicon-32.png",
  "favicon-16.png",
];
const dirs = ["css", "js"];

function copyFile(rel) {
  const from = path.join(root, rel);
  const to = path.join(out, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const rel of files) copyFile(rel);
for (const dir of dirs) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (name.endsWith(".js") || name.endsWith(".css")) copyFile(path.join(dir, name));
  }
}

const billing = path.join(root, "config.billing.js");
if (fs.existsSync(billing)) {
  fs.copyFileSync(billing, path.join(out, "config.billing.js"));
  const htmlPath = path.join(out, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const tag = '<script src="config.billing.js"></script>\n';
  if (!html.includes(tag.trim())) {
    fs.writeFileSync(htmlPath, html.replace('<script src="js/billing.js" defer></script>', tag + '<script src="js/billing.js" defer></script>'));
  }
}

const iconSet = path.join(root, "design/warbox-icon/ios/AppIcon.appiconset");
const iconDest = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
if (fs.existsSync(iconSet) && fs.existsSync(path.dirname(iconDest))) {
  fs.rmSync(iconDest, { recursive: true, force: true });
  fs.cpSync(iconSet, iconDest, { recursive: true });
}

const textExt = new Set([".html", ".js", ".css", ".webmanifest", ".svg", ".json"]);
const hits = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }
    if (!textExt.has(path.extname(name))) continue;
    const src = fs.readFileSync(full, "utf8");
    if (banned.test(src)) hits.push(path.relative(out, full));
  }
}
walk(out);
if (hits.length) {
  console.error("Native shell copy mentions a platform the iPhone app cannot name: " + hits.join(", "));
  process.exit(1);
}
console.log("Wrote " + out);
