#!/usr/bin/env node
/**
 * 上游补丁：给桌面宠物加余额交互。
 *   1) 双击宠物：播放音效 + 请求本地余额服务显示余额气泡
 *   2) 右键菜单：「刷新余额」「设置」（设置页由余额服务提供）
 *   3) 把 assets/balance-double-click.mp3 复制到 Electron helper
 *
 * 幂等。升级/重装 dsh-pet 后重新运行，然后 `pet.cmd restart`。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PET_PACKAGE_ROOT, PLUGIN_ROOT } from './config.mjs';

const helper = join(PET_PACKAGE_ROOT, 'runtime', 'electron-helper');
const sprite = join(helper, 'sprite.js');
const audioSource = join(PLUGIN_ROOT, 'assets', 'balance-double-click.mp3');
const audioDest = join(helper, 'balance-double-click.mp3');

if (!existsSync(sprite)) {
  console.error(`sprite.js not found: ${sprite} (install dsh-pet first)`);
  process.exit(1);
}

let source = readFileSync(sprite, 'utf8');
let changed = false;

// ---- 双击 ----
if (!source.includes('onBalanceDoubleClick')) {
  const methodStart = source.indexOf('  onClick() {');
  if (methodStart < 0) {
    console.error('onClick method not found; inspect sprite.js manually.');
    process.exit(1);
  }
  const segment = source.slice(methodStart, methodStart + 600);
  const guardMatch = /if \(d\.active[^\n]*justDragged\) return;\r?\n/.exec(segment);
  if (!guardMatch) {
    console.error('onClick guard not found; inspect sprite.js manually.');
    process.exit(1);
  }
  const insertAt = methodStart + guardMatch.index + guardMatch[0].length;
  const clickPatch =
    "    const now = Date.now();\n" +
    "    if (this.lastClickAt && now - this.lastClickAt < 320) {\n" +
    "      this.lastClickAt = 0;\n" +
    "      this.onBalanceDoubleClick();\n" +
    "      return;\n" +
    "    }\n" +
    "    this.lastClickAt = now;\n";
  source = source.slice(0, insertAt) + clickPatch + source.slice(insertAt);

  const menuAnchor = '  // ---- 右键菜单';
  const menuAt = source.indexOf(menuAnchor);
  if (menuAt < 0) {
    console.error('menu anchor not found; inspect sprite.js manually.');
    process.exit(1);
  }
  const method =
    "  onBalanceDoubleClick() {\n" +
    "    try {\n" +
    "      const audio = new Audio('balance-double-click.mp3');\n" +
    "      audio.volume = 0.85;\n" +
    "      audio.play().catch(() => {});\n" +
    "    } catch {\n" +
    "      /* ignore */\n" +
    "    }\n" +
    "    fetch('http://127.0.0.1:34741/double-click', { method: 'POST' }).catch(() => {});\n" +
    "  }\n\n";
  source = source.slice(0, menuAt) + method + source.slice(menuAt);
  changed = true;
}

// ---- 右键：刷新余额 ----
if (!source.includes("leaf.action === 'refresh-balance'")) {
  const actionMatch = /^[ \t]*if \(leaf\.action === 'open-site'\) \{\r?\n/m.exec(source);
  if (!actionMatch) {
    console.error('menu action anchor not found; inspect sprite.js manually.');
    process.exit(1);
  }
  const actionAt = actionMatch.index;
  const action =
    "    if (leaf.action === 'refresh-balance') {\n" +
    "      fetch('http://127.0.0.1:34741/refresh', { method: 'POST' }).catch(() => {});\n" +
    "      return;\n" +
    "    }\n";
  source = source.slice(0, actionAt) + action + source.slice(actionAt);
  changed = true;
}

// ---- 右键：设置 ----
if (!source.includes("leaf.action === 'settings'")) {
  const refreshAt = source.indexOf("    if (leaf.action === 'refresh-balance') {");
  if (refreshAt < 0) {
    console.error('refresh-balance action anchor not found; inspect sprite.js manually.');
    process.exit(1);
  }
  const settingsAction =
    "    if (leaf.action === 'settings') {\n" +
    "      if (window.petBridge) window.petBridge.openDshSite('http://127.0.0.1:34741/settings');\n" +
    "      else window.open('http://127.0.0.1:34741/settings', '_blank');\n" +
    "      return;\n" +
    "    }\n";
  source = source.slice(0, refreshAt) + settingsAction + source.slice(refreshAt);
  changed = true;
}

// ---- 工具项：刷新余额 + 设置 ----
if (!source.includes("label: '设置'")) {
  const lineStart = source.indexOf('    const tools = [');
  if (lineStart < 0) {
    console.error('menu tools line not found; inspect sprite.js manually.');
    process.exit(1);
  }
  const lineEnd = source.indexOf('\n', lineStart);
  source =
    source.slice(0, lineStart) +
    "    const tools = [{ label: '刷新余额', action: 'refresh-balance' }, { label: '设置', action: 'settings' }]; // Reasonix: balance + settings" +
    source.slice(lineEnd);
  changed = true;
}

if (changed) {
  writeFileSync(sprite, source, 'utf8');
  console.log('balance UI patched.');
} else {
  console.log('balance UI already patched.');
}

if (existsSync(audioSource)) {
  mkdirSync(dirname(audioDest), { recursive: true });
  copyFileSync(audioSource, audioDest);
  console.log(`audio copied: ${audioDest}`);
} else {
  console.warn(`audio source missing: ${audioSource}`);
}
