#!/usr/bin/env node
/**
 * 上游补丁：给桌面宠物加余额交互。
 *   1) 双击宠物：随机播放一个点击音效 + 请求余额服务显示多行余额气泡
 *   2) 右键菜单：「刷新余额」「设置」
 *   3) 气泡支持多行（余额 / 今日 / 梁文峰谷 / 切换时间）
 *
 * 幂等。升级/重装 dsh-pet 后重新运行，然后 `pet.cmd restart`。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PET_PACKAGE_ROOT, PLUGIN_ROOT } from './config.mjs';

const helper = join(PET_PACKAGE_ROOT, 'runtime', 'electron-helper');
const sprite = join(helper, 'sprite.js');
const CLICK_SOUNDS = ['click-1.mp3', 'click-2.mp3', 'click-3.mp3', 'click-4.mp3'];

if (!existsSync(sprite)) {
  console.error(`sprite.js not found: ${sprite} (install dsh-pet first)`);
  process.exit(1);
}

let source = readFileSync(sprite, 'utf8');
let changed = false;

const doubleClickMethod =
  "  onBalanceDoubleClick() {\n" +
  "    const playSound = (src) => {\n" +
  "      try {\n" +
  "        const audio = new Audio(src);\n" +
  "        audio.volume = 0.85;\n" +
  "        audio.play().catch(() => {});\n" +
  "      } catch {\n" +
  "        /* ignore */\n" +
  "      }\n" +
  "    };\n" +
  "    fetch('http://127.0.0.1:34741/click-sound')\n" +
  "      .then((response) => (response.ok ? response.json() : null))\n" +
  "      .then((data) => playSound(data && data.url ? data.url : 'click-1.mp3'))\n" +
  "      .catch(() => playSound('click-1.mp3'));\n" +
  "    fetch('http://127.0.0.1:34741/double-click', { method: 'POST' }).catch(() => {});\n" +
  "  }\n\n";

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
  source = source.slice(0, menuAt) + doubleClickMethod + source.slice(menuAt);
  changed = true;
}

// ---- 双击音效：旧的随机/单音效改为跟随设置 ----
if (!source.includes('34741/click-sound')) {
  const methodStart = source.indexOf('  onBalanceDoubleClick() {');
  const menuAt = source.indexOf('  // ---- 右键菜单', methodStart);
  if (methodStart >= 0 && menuAt > methodStart) {
    source = source.slice(0, methodStart) + doubleClickMethod + source.slice(menuAt);
    changed = true;
  }
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

// ---- 对话 / 碎碎念：改用余额服务的可配置对话 API ----
if (source.includes('this.showWhisperFromMenu();')) {
  source = source.replace(
    'this.showWhisperFromMenu();',
    "fetch('http://127.0.0.1:34741/whisper', { method: 'POST' }).catch(() => {});",
  );
  changed = true;
}
if (source.includes('this.showChatFromMenu();')) {
  source = source.replace(
    'this.showChatFromMenu();',
    "const message = window.prompt('和桌宠说点什么？');\n" +
      "      if (message) fetch('http://127.0.0.1:34741/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) }).catch(() => {});",
  );
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

// ---- 多行气泡：whisper（/broadcast）文本按换行拆成多行 ----
const whisperTextLine = "line.textContent = this.whisperView[0]?.text ?? '';";
const whisperAt = source.indexOf(whisperTextLine);
if (whisperAt >= 0) {
  const whisperStart = source.lastIndexOf("      const line = document.createElement('div');", whisperAt);
  const whisperEndMarker = "      this.bubble.appendChild(line);";
  const whisperEnd = source.indexOf(whisperEndMarker, whisperAt);
  if (whisperStart >= 0 && whisperEnd >= 0) {
    const whisperEndAt = whisperEnd + whisperEndMarker.length;
    const whisperNew =
      "      const whisperText = this.whisperView[0]?.text ?? '';\n" +
      "      for (const part of whisperText.split(String.fromCharCode(10))) {\n" +
      "        const line = document.createElement('div');\n" +
      "        line.className = 'pet-bub-row';\n" +
      "        line.textContent = part;\n" +
      "        this.bubble.appendChild(line);\n" +
      "      }";
    source = source.slice(0, whisperStart) + whisperNew + source.slice(whisperEndAt);
    changed = true;
  }
}

if (changed) {
  writeFileSync(sprite, source, 'utf8');
  console.log('balance UI patched.');
} else {
  console.log('balance UI already patched.');
}

for (const name of CLICK_SOUNDS) {
  const src = join(PLUGIN_ROOT, 'assets', name);
  const dest = join(helper, name);
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`audio copied: ${dest}`);
  } else {
    console.warn(`audio source missing: ${src}`);
  }
}
