import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPineVisuals } from '../lib/pine-visuals.mjs';

const plot = value => ({ data: [{ time: 1234, value }] });
test('PineTS drawing snapshots provide exact signal text and coordinates', () => {
  const source = {
    __labels__: plot([{ id: 2, x: 1234560000, y: 4222.5, xloc: 'bt', text: 'BUY E 4222.5\\nSL 4210', color: '#229966' }]),
    __boxes__: plot([{ id: 9, left: 20, right: 36, top: 4260, bottom: 4200, xloc: 'bi', bgcolor: '#00ff0030' }]),
    __lines__: plot([{ id: 5, x1: 14, y1: 4222, x2: 30, y2: 4222, xloc: 'bi' }]),
    __tables__: plot([{ id: 1, position: 'bottom_right', cells: [[{ text: 'ALL MTF (Permanen)', text_color: '#fff' }, { text: '17' }]] }]),
  };
  const result = extractPineVisuals(source);
  assert.deepEqual(result.labels.map(x => [x.text, x.x, x.y]), [['BUY E 4222.5\\nSL 4210', 1234560000, 4222.5]]);
  assert.equal(result.boxes[0].left, 20);
  assert.equal(result.lines[0].y2, 4222);
  assert.equal(result.tables[0].cells[0][1].text, '17');
});

test('missing signals and missing statistics never create fabricated output', () => {
  const r = extractPineVisuals({ EMA20: plot(200) });
  assert.deepEqual(r, { labels: [], boxes: [], lines: [], tables: [], shapes: [] });
});

test('deleted, malformed and out-of-range objects are not rendered', () => {
  const r = extractPineVisuals({
    __labels__: plot([{ id: 1, x: 1, y: 2, _deleted: true }, { id: 2, x: NaN, y: 2 }, { id: 3, x: 1, y: 2 }]),
    __boxes__: plot([{ left: NaN, right: 2, top: 3, bottom: 0 }]),
    __lines__: plot([{ x1: 1, x2: 2, y1: 3, y2: undefined }]),
  });
  assert.equal(r.labels.length, 1);
  assert.equal(r.boxes.length, 0);
  assert.equal(r.lines.length, 0);
});

test('plotshape uses PineTS event timestamps and native styles without price inference', () => {
  const r = extractPineVisuals({ 'BREAK naik': {title:'BREAK naik', options:{style:'shape'},data:[
    {time:1750000000000,value: false},
    {time:1750000300000,value: true, options:{shape:'shape_triangleup',location:'belowbar',color:'#55ff55',text:'BREAK'}},
  ]}});
  assert.equal(r.shapes.length, 1);
  assert.equal(r.shapes[0].time, 1750000300);
  assert.equal(r.shapes[0].text, 'BREAK');
});

test('PineTS draw objects survive the actual adapter without appearing as numeric lines', async () => {
  const { runAdvancedPine } = await import('../lib/pine-advanced.mjs');
  class PineTS {
    async run() {
      return { plots: {
        EMA20: { data: [{ value: 9, options: { color: '#ffff00' } }], options: {color:'#ffff00'} },
        GG_ENTRY: { data: [{ value: 4200 }] },
        __labels__: plot([{ id: 1, x: 60_000, y: 4200, xloc: 'bt', text: 'BUY', color: '#00ff00' }]),
        __lines__: plot([{ id: 2, x1: 60_000, x2: 120_000, y1: 4200, y2: 4200, xloc: 'bt' }]),
        'BREAK naik': { title: 'BREAK naik', options: { style: 'shape' }, data: [{ time: 60000, value: true }] },
      } };
    }
  }
  const bars = [{time:60,end:120,open:9,high:10,low:8,close:9,volume:2}];
  const r = await runAdvancedPine('//@version=6\nindicator("Mock")\nplot(close)', bars, {market:'XAUUSD',frame:'1m'}, {PineTS});
  assert.deepEqual(r.plots.map(x => x.name), ['EMA20']);
  assert.equal(r.plots[0].color, '#ffff00');
  assert.equal(r.visuals.labels[0].text, 'BUY');
  assert.equal(r.visuals.lines[0].y1, 4200);
  assert.equal(r.visuals.shapes.length, 1);
});
