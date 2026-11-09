import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEEP_DAYS, budapestDate, parseTargets, record } from "./check.mjs";

const landing = { group: "usageratio", label: "landing", url: "https://usageratio.snktibor.hu" };
const app = { group: "usageratio", label: "app", url: "https://app.example.com" };
const up = { at: "2026-11-09T11:55:00.000Z", ok: true, status: 200, ms: 120 };
const down = { at: "2026-11-09T11:55:00.000Z", ok: false, status: null, ms: 15000, error: "timeout" };

describe("parseTargets", () => {
  it("keeps the https addresses of the site's answer", () => {
    const value = { version: 1, targets: [landing, { ...app, url: "http://app.example.com" }, { label: "x" }] };
    assert.deepEqual(parseTargets(value), [landing]);
  });

  it("refuses another version or an empty list", () => {
    assert.equal(parseTargets({ version: 2, targets: [landing] }), null);
    assert.equal(parseTargets({ version: 1, targets: [] }), null);
    assert.equal(parseTargets("<html>"), null);
  });
});

describe("record", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("starts a day's counts and keeps the latest ping", () => {
    const next = record(null, [landing, app], new Map([[landing.url, up], [app.url, down]]), now);
    assert.equal(next.version, 1);
    assert.equal(next.checkedAt, now.toISOString());
    assert.deepEqual(next.targets, [landing, app]);
    assert.deepEqual(next.checks[landing.url], { last: up, days: { "2026-11-09": [1, 1] } });
    assert.deepEqual(next.checks[app.url], { last: down, days: { "2026-11-09": [0, 1] } });
  });

  it("adds to the day, forgets old days and drops addresses no longer listed", () => {
    const old = budapestDate(now.getTime() - KEEP_DAYS * 86_400_000);
    const previous = {
      version: 1,
      checkedAt: "2026-11-09T11:50:00Z",
      targets: [landing, app],
      checks: {
        [landing.url]: { last: up, days: { [old]: [5, 5], "2026-11-08": [288, 288], "2026-11-09": [10, 11] } },
        [app.url]: { last: up, days: { "2026-11-09": [11, 11] } },
      },
    };
    const next = record(previous, [landing], new Map([[landing.url, down]]), now);
    assert.deepEqual(next.checks[landing.url].days, { "2026-11-08": [288, 288], "2026-11-09": [10, 12] });
    assert.equal(next.checks[app.url], undefined);
  });

  it("counts days in Budapest: just after midnight there is the next day", () => {
    const next = record(null, [landing], new Map([[landing.url, up]]), new Date("2026-11-09T23:30:00Z"));
    assert.deepEqual(Object.keys(next.checks[landing.url].days), ["2026-11-10"]);
  });
});
