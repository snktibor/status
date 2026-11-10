/** Days of history kept; the status page shows as many. */
export const KEEP_DAYS = 90;
/** The free plan allows 50 subrequests a run: the list, one ping each, and a retry for the ones that fail. */
export const MAX_TARGETS = 24;
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_MS = 5_000;
const USER_AGENT = "snktibor-status (+https://github.com/snktibor/status)";

/** "YYYY-MM-DD" in Budapest for an instant, the way the site counts its days. */
export function budapestDate(instant) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date(instant));
}

/** The addresses in the site's answer, or null when it is not one. */
export function parseTargets(value) {
  if (value?.version !== 1 || !Array.isArray(value.targets)) return null;
  const targets = value.targets
    .filter(
      (t) =>
        typeof t?.group === "string" &&
        typeof t.label === "string" &&
        typeof t.url === "string" &&
        /^https:\/\/\S+$/.test(t.url),
    )
    .map(({ group, label, url }) => ({ group, label, url }));
  return targets.length > 0 ? targets.slice(0, MAX_TARGETS) : null;
}

/**
 * `previous` (or null) with this run's pings added: the latest ping of each address, and per Budapest day how many
 * of its pings answered. Addresses no longer listed are dropped, days older than KEEP_DAYS forgotten.
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

/** The site's list of addresses, or null when it does not answer with one. */
export async function fetchTargets(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? parseTargets(await res.json()) : null;
  } catch {
    return null;
  }
}

/** A GET, following redirects; up when the answer is 2xx. The body is not read. */
async function pingOnce(url) {
  const at = new Date().toISOString();
  const start = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - start;
    await res.body?.cancel();
    return { at, ok: res.ok, status: res.status, ms };
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { at, ok: false, status: null, ms: Date.now() - start, error: timeout ? "timeout" : "unreachable" };
  }
}

/** A failed ping is tried again once, a few seconds later, before it counts: one dropped packet is not an outage. */
export async function ping(url) {
  const first = await pingOnce(url);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  return pingOnce(url);
}
