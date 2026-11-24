import test from 'node:test';
import assert from 'node:assert/strict';
import { withPineTSSlicingDisabled } from '../lib/pinets-compat.mjs';
import { runAdvancedPine } from '../lib/pine-advanced.mjs';
import { readFileSync } from 'node:fs';

const getFlag = () => globalThis.process?.env?.PINETS_DISABLE_LTF_SLICING;
const sample = [{time:100,open:2,high:3,low:1,close:2,volume:2}];

test('workaround sets PineTS flag only during an enabled call and restores the prior environment', async () => {
  const before = getFlag();
  const observed = await withPineTSSlicingDisabled(true, async () => {
    assert.equal(getFlag(), '1');
    await Promise.resolve();
    return getFlag();
  });
  assert.equal(observed, '1');
  assert.equal(getFlag(), before);
  assert.equal(await withPineTSSlicingDisabled(false, () => Promise.resolve('normal')), 'normal');
  assert.equal(getFlag(), before);
});

test('workaround restores environment when PineTS rejects', async () => {
  const before = getFlag();
  await assert.rejects(withPineTSSlicingDisabled(true, () => Promise.reject(new Error('pine error'))), /pine error/);
  assert.equal(getFlag(), before);
});

test('GoldGuard is passed to a mock PineTS unchanged and with slicing disabled', async () => {
  const original = readFileSync(new URL('../indicators/GoldGuard.pine', import.meta.url), 'utf8');
  const before = getFlag();
  class PineTS {
    async run(indicator) {
      assert.equal(indicator, original);
      assert.equal(getFlag(), '1');
      return {plots:{}};
    }
  }
  const bars180 = Array.from({length:180},(_,i)=>({time:100+i*14400,open:2,high:3,low:1,close:2,volume:2}));
  await runAdvancedPine(original,bars180,{market:'XAUUSD',frame:'4h'}, {PineTS});
  assert.equal(getFlag(), before);
});

test('non-GoldGuard scripts run without changing slicing preference', async () => {
  const before = getFlag();
  const script = '//@version=6\nindicator("Testing")\nplot(close)';
  class PineTS {
    async run() {
      assert.equal(getFlag(), before);
      return {plots:{}};
    }
  }
  await runAdvancedPine(script,sample,{market:'XAUUSD',frame:'4h'}, {PineTS});
  assert.equal(getFlag(),before);
});
