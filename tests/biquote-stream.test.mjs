import { test } from "node:test";
import assert from "node:assert/strict";
import { startBiquoteStream } from "../lib/biquote-stream.mjs";

test("SignalR negotiates, subscribes after handshake and processes real tick", async t => {
  const priorSocket = globalThis.WebSocket;
  const priorFetch = globalThis.fetch;
  const frames = [];
  const events = [];
  const sockets = [];
  class FakeWS {
    static OPEN = 1;
    readyState = FakeWS.OPEN;
    constructor(url) { this.url = url; sockets.push(this); }
    send(frame) { frames.push(JSON.parse(frame.slice(0, -1))); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = FakeWS;
  globalThis.fetch = async url => {
    assert.ok(String(url).endsWith("/hubs/tick/negotiate?negotiateVersion=1"));
    return Response.json({ connectionToken: "test-token", availableTransports: [{transport:"WebSockets"}] });
  };
  t.after(() => { globalThis.WebSocket = priorSocket; globalThis.fetch = priorFetch; });
  const controller = new AbortController();
  const session = startBiquoteStream({ symbols:["XAUUSD"], signal: controller.signal,
    onTick: tick => events.push(tick), onState: () => {} });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sockets.length, 1);
    assert.ok(sockets[0].url.includes("id=test-token"));
    sockets[0].onopen();
    assert.deepEqual(frames[0], {protocol:"json",version:1});
    sockets[0].onmessage({data:'{}\x1e'});
    assert.equal(frames[1].target, "Subscribe");
    assert.deepEqual(frames[1].arguments, [["XAUUSD"]]);
    sockets[0].onmessage({data:'{"type":1,"target":"ReceiveTick","arguments":[{"symbol":"XAUUSD","mid":3700.25,"timestamp":"2026-11-24T01:00:00Z"}]}\x1e'});
    assert.equal(events.length,1);
    assert.equal(events[0].mid,3700.25);
  } finally { controller.abort(); session.close(); }
});
