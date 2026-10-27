// Reads a spreadsheet in a worker. No network.
import { readImportFile } from "./import-engine.js";

self.onmessage = async (event) => {
  const msg = event.data || {};
  const id = msg.id || "";
  try {
    const bytes = msg.bytes instanceof Uint8Array ? msg.bytes : new Uint8Array(msg.bytes || []);
    const result = await readImportFile(bytes, { name: msg.name || "", encoding: msg.encoding || "" });
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, result: { ok: false, code: "unsupported" } });
  }
};
