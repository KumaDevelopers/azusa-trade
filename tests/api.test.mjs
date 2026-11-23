import { test } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, cached, parseBls, parseRss } from "../server/api.mjs";

const request = (path, options) => new Request("https://azusa.test" + path, options);

test("HTTP API validates routes and reports missing credentials", async () => {
  assert.equal(await apiFetch(request("/")), null);
  assert.equal((await apiFetch(request("/api/history?symbol=__proto__&frame=15m"))).status, 400);
  assert.equal((await apiFetch(request("/api/history?symbol=BTCUSDT&frame=__proto__"))).status, 400);
  assert.equal((await apiFetch(request("/api/history?symbol=XAUUSD&frame=15m"))).status, 424);
  assert.equal((await apiFetch(request("/api/history?symbol=US10Y&frame=15m"))).status, 400);
  assert.equal((await apiFetch(request("/api/config", { method: "POST" }))).status, 405);
  assert.deepEqual(await (await apiFetch(request("/api/config"))).json(), { forex: false, forexStream: null, economicCalendar: "BLS / Federal Reserve" });
});
test("streaming exposes only an approved HTTPS relay URL", async () => {
  const env = { TWELVE_DATA_API_KEY: "server-secret", TWELVE_STREAM_URL: "https://relay.example/api/stream", VERCEL: "1" };
  const reply = await apiFetch(request("/api/config"), env);
  assert.equal((await reply.json()).forexStream, env.TWELVE_STREAM_URL);
  const blocked = await apiFetch(request("/api/config"), { ...env, TWELVE_STREAM_URL: "https://relay.example/?token=secret" });
  assert.equal((await blocked.json()).forexStream, null);
});
test("read-through cache coalesces requests and marks stale data", async () => {
  let counter = 0;
  const source = () => { counter++; return ["data"]; };
  const jobs = await Promise.all([cached("test-cache", 50, source), cached("test-cache", 50, source)]);
  assert.equal(counter, 1);
  assert.deepEqual(jobs[1].data, ["data"]);
  const fallback = await cached("test-cache", 0, () => { throw Error("offline"); });
  assert.equal(fallback.stale, true);
});
test("BLS iCal adjusts for DST and preserves missing reported values", () => {
  const rows = parseBls("BEGIN:VEVENT\nDTSTART;TZID=US-Eastern:20261110T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;TZID=US-Eastern:20260714T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\n");
  assert.equal(new Date(rows[0].date).toISOString(), "2026-11-10T13:30:00.000Z");
  assert.equal(new Date(rows[1].date).toISOString(), "2026-07-14T12:30:00.000Z");
  assert.equal(rows[0].impact, 3);
  assert.equal(rows[0].actual, null);
});
test("RSS decodes headlines and accepts only HTTPS articles", () => {
  const date = "Fri, 13 Nov 2026 13:30:00 GMT";
  const item = (title, url) => "<item><title>" + title + "</title><link>" + url + "</link><pubDate>" + date + "</pubDate></item>";
  const feed = parseRss(item("FOMC &amp; rates", "<![CDATA[https://example.com/a]]>") + item("Reject", "javascript:alert(1)"), "Federal Reserve");
  assert.equal(feed.length, 1);
  assert.equal(feed[0].title, "FOMC & rates");
  assert.equal(feed[0].category, "Moneter");
});
