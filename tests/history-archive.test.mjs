import test from 'node:test';
import assert from 'node:assert/strict';
import { readArchive, mergeArchive, archivePath } from '../lib/market-archive.mjs';
import { parseRows } from '../scripts/import-dukascopy.mjs';
import { makeMarketProvider } from '../lib/pine-advanced.mjs';

function bar(time, close) { return {time,open:close,high:close+1,low:close-1,close,volume:1,closed:true}; }
const payload = (symbol,frame,rows) => ({version:1,symbol,frame,source:'Dukascopy BID',bars:rows.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume])});
test('Dukascopy importer retains genuine UTC candles, deduplicates and sorts',()=>{
 const text='timestamp,open,high,low,close,volume\n'+
 '1735689660000,100,101,99,100,2\n'+
 '1735689600000,99,100,98,99,1\n'+
 '1735689660000,100,102,99,101,3\n';
 const result=parseRows(text);
 assert.equal(result.length,2);
 assert.equal(result[0][0],1735689600);
 assert.equal(result[1][4],101);
});
test('archive rejects malformed instrument, timestamps and OHLC',()=>{
 const a=[bar(3600,100),bar(7200,101)];
 assert.equal(readArchive(payload('XAUUSD','1h',a),'XAUUSD','1h').length,2);
 assert.throws(()=>readArchive(payload('EURUSD','1h',a),'XAUUSD','1h'),/berbeda instrumen/);
 assert.throws(()=>readArchive(payload('XAUUSD','1h',a.reverse()),'XAUUSD','1h'),/data rusak/);
 assert.equal(archivePath('XAUUSD','4h'),'/historical/XAUUSD-4h.json');
});
test('archive + live merge yields real long XAUUSD 4h history (not cloned bars)',async()=>{
 const t0=1735689600;
 const ts=14400;
 const archive=Array.from({length:700},(_,i)=>bar(t0+i*ts,2700+i*.04));
 const recent=Array.from({length:181},(_,i)=>bar(t0+(700-15+i)*ts,2700+(700-15+i)*.04));
 const out=mergeArchive(archive,recent,ts);
 assert.equal(out.length,866);
 assert.equal(out[0].time,t0);
 assert.equal(out.at(-1).time,recent.at(-1).time);
 const provider=makeMarketProvider({market:'XAUUSD',frame:'4h',bars:recent,
  seedLoader:async(s,f)=>payload(s,f,archive),fetchImpl:async()=>({ok:false})});
 assert.equal(await provider.primePrimary(800),866);
 const returned=await provider.getMarketData('XAUUSD','240',1000);
 assert.equal(returned.length,866);
 assert.equal(returned[0].openTime,t0*1000);
});
test('stale archive across weeks fails closed to prevent false signal continuity',()=>{
 assert.throws(()=>mergeArchive([bar(10000,100)],[bar(10000+86400*10,101)],14400),/HISTORI_BERJEDA/);
});
test('secondary Pine requests can use historical archive when biquote has no old candles',async()=>{
 const ts=14400,t0=1735689600;
 const archive=Array.from({length:700},(_,i)=>bar(t0+i*ts,2600+i*.1));
 const live=[bar(t0+700*ts,2670)];
 const provider=makeMarketProvider({market:'EURUSD',frame:'1h',bars:[bar(t0,1)],
  seedLoader:async(s,f)=>s==='XAUUSD'&&f==='4h'?payload(s,f,archive):null,
  fetchImpl:async()=>({ok:false,status:424,json:async()=>({error:'No history'})})});
 const result=await provider.getMarketData('XAUUSD','240',1000);
 assert.equal(result.length,700);
 assert.equal(result.at(-1).openTime,archive.at(-1).time*1000);
});
