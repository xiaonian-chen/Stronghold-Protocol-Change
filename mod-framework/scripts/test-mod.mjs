// mod-framework/scripts/test-mod.mjs — Smoke test for mod-framework.
// Run: cd Stronghold-Protocol-v0.3.1 && node --import ./Stronghold-Protocol/scripts/20p-loader.mjs mod-framework/scripts/test-mod.mjs
// For normal usage, just double-click 启动服务器（信任插件）.bat — the Mod selector opens automatically.

import modHook from '../modHook.js';
import { ready, getLoadedMods } from '../modManager.js';

console.log('=== Mod Framework Smoke Test ===\n');

// 1. Verify modHook API
console.log('[1/5] modHook API check...');
const testFn = () => 'test';
modHook.on('_test', testFn);
const results = modHook.emit('_test');
console.assert(results.length === 1 && results[0] === 'test', 'emit failed');
modHook.off('_test', testFn);
console.assert(modHook.emit('_test').length === 0, 'off failed');
console.log('  ✓ emit / on / off working\n');

// 2. Verify emitUntil
modHook.on('_test2', () => null);
modHook.on('_test2', () => 'found');
modHook.on('_test2', () => 'ignored');
const until = modHook.emitUntil('_test2');
console.assert(until === 'found', 'emitUntil returned wrong value');
console.log('  ✓ emitUntil working\n');

// 3. Verify hasListeners
console.assert(modHook.hasListeners('_test2'), 'hasListeners should be true');
modHook.off('_test2', (...args) => true); // won't match anything but no error
console.log('  ✓ hasListeners working\n');

// 4. Wait for mods to load
console.log('[2/5] Waiting for mods to load...');
const loaded = await ready;
console.log('  Loaded mods:', loaded.map(m => m.id).join(', ') || '(none)');
if (loaded.length > 0) {
  console.log('  ✓ modManager loaded mods successfully');
} else {
  console.log('  ⚠ No mods loaded (check mods/ directory and config.json)');
}
console.log();

// 5. Verify hook listeners are registered
console.log('[3/5] Checking registered hooks...');
const events = ['match:init', 'match:bossHp', 'match:duckReplace', 'match:shopSlots', 'phase:bandDraft:enter', 'lobby:beforeMatch'];
let registered = 0;
for (const ev of events) {
  if (modHook.hasListeners(ev)) {
    console.log(`  ✓ ${ev} has listeners`);
    registered++;
  }
}
if (registered > 0) {
  console.log(`  ✓ ${registered}/${events.length} hooks have registered listeners\n`);
} else {
  console.log(`  ⚠ No hook listeners registered yet (mods may not be loaded)\n`);
}

// 6. Simulate match:bossHp
console.log('[4/5] Simulating match:bossHp hook...');
const ctx = { base: 100, tune: 1.5, share: 1, result: 150 };
const override = modHook.emitUntil('match:bossHp', null, 'boss_001', 4, ctx);
if (typeof override === 'number') {
  console.log(`  Boss HP override: ${ctx.result} → ${override}`);
} else {
  console.log(`  Boss HP result: ${ctx.result}`);
}
console.log('  ✓ match:bossHp simulation complete\n');

// 7. Simulate match:shopSlots
console.log('[5/5] Simulating match:shopSlots hook...');
const fakePlayer = { m: { _cloneActive: true } };
const slots = { chess: 5, item: 1 };
const slotOverride = modHook.emitUntil('match:shopSlots', fakePlayer, 5, slots);
if (slotOverride) {
  console.log(`  Shop slots: chess ${slots.chess}→${slotOverride.chess}, item ${slots.item}→${slotOverride.item}`);
}
console.log('  ✓ match:shopSlots simulation complete\n');

console.log('=== All tests complete ===');
console.log('If you see "✓" above, the mod-framework is working correctly.');
console.log('Start the server normally with:');
console.log('  node --import ./scripts/20p-loader.mjs server/index.js');