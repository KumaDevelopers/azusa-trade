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
  await assert.rejects(provider.getMarketData('US10Y', '60'), /tidak tersedia/);
});

test('GoldGuard 180 Candle source SHA matches verified build', () => {
  const data=readFileSync(new URL('../indicators/GoldGuard.pine',import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'),'1573c7fc8f1ea718a9e6bff9e71dc6b1135355eafdaedba3eae0466e7b5108e8');
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

test('Pine provider backfills older REAL candles without inventing history', async () => {
  const fresh = [
    { time: 600, end: 660, open: 10, high: 11, low: 9, close: 10, volume: 2 },
    { time: 660, end: 720, open: 11, high: 12, low: 10, close: 11, volume: 2 },
  ];
  let requests = 0;
  const older = [360, 420, 480, 540].map(time => ({ time, end: time + 60, open: 9, high: 10, low: 8, close: 9, volume: 2 }));
  const provider = makeMarketProvider({market:'EURUSD',frame:'1m',bars:fresh, fetchImpl: async url => {
    requests++;
    assert.match(url, /symbol=EURUSD/);
    assert.match(url, /before=600/);
    return {ok:true,json:async()=>({bars:older,stale:false})};
  }});
  assert.equal(await provider.primePrimary(6), 6);
  const received = await provider.getMarketData('EURUSD', '1', 6);
  assert.deepEqual(received.map(bar => bar.openTime), [360000, 420000, 480000, 540000, 600000, 660000]);
  assert.equal(requests, 1);
});

test('PineTS numeric index crash includes available history and suppresses fake signals', async () => {
  const source = '//@version=6\nindicator("Deep", calc_bars_count = 600)\nplot(close)';
  class PineTS {
    async run() { throw new TypeError("Cannot read properties of undefined (reading '384')"); }
  }
  await assert.rejects(
    runAdvancedPine(source, candles, {market:'XAUUSD',frame:'1m',fetchImpl:async()=>({ok:false})}, {PineTS}),
    /PineTS gagal mengakses seri internal 384.*Histori tersedia: 2 candle/
  );
});


test('GoldGuard 180 adapter caps primary and secondary input to 180 candles', async () => {
  const source = readFileSync(new URL('../indicators/GoldGuard.pine',import.meta.url),'utf8');
  const bars = Array.from({length:220},(_,i)=>({time:(i+1)*14400,end:(i+2)*14400,open:10,high:11,low:9,close:10,volume:1}));
  class PineTS {
    constructor(provider,symbol,timeframe,count) {
      assert.equal(count,180);
      assert.equal(provider.getMarketData('XAUUSD', '240', 1000) instanceof Promise,true);
      this.provider=provider;
    }
    async run() {
      const primary=await this.provider.getMarketData('XAUUSD','240',1000);
      assert.equal(primary.length,180);
      assert.equal(primary[0].openTime,bars[40].time*1000);
      return {plots:{}};
    }
  }
  await runAdvancedPine(source,bars,{market:'XAUUSD',frame:'4h'},{PineTS});
});
