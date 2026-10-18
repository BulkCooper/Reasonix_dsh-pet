#!/usr/bin/env node
/**
 * Upstream patch: remove the "open site" entry from dsh-pet's desktop context menu.
 *
 * dsh-pet builds the menu in runtime/electron-helper/sprite.js; there is no config switch.
 * Re-apply after upgrading/reinstalling dsh-pet, then run `pet.cmd restart`:
 *
 *   node scripts/remove-open-site.mjs
 *
 * Idempotent. Uses an ASCII regex so it works regardless of the file encoding.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_ROOT } from './config.mjs';

const sprite = join(
  PLUGIN_ROOT,
  'runtime',
  'node_modules',
  'dsh-pet',
  'runtime',
  'electron-helper',
  'sprite.js',
);

if (!existsSync(sprite)) {
  console.error(`sprite.js not found: ${sprite} (install the dsh-pet runtime first)`);
  process.exit(1);
}

const source = readFileSync(sprite, 'utf8');
if (source.includes("label: '刷新余额'")) {
  console.log('open-site menu entry already removed.');
  process.exit(0);
}
if (/^[ \t]*const tools = \[\];/m.test(source)) {
  console.log('open-site menu entry already removed.');
  process.exit(0);
}

const target = /^[ \t]*const tools = \[.*open-site.*\];[ \t]*$/m;
if (!target.test(source)) {
  console.error('menu entry not found; dsh-pet may have changed. Inspect sprite.js manually.');
  process.exit(1);
}

writeFileSync(
  sprite,
  source.replace(target, '    const tools = []; // Reasonix: open-site menu entry removed'),
  'utf8',
);
console.log('removed the open-site menu entry; run `pet.cmd restart` to apply.');
