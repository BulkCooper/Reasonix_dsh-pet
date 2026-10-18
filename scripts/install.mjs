#!/usr/bin/env node
/**
 * Install the dsh-pet runtime and the login-time supervisor.
 *
 * Usage:
 *   node scripts/install.mjs                 install runtime + startup agent
 *   node scripts/install.mjs --with-electron install runtime + download Electron
 *   node scripts/install.mjs --agent-only    only (re)install/start the supervisor
 *
 * The repository intentionally does not ship node_modules or Electron:
 *   - dsh-pet@0.3.7 is installed from npm into ./runtime
 *   - the desktop menu patch (remove "open site") re-applied
 *   - Electron is downloaded on first pet start (or via --with-electron)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  PLUGIN_ROOT,
  RUNTIME_ROOT,
  STANDALONE_ENTRY,
  STATE_DIR,
  ensureDirs,
} from './config.mjs';

const agentOnly = process.argv.includes('--agent-only');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js >= 22.12 is required (current: ${process.versions.node}).`);
  process.exit(1);
}

/**
 * Register a hidden login-time supervisor in the user's Startup folder.
 * The supervisor starts the pet as soon as Reasonix appears, instead of
 * waiting for SessionStart (which can be tens of seconds late).
 */
function installAgent() {
  const appData = process.env.APPDATA;
  const agentScript = join(PLUGIN_ROOT, 'scripts', 'agent.mjs');
  if (!appData || !existsSync(agentScript)) return null;
  const startup = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  mkdirSync(startup, { recursive: true });
  const vbsPath = join(startup, 'reasonix-pet-agent.vbs');
  const command = `"${process.execPath}" "${agentScript}"`;
  const lines = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${PLUGIN_ROOT}"`,
    `shell.Run "${command.replace(/"/g, '""')}", 0, False`,
    '',
  ];
  writeFileSync(vbsPath, lines.join(String.fromCharCode(13, 10)), 'utf8');
  const child = spawn(process.execPath, [agentScript], {
    cwd: PLUGIN_ROOT,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  return vbsPath;
}

if (!agentOnly) {
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

  console.log('[install] applying balance UI patch ...');
  const balancePatch = spawnSync(
    process.execPath,
    [join(PLUGIN_ROOT, 'scripts', 'patch-balance-ui.mjs')],
    { stdio: 'inherit' },
  );
  if (balancePatch.status !== 0) {
    console.error('[install] balance UI patch failed; inspect scripts/patch-balance-ui.mjs.');
    process.exit(1);
  }
}

ensureDirs();
writeFileSync(join(STATE_DIR, 'node-path.txt'), process.execPath, 'utf8');

const vbs = installAgent();
if (vbs) console.log(`[install] supervisor installed: ${vbs}`);

if (!agentOnly && process.argv.includes('--with-electron')) {
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
} else if (!agentOnly) {
  console.log('[install] Electron will be downloaded automatically on the first pet start.');
}

console.log('');
console.log('[install] done.');
console.log('  start:   pet.cmd start   (the supervisor starts it automatically)');
console.log('  status:  pet.cmd status');
