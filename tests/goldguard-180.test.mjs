import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
test('GoldGuard 180 limits history only, preserving all trade and reverse rules verbatim',()=>{
 const output=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/check-goldguard-180.mjs', import.meta.url))],{encoding:'utf8'});
 assert.match(output,/rumus entry, exit, reverse signal/);
 const source=readFileSync(new URL('../indicators/GoldGuard.pine',import.meta.url),'utf8');
 assert.match(source,/ta\.ema\(close, 200\)/);
 assert.match(source,/request\.security_lower_tf/);
 assert.match(source,/reverseOutput/);
});
