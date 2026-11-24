import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeMarketProvider, nativeFrame, runAdvancedPine, toPineBars } from '../lib/pine-advanced.mjs';

const candles = [
  { time: 60, end: 120, open: 2, high: 3, low: 1, close: 2.5, volume: 4, closed: true },
  { time: 120, end: 180, open: 2.5, high: 4, low: 2, close: 3, volume: null, closed: false },
];

test('PineTS receives original source, chronological candle timestamps and prices', async () => {
  const source = '//@version=6\nindicator("Example")\nplot(close, "Close")';
  class Indicator { constructor(text) { assert.equal(text, source); } }
  class PineTS {
    constructor(provider, symbol, timeframe) {
      assert.equal(symbol, 'XAUUSD'); assert.equal(timeframe, '1');
      assert.equal(typeof provider.getMarketData, 'function');
    }
    async run() { return { plots: { Close: { data: [{ value: 2.5 }, { value: 3 }] } }, warnings: [], alerts: [] }; }
  }
  const result = await runAdvancedPine(source, candles, {market:'XAUUSD', frame:'1m'}, {PineTS, Indicator});
  assert.deepEqual(result.plots[0].values, [2.5, 3]);
  assert.deepEqual(toPineBars(candles, 60).map(x=>x.openTime), [60000, 120000]);
});

test('secondary market provider fetches proper symbol and timeframe; never substitutes XAUUSD bars for DXY', async () => {
  const calls = [];
  const provider = makeMarketProvider({ market:'XAUUSD', frame:'1m', bars:candles,
    fetchImpl:async url => { calls.push(url); return {ok:true,json:async()=>({bars:[{...candles[0], time:180}], stale:false})}; },
  });
  assert.equal((await provider.getMarketData('XAUUSD','1')).length, 2);
  assert.equal(calls.length, 0);
  const result = await provider.getMarketData('TVC:DXY', '60');
  assert.equal(result[0].openTime, 180000);
  assert.match(calls[0], /symbol=DXY/);
  assert.match(calls[0], /frame=1h/);
});

test('secondary provider rejects stale and missing data rather than fabricating signals', async () => {
  const provider = makeMarketProvider({ market:'XAUUSD', frame:'1m', bars:candles,
    fetchImpl:async()=>({ok:true,json:async()=>({bars:[],stale:true})}) });
  await assert.rejects(provider.getMarketData('US10Y', '60'), /kosong atau stale/);
});

test('original GoldGuard trading source is unchanged', () => {
  const data=readFileSync(new URL('../indicators/GoldGuard.pine',import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'),'1a241de8c54ae2695af94c526f5af92a67dbc8f84179ca72b79e7dd4c4567e1c');
});

test('Pine timeframe defaults use actual chart frame and native hourly/daily frames normalize', async () => {
  assert.equal(nativeFrame('15m'), '15m');
  assert.equal(nativeFrame('1h'), '1h');
  assert.equal(nativeFrame('60'), '1h');
  assert.equal(nativeFrame('D'), '1d');
  assert.equal(nativeFrame('1w'), '1w');
  const source = '//@version=6\nindicator("Clock")\nplot(close)';
  class PineTS {
    constructor(provider, symbol, timeframe) { assert.equal(timeframe, '15'); }
    async run() { return {plots:{}}; }
  }
  await runAdvancedPine(source, candles, {market:'XAUUSD',frame:'15m'}, {PineTS});
  const provider = makeMarketProvider({market:'XAUUSD',frame:'15m',bars:candles});
  assert.equal((await provider.getMarketData('XAUUSD', '')).length, 2);
});
