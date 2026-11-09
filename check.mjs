#!/usr/bin/env node
/**
 * Pings every address snktibor.hu lists and adds the results to status.json: the latest ping of each, and per
 * Budapest day how many pings answered. When the site is down, the previous list is pinged.
 */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TARGETS_URL = process.env.TARGETS_URL?.trim() || "https://snktibor.hu/api/status/targets";
/** Days of history kept; the page shows as many. */
export const KEEP_DAYS = 90;
const TIMEOUT_MS = 15_000;
/** A failed ping is tried again once, after this long, before it counts: one dropped packet is not an outage. */
const RETRY_AFTER_MS = 5_000;
const USER_AGENT = "snktibor-status (+https://github.com/snktibor/status)";

/** "YYYY-MM-DD" in Budapest for an instant, the way the site counts its days. */
export function budapestDate(instant) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date(instant));
}

/** The addresses in the site's answer, or null when it is not one. */
export function parseTargets(value) {
  if (value?.version !== 1 || !Array.isArray(value.targets)) return null;
  const targets = value.targets.filter(
    (t) =>
      typeof t?.group === "string" &&
      typeof t.label === "string" &&
      typeof t.url === "string" &&
      /^https:\/\/\S+$/.test(t.url),
  );
  return targets.length > 0 ? targets.map(({ group, label, url }) => ({ group, label, url })) : null;
}

/**
 * The new results: `previous` (the last file, or null) with this run's pings added. Addresses no longer on the list
 * are dropped, and days older than KEEP_DAYS forgotten.
 */
export function record(previous, targets, pings, now) {
  const today = budapestDate(now);
  const oldest = budapestDate(now.getTime() - (KEEP_DAYS - 1) * 86_400_000);
  const checks = {};
  for (const target of targets) {
    const ping = pings.get(target.url);
    const before = previous?.checks?.[target.url];
    const days = {};
    for (const [date, counts] of Object.entries(before?.days ?? {})) if (date >= oldest) days[date] = counts;
    if (!ping) {
      if (before) checks[target.url] = { last: before.last, days };
      continue;
    }
    const [up, total] = days[today] ?? [0, 0];
    days[today] = [up + (ping.ok ? 1 : 0), total + 1];
    checks[target.url] = { last: ping, days };
  }
  return { version: 1, checkedAt: now.toISOString(), targets, checks };
}

/** One ping: a GET, following redirects; up when the answer is 2xx. The body is not read. */
async function pingOnce(url) {
  const at = new Date().toISOString();
  const start = performance.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - start);
    await res.body?.cancel();
    return { at, ok: res.ok, status: res.status, ms };
  } catch (error) {
    const ms = Math.round(performance.now() - start);
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { at, ok: false, status: null, ms, error: timeout ? "timeout" : "unreachable" };
  }
}

async function ping(url) {
  const first = await pingOnce(url);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  return pingOnce(url);
}

async function readPrevious(file) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return value?.version === 1 ? value : null;
  } catch {
    return null;
  }
}

async function fetchTargets() {
  try {
    const res = await fetch(TARGETS_URL, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const targets = parseTargets(await res.json());
    if (!targets) throw new Error("sent no addresses");
    return targets;
  } catch (error) {
    console.warn(`The site's list of addresses (${TARGETS_URL}) ${error.message}; pinging the previous list.`);
    return null;
  }
}

async function main() {
  const file = process.argv[2] ?? "status.json";
  const previous = await readPrevious(file);
  const targets = (await fetchTargets()) ?? previous?.targets;
  if (!targets?.length) throw new Error("No addresses to ping: the site did not answer, and there is no earlier list.");

  const pings = new Map(await Promise.all(targets.map(async (t) => [t.url, await ping(t.url)])));
  const next = record(previous, targets, pings, new Date());
  await writeFile(file, `${JSON.stringify(next)}\n`);

  for (const t of targets) {
    const p = pings.get(t.url);
    const state = p.ok ? "up  " : "DOWN";
    console.log(`${state} ${String(p.status ?? p.error).padEnd(11)} ${String(p.ms).padStart(5)} ms  ${t.group} ${t.label}  ${t.url}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
