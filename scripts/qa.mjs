// Starts the local privacy check. It never deploys and never uses the live project.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = name => path.join(root, "node_modules", ".bin", name);
const children = [];

function start(cmd, args, extraEnv, stdin) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true", ...extraEnv },
    stdio: [stdin || "ignore", "pipe", "pipe"],
  });
  const label = path.basename(cmd);
  child.stdout.on("data", d => process.stdout.write("[" + label + "] " + d));
  child.stderr.on("data", d => process.stderr.write("[" + label + "] " + d));
  child.on("exit", code => {
    if (code && code !== 0 && !shutting) {
      console.error(label + " stopped (" + code + "). Shutting the local test down.");
      shutdown();
    }
  });
  children.push(child);
  return child;
}

function waitPort(port, timeout = 120000) {
  const startAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ port, host: "127.0.0.1" }, () => { socket.end(); resolve(); });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - startAt > timeout) reject(new Error("Port " + port + " did not open"));
        else setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

let shutting = false;
function shutdown() {
  if (shutting) return;
  shutting = true;
  for (const child of children) { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
  setTimeout(() => process.exit(0), 600);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start(bin("firebase"), ["emulators:start", "--only", "auth,firestore,storage", "--project", "demo-gear-locker"]);
start(bin("wrangler"), ["dev", "--config", "api/wrangler.stub.toml", "--port", "8787", "--ip", "127.0.0.1", "--local", "--show-interactive-dev-session=false"], undefined, "pipe");
start("python3", ["-m", "http.server", "5500", "--bind", "127.0.0.1"]);

try {
  await Promise.all([8080, 9099, 9199, 8787, 5500, 4000].map(p => waitPort(p)));
} catch (err) {
  console.error(err.message);
  shutdown();
  process.exit(1);
}

console.log("\nLocal test is ready.");
console.log("App:          http://127.0.0.1:5500/?env=emulator");
console.log("Emulator UI:  http://127.0.0.1:4000");
console.log("This page cannot reach the live locker. Press Ctrl+C to stop.\n");
