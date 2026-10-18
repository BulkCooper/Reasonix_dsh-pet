#!/usr/bin/env node
/**
 * Install the dsh-pet runtime used by this Reasonix plugin.
 *
 * The repository intentionally does not ship node_modules or Electron:
 *   - dsh-pet@0.3.7 is installed from npm into ./runtime
 *   - the desktop menu patch (remove "open site") is re-applied
 *   - Electron is downloaded on first pet start (or pass --with-electron here)
 *
 * Usage: node scripts/install.mjs [--with-electron]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  PLUGIN_ROOT,
  RUNTIME_ROOT,
  STANDALONE_ENTRY,
  STATE_DIR,
  ensureDirs,
} from './config.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js >= 22.12 is required (current: ${process.versions.node}).`);
  process.exit(1);
}

mkdirSync(RUNTIME_ROOT, { recursive: true });
const runtimeManifest = join(RUNTIME_ROOT, 'package.json');
if (!existsSync(runtimeManifest)) {
  writeFileSync(
    runtimeManifest,
    `${JSON.stringify({ name: 'reasonix-pet-runtime', private: true }, null, 2)}\n`,
    'utf8',
  );
}

console.log('[install] npm install dsh-pet@0.3.7 ...');
const npm = spawnSync(
  'npm',
  ['install', 'dsh-pet@0.3.7', '--omit=dev', '--no-audit', '--no-fund'],
  { cwd: RUNTIME_ROOT, stdio: 'inherit', shell: true },
);
if (npm.error || npm.status !== 0 || !existsSync(STANDALONE_ENTRY)) {
  console.error('[install] dsh-pet runtime installation failed.');
  process.exit(1);
}

console.log('[install] applying desktop menu patch ...');
const patch = spawnSync(
  process.execPath,
  [join(PLUGIN_ROOT, 'scripts', 'remove-open-site.mjs')],
  { stdio: 'inherit' },
);
if (patch.status !== 0) {
  console.error('[install] menu patch failed; inspect scripts/remove-open-site.mjs.');
  process.exit(1);
}

ensureDirs();
writeFileSync(join(STATE_DIR, 'node-path.txt'), process.execPath, 'utf8');

if (process.argv.includes('--with-electron')) {
  console.log('[install] downloading Electron (about 138 MB) ...');
  const ensure = spawnSync(
    process.execPath,
    [join(RUNTIME_ROOT, 'node_modules', 'dsh-pet', 'scripts', 'ensure-electron.mjs')],
    {
      stdio: 'inherit',
      env: { ...process.env, DSH_HOME: join(PLUGIN_ROOT, 'home') },
    },
  );
  if (ensure.status !== 0) {
    console.warn('[install] Electron download failed; it will retry on the first pet start.');
  }
} else {
  console.log('[install] Electron will be downloaded automatically on the first pet start.');
}

console.log('');
console.log('[install] done.');
console.log('  start:   pet.cmd start   (or restart Reasonix; SessionStart will start it)');
console.log('  status:  pet.cmd status');
