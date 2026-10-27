// Test entry for wrangler. The production worker is api/worker.js.
// This file only exposes the same UsageLedger class through the real USAGE binding.
import { UsageLedger } from "../api/usage-ledger.js";

export { UsageLedger };

export default {
  async fetch(req, env) {
    const stub = env.USAGE.getByName("global");
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : {};
    if (url.pathname === "/reserve") return Response.json(await stub.reserve(body));
    if (url.pathname === "/reconcile") return Response.json(await stub.reconcile(body));
    if (url.pathname === "/read") return Response.json(await stub.read(body));
    if (url.pathname === "/clear") return Response.json(await stub.clearUser(body));
    return new Response("Not found", { status: 404 });
  },
};
