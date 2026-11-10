import { fetchTargets, ping, record } from "./check.js";

const TARGETS_URL = "https://snktibor.hu/api/status/targets";
const KEY = "status.json";

export default {
  /** Every five minutes: ping what the site lists (the previous list when the site is down) and store the results. */
  async scheduled(_controller, env) {
    const previous = await env.STATUS.get(KEY, "json");
    const targets = (await fetchTargets(env.TARGETS_URL || TARGETS_URL)) ?? previous?.targets;
    if (!targets?.length) throw new Error("No addresses to ping: the site did not answer, and there is no earlier list.");

    const pings = new Map(await Promise.all(targets.map(async (t) => [t.url, await ping(t.url)])));
    await env.STATUS.put(KEY, JSON.stringify(record(previous, targets, pings, new Date())));
  },

  /** The results for the status page, at /status.json. */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/") return Response.redirect("https://snktibor.hu/status", 302);
    if (pathname !== `/${KEY}` || request.method !== "GET") return new Response("Not found", { status: 404 });

    const body = await env.STATUS.get(KEY);
    if (body === null) return new Response("No results yet", { status: 404 });
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
        "access-control-allow-origin": "*",
      },
    });
  },
};
