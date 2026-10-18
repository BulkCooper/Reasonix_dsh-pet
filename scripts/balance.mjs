#!/usr/bin/env node
/**
 * Reasonix 适配版余额服务：
 *   - 每 60 秒（可配）查一次 DeepSeek 余额
 *   - 双击宠物 / 右键「刷新余额」时显示气泡
 *   - 余额预警、今日已用、简单峰谷状态
 *   - 监听 Reasonix 的 stats/*.jsonl，按轮汇总本轮消耗
 *
 * 只监听 127.0.0.1:34741；API key 优先读插件配置，其次环境变量与 Reasonix 的 .env。
 * 不会把 key 写进日志或 /status。
 */
import { createServer } from 'node:http';
import * as tls from 'node:tls';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  BALANCE_CONFIG_FILE,
  BALANCE_LEDGER_FILE,
  CHAT_HISTORY_FILE,
  HOME_DIR,
  PLUGIN_ROOT,
  ensureDirs,
  logLine,
  readJson,
  writeJson,
} from './config.mjs';
import { play, say } from './control.mjs';
import { SETTINGS_HTML } from './settings-page.mjs';

// Windows 上 Kaspersky/本地代理常用系统根证书签发；Node 默认只信内置 CA，
// 会导致 SELF_SIGNED_CERT_IN_CHAIN。把系统根证书并入默认 CA（仍校验证书链）。
try {
  if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
    const system = tls.getCACertificates('system');
    const bundled = tls.getCACertificates('bundled');
    if (Array.isArray(system) && system.length) {
      tls.setDefaultCACertificates([...bundled, ...system]);
    }
  }
} catch {
  /* 旧版 Node 没有这个 API，保持默认 CA */
}

const BALANCE_PORT = 34741;
const BEIJING_TZ = 'Asia/Shanghai';
const DEFAULTS = {
  apiKey: '',
  balanceUrl: 'https://api.deepseek.com/user/balance',
  refreshSec: 60,
  alertThreshold: 10,
  clickSound: 'builtin:click-1',
  clickPressSound: 'builtin:click-1',
  clickReleaseSound: 'builtin:click-2',
  chatBaseUrl: 'https://api.deepseek.com/v1',
  chatApiKey: '',
  chatModel: 'deepseek-chat',
  chatPrompt: '你是一只住在 Reasonix 桌面上的蓝发小女仆桌宠，说话自然、简短、温柔带点俏皮；不要提你是 AI。',
  accountVisibility: {},
  accountNames: {},
};


const SOUNDS_DIR = join(HOME_DIR, 'click-sounds');
const SOUNDS_INDEX_FILE = join(SOUNDS_DIR, 'sounds.json');
const SOUND_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a']);
const BUILTIN_SOUNDS = [
  { id: 'builtin:click-1', name: '音效1·按下', file: 'click-1.mp3' },
  { id: 'builtin:click-2', name: '音效1·松开', file: 'click-2.mp3' },
  { id: 'builtin:click-3', name: '小黄鸭·按下', file: 'click-3.mp3' },
  { id: 'builtin:click-4', name: '小黄鸭·松开', file: 'click-4.mp3' },
];

function ensureSoundsDir() {
  mkdirSync(SOUNDS_DIR, { recursive: true });
}

function customSounds() {
  ensureSoundsDir();
  const index = readJson(SOUNDS_INDEX_FILE, {});
  return readdirSync(SOUNDS_DIR)
    .filter((file) => SOUND_EXT.has(extname(file).toLowerCase()))
    .sort()
    .map((file) => ({
      id: `custom:${file}`,
      name: (index[file] && index[file].name) || basename(file, extname(file)),
      file,
      custom: true,
    }));
}

function allSounds() {
  return [...BUILTIN_SOUNDS, ...customSounds()];
}

function soundIdForPhase(config, phase) {
  const available = new Set(allSounds().map((sound) => sound.id));
  const pick = (id) => (id && available.has(id) ? id : '');
  if (phase === 'press') {
    return pick(config.clickPressSound) || pick(config.clickSound) || DEFAULTS.clickPressSound;
  }
  const direct = pick(config.clickReleaseSound);
  if (direct) return direct;
  const press = pick(config.clickPressSound) || pick(config.clickSound) || DEFAULTS.clickPressSound;
  const pair =
    press === 'builtin:click-1'
      ? 'builtin:click-2'
      : press === 'builtin:click-3'
        ? 'builtin:click-4'
        : press;
  return pick(pair) || DEFAULTS.clickReleaseSound;
}

function soundIdFromConfig(config) {
  return soundIdForPhase(config, 'press');
}

function soundUrl(id) {
  return `http://127.0.0.1:${BALANCE_PORT}/sound?id=${encodeURIComponent(id)}`;
}

function soundPath(id) {
  const sound = allSounds().find((item) => item.id === id);
  if (!sound) return null;
  if (sound.custom) return join(SOUNDS_DIR, basename(sound.file));
  return join(PLUGIN_ROOT, 'assets', sound.file);
}

function soundListPayload(config) {
  const press = soundIdForPhase(config, 'press');
  const release = soundIdForPhase(config, 'release');
  return {
    press,
    release,
    sounds: allSounds().map((sound) => ({
      id: sound.id,
      name: sound.name,
      builtin: !sound.custom,
      url: soundUrl(sound.id),
    })),
  };
}

let started = false;
let refreshing = null;
let lastSnapshot = null;
let lastLedger = null;
let lastAccounts = [];
let refreshTimer = null;

function loadConfig() {
  ensureDirs();
  if (!existsSync(BALANCE_CONFIG_FILE)) writeJson(BALANCE_CONFIG_FILE, DEFAULTS);
  return { ...DEFAULTS, ...readJson(BALANCE_CONFIG_FILE, {}) };
}

function readEnvValue(name) {
  const appData = process.env.APPDATA || '';
  for (const file of [join(appData, 'reasonix', '.env'), join(appData, 'reasonix', '.env.local')]) {
    try {
      for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
        const line = raw.trim().replace(/^export\s+/, '');
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        if (line.slice(0, eq).trim() !== name) continue;
        const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (value) return value;
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

function keyFromEnvFile() {
  return readEnvValue('DEEPSEEK_API_KEY');
}

function resolveApiKey(config) {
  return (
    String(config.apiKey || '').trim() ||
    String(process.env.DEEPSEEK_API_KEY || '').trim() ||
    keyFromEnvFile()
  );
}

function readProviders() {
  const file = join(process.env.APPDATA || '', 'reasonix', 'config.toml');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const providers = [];
  let current = null;
  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[[')) {
      if (current) providers.push(current);
      current = line === '[[providers]]' ? {} : null;
      continue;
    }
    if (line.startsWith('[') || !current) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!['name', 'display_name', 'api_key_env', 'balance_url', 'base_url', 'billing_currency'].includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    const hash = value.indexOf('#');
    if (hash >= 0) value = value.slice(0, hash).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    current[key] = value;
  }
  if (current) providers.push(current);
  return providers;
}

function friendlyName(provider) {
  const key = provider.api_key_env || '';
  if (key === 'DEEPSEEK_API_KEY') return 'DeepSeek';
  if (key === 'QLTY_API_KEY') return 'qlty';
  if (key === 'SCNET_API_KEY') return 'SCNet';
  if (key === 'MIMO_TOKEN_PLAN_API_KEY') return 'MiMo';
  if (key === 'DISCOVERY_API_API_KEY') return provider.display_name || 'Discovery';
  if (key.startsWith('REASONIX_CONNECTION_')) return provider.display_name || '本地模型';
  return provider.display_name || provider.name || key;
}

function accountGroups() {
  const map = new Map();
  for (const provider of readProviders()) {
    if (!provider.api_key_env) continue;
    const balanceUrl = provider.balance_url || '';
    const id = `${provider.api_key_env}|${balanceUrl}`;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: friendlyName(provider),
        keyEnv: provider.api_key_env,
        balanceUrl,
        baseUrl: provider.base_url || '',
        providers: [],
      });
    }
    const name = provider.name || provider.display_name || provider.api_key_env;
    if (!map.get(id).providers.includes(name)) map.get(id).providers.push(name);
  }
  return [...map.values()];
}

async function refreshAccounts(config) {
  const accounts = accountGroups();
  const results = await Promise.all(
    accounts.map(async (account) => {
      const key =
        account.keyEnv === 'DEEPSEEK_API_KEY' ? resolveApiKey(config) : readEnvValue(account.keyEnv);
      if (!key) {
        return { ...account, status: 'no-key', total: null, bonus: null, recharge: null, currency: '' };
      }
      if (!account.balanceUrl) {
        return { ...account, status: 'no-balance-api', total: null, bonus: null, recharge: null, currency: '' };
      }
      try {
        const response = await fetch(account.balanceUrl, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          return { ...account, status: `http-${response.status}`, total: null, bonus: null, recharge: null, currency: '' };
        }
        const data = await response.json();
        const info = pickBalanceInfo(data && data.balance_infos);
        if (!info || !Number.isFinite(Number(info.total_balance))) {
          return { ...account, status: 'no-data', total: null, bonus: null, recharge: null, currency: '' };
        }
        return {
          ...account,
          status: 'ok',
          total: Number(info.total_balance),
          bonus: numberOrNull(info.granted_balance),
          recharge: numberOrNull(info.topped_up_balance),
          currency: String(info.currency || 'CNY'),
        };
      } catch {
        return { ...account, status: 'error', total: null, bonus: null, recharge: null, currency: '' };
      }
    }),
  );
  return results.map((account) => {
    const names = config.accountNames && typeof config.accountNames === 'object' ? config.accountNames : {};
    const visibility =
      config.accountVisibility && typeof config.accountVisibility === 'object' ? config.accountVisibility : {};
    const custom = String(names[account.id] || '').trim();
    return {
      ...account,
      defaultName: account.name,
      customName: custom || '',
      name: custom || account.name,
      visible: visibility[account.id] !== false,
    };
  });
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickBalanceInfo(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((item) => item && item.currency === 'CNY') || list[0];
}

async function fetchBalance(config) {
  const key = resolveApiKey(config);
  if (!key) return { ok: false, reason: 'no-key' };
  const url = String(config.balanceUrl || DEFAULTS.balanceUrl);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const data = await response.json();
    const info = pickBalanceInfo(data && data.balance_infos);
    if (!info) return { ok: false, reason: 'bad-response' };
    const total = Number(info.total_balance);
    if (!Number.isFinite(total)) return { ok: false, reason: 'bad-response' };
    return {
      ok: true,
      total,
      bonus: numberOrNull(info.granted_balance),
      recharge: numberOrNull(info.topped_up_balance),
      currency: String(info.currency || 'CNY'),
    };
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, reason };
  }
}

function round8(value) {
  return Math.round(value * 1e8) / 1e8;
}

function beijingDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function updateLedger(snapshot) {
  const day = beijingDay();
  let ledger = readJson(BALANCE_LEDGER_FILE, null);
  if (!ledger || ledger.day !== day) {
    ledger = {
      day,
      startTotal: snapshot.total,
      lastTotal: snapshot.total,
      spent: 0,
      recharge: 0,
      lastAlertAt: 0,
    };
  } else {
    const previous = Number(ledger.lastTotal);
    if (!Number.isFinite(previous)) {
      ledger.lastTotal = snapshot.total;
    } else {
      const delta = previous - snapshot.total;
      if (delta > 0) ledger.spent = round8((Number(ledger.spent) || 0) + delta);
      else if (delta < 0) ledger.recharge = round8((Number(ledger.recharge) || 0) - delta);
      ledger.lastTotal = snapshot.total;
    }
  }
  ledger.currency = snapshot.currency;
  ledger.updatedAt = Date.now();
  writeJson(BALANCE_LEDGER_FILE, ledger);
  return ledger;
}

function clearTodaySpent() {
  const ledger = readJson(BALANCE_LEDGER_FILE, null);
  if (!ledger) return null;
  ledger.spent = 0;
  ledger.startTotal = ledger.lastTotal;
  ledger.updatedAt = Date.now();
  writeJson(BALANCE_LEDGER_FILE, ledger);
  lastLedger = ledger;
  return ledger;
}

function peakInfo(now = new Date()) {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const weekend = day === 0 || day === 6;
  const peak = !weekend && ((minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080));
  let next;
  if (weekend) next = '周一 09:00 转梁文峰';
  else if (minutes < 540) next = '09:00 转梁文峰';
  else if (minutes < 720) next = peak ? '12:00 转梁文谷' : '14:00 转梁文峰';
  else if (minutes < 840) next = '14:00 转梁文峰';
  else if (minutes < 1080) next = peak ? '18:00 转梁文谷' : '下个工作日 09:00 转梁文峰';
  else next = '下个工作日 09:00 转梁文峰';
  return { peak, label: peak ? '梁文峰' : '梁文谷', next };
}

function balanceAnimation(total, threshold) {
  if (total <= 0) return '余额-分文不剩';
  if (threshold > 0 && total < threshold) return '余额-袋空如洗';
  return '余额-钱袋如常';
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function errorText(reason) {
  if (reason === 'no-key') return '未配置 DEEPSEEK_API_KEY：填到插件 home/balance-config.json 或 Reasonix 的 .env';
  if (reason === 'HTTP 401' || reason === 'HTTP 403') return '余额查询失败：API key 无效或无权限';
  if (reason === 'timeout') return '余额查询超时，稍后再试';
  if (reason === 'network') return '余额查询失败：网络错误';
  return `余额查询失败：${reason}`;
}

async function showSnapshot(snapshot, ledger, config, accounts = []) {
  const peak = peakInfo();
  const lines = [];
  const visibleAccounts = accounts.filter((account) => account.visible !== false);
  if (visibleAccounts.length) {
    for (const account of visibleAccounts) {
      lines.push(`${account.name} ${account.status === 'ok' ? `¥${money(account.total)}` : '—'}`);
    }
  } else if (accounts.length) {
    lines.push('余额 —');
  } else {
    let balanceLine = `余额 ¥${money(snapshot.total)}`;
    if (snapshot.bonus !== null && snapshot.bonus > 0) balanceLine += `（赠金 ¥${money(snapshot.bonus)}）`;
    lines.push(balanceLine);
  }
  lines.push(`今日已用 ¥${money(ledger.spent)}`);
  lines.push(peak.label);
  lines.push(peak.next);
  await say(lines.join(String.fromCharCode(10)));
  await play(balanceAnimation(snapshot.total, Number(config.alertThreshold) || 0));
}

async function checkAlert(snapshot, ledger, config) {
  const threshold = Number(config.alertThreshold) || 0;
  if (threshold > 0 && snapshot.total < threshold) {
    const last = Number(ledger.lastAlertAt) || 0;
    if (!last || Date.now() - last > 60 * 60 * 1000) {
      ledger.lastAlertAt = Date.now();
      writeJson(BALANCE_LEDGER_FILE, ledger);
      await say(`⚠️ 余额不足：当前 ¥${money(snapshot.total)}（阈值 ¥${money(threshold)}）`);
      await play('余额-袋空如洗');
      return true;
    }
  } else if (ledger.lastAlertAt) {
    ledger.lastAlertAt = 0;
    writeJson(BALANCE_LEDGER_FILE, ledger);
  }
  return false;
}

function configSummary(config) {
  return {
    refreshSec: Number(config.refreshSec) || DEFAULTS.refreshSec,
    alertThreshold: Number(config.alertThreshold) || 0,
    balanceUrl: String(config.balanceUrl || DEFAULTS.balanceUrl),
    hasApiKey: Boolean(resolveApiKey(config)),
  };
}

async function refresh({ show = false } = {}) {
  if (refreshing) {
    const result = await refreshing;
    if (show && result && result.ok && lastSnapshot && lastLedger) {
      await showSnapshot(lastSnapshot, lastLedger, loadConfig(), lastAccounts);
    }
    return result;
  }
  refreshing = (async () => {
    const config = loadConfig();
    const accounts = await refreshAccounts(config);
    lastAccounts = accounts;
    const deepseek = accounts.find((account) => account.keyEnv === 'DEEPSEEK_API_KEY');
    const primary = deepseek && deepseek.status === 'ok' ? deepseek : accounts.find((account) => account.status === 'ok');
    let snapshot;
    if (primary) {
      snapshot = { ok: true, total: primary.total, bonus: primary.bonus, recharge: primary.recharge, currency: primary.currency };
    } else {
      snapshot = await fetchBalance(config);
    }
    if (!snapshot.ok) {
      logLine('balance', `refresh failed: ${snapshot.reason}`);
      if (show) await say(errorText(snapshot.reason));
      return { ok: false, reason: snapshot.reason, accounts, config: configSummary(config) };
    }
    const ledger = updateLedger(snapshot);
    lastSnapshot = snapshot;
    lastLedger = ledger;
    const alerted = await checkAlert(snapshot, ledger, config);
    if (show && !alerted) await showSnapshot(snapshot, ledger, config, accounts);
    return { ok: true, snapshot, ledger, accounts, peak: peakInfo(), config: configSummary(config) };
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

// ---- 每轮消耗：监听 Reasonix 的 stats/YYYY-MM-DD.jsonl ----
const statsDir = () => process.env.REASONIX_PET_STATS_DIR || join(process.env.APPDATA || '', 'reasonix', 'stats');
let statsFile = '';
let statsOffset = 0;
let turnSum = 0;

function initStats() {
  statsFile = join(statsDir(), `${beijingDay()}.jsonl`);
  try {
    statsOffset = statSync(statsFile).size;
  } catch {
    statsOffset = 0;
  }
}

function pollStats() {
  const file = join(statsDir(), `${beijingDay()}.jsonl`);
  if (file !== statsFile) {
    statsFile = file;
    statsOffset = 0;
    turnSum = 0;
  }
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size < statsOffset) statsOffset = 0;
  if (size === statsOffset) return;
  const length = size - statsOffset;
  let text = '';
  try {
    const fd = openSync(file, 'r');
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, statsOffset);
    closeSync(fd);
    statsOffset = size;
    text = buffer.toString('utf8');
  } catch {
    return;
  }
  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.turn === true) {
        if (turnSum > 0) {
          void say(`本轮消耗 ¥${turnSum.toFixed(4)}`).catch(() => {});
          turnSum = 0;
        }
      } else if (entry.selected_currency === 'CNY') {
        const amount = Number(entry.selected_amount);
        if (Number.isFinite(amount)) turnSum += amount;
      }
    } catch {
      /* 忽略不完整行 */
    }
  }
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        resolve({});
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function hasConfigKey(config) {
  return Boolean(String(config.apiKey || '').trim());
}

function hasEnvKey() {
  return Boolean(String(process.env.DEEPSEEK_API_KEY || '').trim() || keyFromEnvFile());
}

function settingsData() {
  const config = loadConfig();
  return {
    refreshSec: Number(config.refreshSec) || DEFAULTS.refreshSec,
    alertThreshold: Number(config.alertThreshold) || 0,
    hasConfigKey: hasConfigKey(config),
    hasEnvKey: hasEnvKey(),
    clickSound: soundIdFromConfig(config),
    clickPressSound: soundIdForPhase(config, 'press'),
    clickReleaseSound: soundIdForPhase(config, 'release'),
    chatBaseUrl: String(config.chatBaseUrl || DEFAULTS.chatBaseUrl),
    chatModel: String(config.chatModel || DEFAULTS.chatModel),
    chatPrompt: String(config.chatPrompt || DEFAULTS.chatPrompt),
    hasChatKey: Boolean(resolveChatKey(config)),
    hasChatConfigKey: Boolean(String(config.chatApiKey || '').trim()),
  };
}

function applyRefreshInterval(seconds) {
  if (refreshTimer) clearInterval(refreshTimer);
  const safe = Math.max(15, Number(seconds) || DEFAULTS.refreshSec);
  refreshTimer = setInterval(() => {
    void refresh().catch(() => {});
  }, safe * 1000);
}

function saveSettings(body) {
  const config = loadConfig();
  const next = { ...config };
  if (body.clearApiKey === true) next.apiKey = '';
  else if (typeof body.apiKey === 'string' && body.apiKey.trim()) next.apiKey = body.apiKey.trim();
  const refreshSec = Number(body.refreshSec);
  if (Number.isFinite(refreshSec)) next.refreshSec = Math.max(15, Math.round(refreshSec));
  const alertThreshold = Number(body.alertThreshold);
  if (Number.isFinite(alertThreshold)) next.alertThreshold = Math.max(0, alertThreshold);
  if (typeof body.clickSound === 'string' && allSounds().some((sound) => sound.id === body.clickSound)) {
    next.clickSound = body.clickSound;
  }
  if (typeof body.clickPressSound === 'string' && allSounds().some((sound) => sound.id === body.clickPressSound)) {
    next.clickPressSound = body.clickPressSound;
  }
  if (typeof body.clickReleaseSound === 'string' && allSounds().some((sound) => sound.id === body.clickReleaseSound)) {
    next.clickReleaseSound = body.clickReleaseSound;
  }
  if (typeof body.chatBaseUrl === 'string' && body.chatBaseUrl.trim()) next.chatBaseUrl = body.chatBaseUrl.trim();
  if (typeof body.chatModel === 'string' && body.chatModel.trim()) next.chatModel = body.chatModel.trim();
  if (typeof body.chatPrompt === 'string') next.chatPrompt = body.chatPrompt.trim() || DEFAULTS.chatPrompt;
  if (body.clearChatApiKey === true) next.chatApiKey = '';
  else if (typeof body.chatApiKey === 'string' && body.chatApiKey.trim()) next.chatApiKey = body.chatApiKey.trim();
  if (body.accountVisibility && typeof body.accountVisibility === 'object') {
    const visibility = {
      ...(next.accountVisibility && typeof next.accountVisibility === 'object' ? next.accountVisibility : {}),
    };
    for (const [id, visible] of Object.entries(body.accountVisibility)) {
      visibility[String(id)] = visible === true;
    }
    next.accountVisibility = visibility;
  }
  if (body.accountNames && typeof body.accountNames === 'object') {
    const names = {
      ...(next.accountNames && typeof next.accountNames === 'object' ? next.accountNames : {}),
    };
    for (const [id, name] of Object.entries(body.accountNames)) {
      const value = String(name || '').trim().slice(0, 40);
      if (value) names[String(id)] = value;
      else delete names[String(id)];
    }
    next.accountNames = names;
  }
  writeJson(BALANCE_CONFIG_FILE, next);
  applyRefreshInterval(next.refreshSec);
  return configSummary(next);
}

function readBodyBuffer(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

function safeSoundName(raw) {
  const base = basename(String(raw || 'sound'))
    .replace(/[\/:*?"<>|]+/g, '_')
    .slice(0, 80);
  return base || 'sound';
}

function serveSound(res, id) {
  const file = soundPath(String(id || ''));
  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: false, error: 'sound not found' }));
    return;
  }
  const ext = extname(file).toLowerCase();
  const type =
    ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(readFileSync(file));
}

function resolveChatKey(config) {
  return (
    String(config.chatApiKey || '').trim() ||
    resolveApiKey(config) ||
    readEnvValue('DEEPSEEK_API_KEY')
  );
}

function chatUrl(config) {
  let base = String(config.chatBaseUrl || DEFAULTS.chatBaseUrl).trim().replace(/\/+$/, '');
  if (!base) base = DEFAULTS.chatBaseUrl;
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function readChatHistory() {
  const history = readJson(CHAT_HISTORY_FILE, []);
  return Array.isArray(history) ? history : [];
}

function writeChatHistory(messages) {
  writeJson(CHAT_HISTORY_FILE, messages.slice(-20));
}

async function callChat(config, messages, maxTokens = 400) {
  const key = resolveChatKey(config);
  if (!key) throw new Error('no-key');
  const model = String(config.chatModel || DEFAULTS.chatModel).trim();
  if (!model) throw new Error('no-model');
  try {
    const response = await fetch(chatUrl(config), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : '';
    if (typeof content !== 'string' || !content.trim()) throw new Error('empty-reply');
    return content.trim();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('timeout');
    throw error;
  }
}

function chatErrorText(error) {
  const message = error && error.message ? error.message : '';
  if (message === 'no-key') return '对话 API 未配置：右键 → 设置 → 对话 API';
  if (message === 'no-model') return '对话模型未配置：右键 → 设置 → 对话 API';
  if (message === 'timeout') return '对话超时，稍后再试';
  if (message === 'empty-reply') return '对话失败：模型没有返回内容';
  if (message.startsWith('HTTP 401') || message.startsWith('HTTP 403')) return '对话失败：API key 无效或无权限';
  if (message.startsWith('HTTP 404')) return '对话失败：接口地址或模型不存在';
  return '对话失败：网络或接口错误';
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
}

/** 启动余额服务（由常驻 agent 调用）；重复调用无副作用 */
export function startBalanceService() {
  if (started) return;
  started = true;
  ensureDirs();
  const config = loadConfig();
  initStats();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname === '/status') {
      return json(res, 200, {
        ok: true,
        snapshot: lastSnapshot,
        ledger: lastLedger,
        accounts: lastAccounts,
        peak: peakInfo(),
        config: configSummary(loadConfig()),
      });
    }
    if (url.pathname === '/double-click' && req.method === 'POST') {
      const result = await refresh({ show: true });
      return json(res, 200, result);
    }
    if (url.pathname === '/refresh' && req.method === 'POST') {
      const result = await refresh({ show: true });
      return json(res, 200, result);
    }
    if (url.pathname === '/settings' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(SETTINGS_HTML);
      return;
    }
    if (url.pathname === '/settings/data' && req.method === 'GET') {
      return json(res, 200, settingsData());
    }
    if (url.pathname === '/settings' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const config = saveSettings(body);
      return json(res, 200, { ok: true, config });
    }
    if (url.pathname === '/sounds' && req.method === 'GET') {
      return json(res, 200, soundListPayload(loadConfig()));
    }
    if (url.pathname === '/click-sound' && req.method === 'GET') {
      const config = loadConfig();
      const phase = url.searchParams.get('phase') === 'release' ? 'release' : 'press';
      const id = soundIdForPhase(config, phase);
      const sound = allSounds().find((item) => item.id === id) || BUILTIN_SOUNDS[0];
      return json(res, 200, { id: sound.id, name: sound.name, phase, url: soundUrl(sound.id) });
    }
    if (url.pathname === '/click-sounds' && req.method === 'GET') {
      const config = loadConfig();
      const pressId = soundIdForPhase(config, 'press');
      const releaseId = soundIdForPhase(config, 'release');
      const press = allSounds().find((item) => item.id === pressId) || BUILTIN_SOUNDS[0];
      const release = allSounds().find((item) => item.id === releaseId) || BUILTIN_SOUNDS[1];
      return json(res, 200, {
        press: { id: press.id, name: press.name, url: soundUrl(press.id) },
        release: { id: release.id, name: release.name, url: soundUrl(release.id) },
      });
    }
    if (url.pathname === '/sound' && req.method === 'GET') {
      return serveSound(res, url.searchParams.get('id'));
    }
    if (url.pathname === '/sounds/import' && req.method === 'POST') {
      const display = safeSoundName(url.searchParams.get('name'));
      const ext = extname(display).toLowerCase();
      if (!SOUND_EXT.has(ext)) {
        return json(res, 400, { ok: false, error: 'unsupported audio type' });
      }
      const buffer = await readBodyBuffer(req);
      if (!buffer || buffer.length < 100) {
        return json(res, 400, { ok: false, error: 'empty or too large (max 10MB)' });
      }
      ensureSoundsDir();
      const file = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${ext}`;
      writeFileSync(join(SOUNDS_DIR, file), buffer);
      const index = readJson(SOUNDS_INDEX_FILE, {});
      index[file] = { name: basename(display, ext), addedAt: Date.now() };
      writeJson(SOUNDS_INDEX_FILE, index);
      const id = `custom:${file}`;
      return json(res, 200, {
        ok: true,
        sound: { id, name: basename(display, ext), url: soundUrl(id) },
      });
    }
    if (url.pathname === '/chat' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const message = String(body.message || '').trim();
      if (!message) return json(res, 400, { ok: false, error: 'message required' });
      const config = loadConfig();
      if (!resolveChatKey(config)) {
        await say('对话 API 未配置：右键 → 设置 → 对话 API');
        return json(res, 200, { ok: false, error: 'no-key' });
      }
      const history = readChatHistory();
      const messages = [
        { role: 'system', content: String(config.chatPrompt || DEFAULTS.chatPrompt) },
        ...history.slice(-10),
        { role: 'user', content: message },
      ];
      try {
        const reply = await callChat(config, messages, 500);
        writeChatHistory([...history, { role: 'user', content: message }, { role: 'assistant', content: reply }]);
        const bubble = reply.length > 300 ? `${reply.slice(0, 300)}…` : reply;
        await say(bubble);
        return json(res, 200, { ok: true, reply });
      } catch (error) {
        const text = chatErrorText(error);
        logLine('chat', `failed: ${error && error.message ? error.message : String(error)}`);
        await say(text);
        return json(res, 200, { ok: false, error: text });
      }
    }
    if (url.pathname === '/whisper' && req.method === 'POST') {
      const config = loadConfig();
      if (!resolveChatKey(config)) {
        await say('对话 API 未配置：右键 → 设置 → 对话 API');
        return json(res, 200, { ok: false, error: 'no-key' });
      }
      const messages = [
        { role: 'system', content: String(config.chatPrompt || DEFAULTS.chatPrompt) },
        { role: 'user', content: '用一句 20 字以内的话随口碎碎念，不要解释，不要提 AI。' },
      ];
      try {
        const reply = await callChat(config, messages, 80);
        await say(reply);
        return json(res, 200, { ok: true, reply });
      } catch (error) {
        const text = chatErrorText(error);
        logLine('chat', `whisper failed: ${error && error.message ? error.message : String(error)}`);
        await say(text);
        return json(res, 200, { ok: false, error: text });
      }
    }
    if (url.pathname === '/ledger/clear' && req.method === 'POST') {
      const ledger = clearTodaySpent();
      if (!ledger) return json(res, 200, { ok: false, error: 'no-ledger' });
      await say('今日已用已清零');
      return json(res, 200, { ok: true, ledger });
    }
    return json(res, 404, { ok: false, error: 'not found' });
  });

  server.on('error', (error) => logLine('balance', `server error: ${error.message}`));
  server.listen(BALANCE_PORT, '127.0.0.1', () => {
    logLine('balance', `listening 127.0.0.1:${BALANCE_PORT}`);
  });

  setTimeout(() => {
    void refresh().catch(() => {});
  }, 1500);
  applyRefreshInterval(config.refreshSec);
  setInterval(pollStats, 2000);
}
