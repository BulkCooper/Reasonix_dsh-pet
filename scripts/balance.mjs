#!/usr/bin/env node
/**
 * Reasonix 适配版余额服务：
 *   - 每 60 秒（可配）查一次 DeepSeek 余额
 *   - 双击宠物 / 右键「刷新余额」时显示气泡
 *   - 余额预警、今日已用、简单峰谷状态
 *
 * 只监听 127.0.0.1:34741；API key 只读插件设置 home/balance-config.json，
 * 不读取 Reasonix 的 .env/config.toml/stats，也不读取任何其他组件的凭证。
 * 不会把 key 写进日志、/status 或 /settings/data。
 *
 * 账户模型（balance-config.json）：
 *   { accounts: [{ id, name, balanceUrl, key, visible }] }，最多 10 个；
 *   旧的顶层 apiKey/balanceUrl 会一次性迁移成默认账户。
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import * as tls from 'node:tls';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  loadState,
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
const HOST_PID = Number(process.env.DSH_PET_HOST_PID || 0);
if (HOST_PID > 0) {
  setInterval(() => {
    try {
      process.kill(HOST_PID, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref?.();
}
const BEIJING_TZ = 'Asia/Shanghai';
const MAX_ACCOUNTS = 10;
const DEFAULT_ACCOUNT_ID = 'acc-default';
const DEFAULTS = {
  apiKey: '',
  balanceUrl: 'https://api.deepseek.com/user/balance',
  accounts: [],
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
  autoReturnEnabled: true,
  autoReturnDelaySec: 60,
  petSize: 320,
  bubbleScale: 1,
  bubbleFontSize: 14,
  returnAnchor: null,
};

const PET_CONFIG_FILE = join(HOME_DIR, 'dsh-pet', 'main-config.jsonc');

/** dsh-pet 的 main-config.jsonc 是 JSONC（当前只有整行注释）：去掉注释后按 JSON 处理。 */
function parsePetConfig(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
}

function readPetConfigFile() {
  try {
    return parsePetConfig(readFileSync(PET_CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeReturnAnchor(value) {
  if (!value || typeof value !== 'object') return null;
  const rx = Number(value.rx);
  const ry = Number(value.ry);
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
  return { rx: Math.max(0, Math.min(1, rx)), ry: Math.max(0, Math.min(1, ry)) };
}

function readPetSize(config) {
  const cfg = readPetConfigFile();
  const pets = cfg && Array.isArray(cfg.pets) ? cfg.pets : [];
  const pet = pets.find((p) => p && p.id === 'main') || pets[0];
  const n = Number(pet && pet.size);
  if (Number.isFinite(n) && n > 0) return Math.max(160, Math.min(640, Math.round(n)));
  return Math.max(160, Math.min(640, Math.round(Number(config && config.petSize) || 320)));
}

function writePetSize(size) {
  const cfg = readPetConfigFile();
  if (!cfg || !Array.isArray(cfg.pets) || !cfg.pets.length) return false;
  for (const pet of cfg.pets) pet.size = size;
  writeFileSync(PET_CONFIG_FILE, JSON.stringify(cfg, null, 2) + String.fromCharCode(10), 'utf8');
  return true;
}

async function reloadPetRuntime() {
  try {
    const state = loadState();
    if (!state || !state.port) return;
    await fetch(`http://127.0.0.1:${state.port}/dsh-pet-7340/reload`, {
      method: 'POST',
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* 桌宠未运行：下次启动时使用新 size */
  }
}


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

// ---------- 账户模型 ----------
// balance-config.json 的 accounts 是唯一凭证来源；不读取任何外部文件或环境变量凭证。

function defaultAccountName(index) {
  return `账户 ${index + 1}`;
}

function sanitizeAccountId(raw) {
  return String(raw || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);
}

/** 余额接口地址只允许 http(s)；空字符串表示未填写 */
function parseBalanceUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { ok: true, value: '' };
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, value: '' };
    return { ok: true, value: url.href };
  } catch {
    return { ok: false, value: '' };
  }
}

function normalizeBalanceUrl(raw) {
  return parseBalanceUrl(raw).value;
}

/** 由内容推导稳定 id：同样的名称 + 地址重复提交只会得到一个账户 */
function stableAccountId(name, balanceUrl) {
  const digest = createHash('sha1')
    .update(`${String(name || '')}\u0000${String(balanceUrl || '')}`)
    .digest('hex')
    .slice(0, 10);
  return `acc-${digest}`;
}

function uniqueAccountId(base, seen) {
  const candidate = base || 'acc';
  if (!seen.has(candidate)) return candidate;
  for (let index = 2; index < 500; index += 1) {
    const next = `${candidate}-${index}`;
    if (!seen.has(next)) return next;
  }
  return `${candidate}-${Date.now().toString(36)}`;
}

function normalizeAccount(raw, index, seen) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 40) || defaultAccountName(index);
  const balanceUrl = normalizeBalanceUrl(raw.balanceUrl);
  const key = typeof raw.key === 'string' ? raw.key.trim().slice(0, 200) : '';
  const id = uniqueAccountId(sanitizeAccountId(raw.id) || stableAccountId(name, balanceUrl), seen);
  return { id, name, balanceUrl, key, visible: raw.visible !== false };
}

function normalizeAccounts(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const seen = new Set();
  const accounts = [];
  for (let index = 0; index < list.length && accounts.length < MAX_ACCOUNTS; index += 1) {
    const account = normalizeAccount(list[index], accounts.length, seen);
    if (!account) continue;
    seen.add(account.id);
    accounts.push(account);
  }
  return accounts;
}

/** 旧配置（顶层 apiKey/balanceUrl + 可选 accountNames/accountVisibility）→ 默认账户 */
function migrateLegacyAccounts(config) {
  const legacyKey = String(config.apiKey || '').trim().slice(0, 200);
  const legacyUrl = normalizeBalanceUrl(config.balanceUrl);
  if (!legacyKey && !legacyUrl) return [];
  const names = config.accountNames && typeof config.accountNames === 'object' ? config.accountNames : {};
  const visibility =
    config.accountVisibility && typeof config.accountVisibility === 'object' ? config.accountVisibility : {};
  const legacyId = 'manual:deepseek';
  return [
    {
      id: DEFAULT_ACCOUNT_ID,
      name: String(names[legacyId] || '').trim().slice(0, 40) || 'DeepSeek',
      balanceUrl: legacyUrl || DEFAULTS.balanceUrl,
      key: legacyKey,
      visible: visibility[legacyId] !== false,
    },
  ];
}

function accountsHaveKey(config) {
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  return accounts.some((account) => Boolean(account && account.key));
}

/** 读取插件自己的配置并规范化账户；迁移只发生一次，不触碰 Reasonix 的任何文件 */
function loadConfig() {
  ensureDirs();
  const raw = readJson(BALANCE_CONFIG_FILE, null);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const config = { ...DEFAULTS, ...source };
  const hasAccountsField = Array.isArray(source.accounts);
  const accounts = hasAccountsField ? normalizeAccounts(source.accounts) : migrateLegacyAccounts(config);
  const next = { ...config, accounts };
  if (!hasAccountsField || JSON.stringify(accounts) !== JSON.stringify(source.accounts)) {
    next.apiKey = '';
    next.accountNames = {};
    next.accountVisibility = {};
    next.balanceUrl = accounts[0] ? accounts[0].balanceUrl : DEFAULTS.balanceUrl;
    writeJson(BALANCE_CONFIG_FILE, next);
  }
  return next;
}

function accountEmptyBalance() {
  return { total: null, bonus: null, recharge: null, currency: '' };
}

/**
 * 单个账户独立查询：只使用用户在插件设置里填写的 key/余额地址，一个账户失败不影响其他账户。
 * 不读取 Reasonix 的 .env、config.toml、stats 或任何其他组件凭证。
 */
async function queryAccount(account) {
  const base = {
    id: account.id,
    name: account.name,
    balanceUrl: account.balanceUrl,
    visible: account.visible !== false,
    hasKey: Boolean(account.key),
  };
  if (!account.key) return { ...base, ...accountEmptyBalance(), status: 'no-key' };
  if (!account.balanceUrl) return { ...base, ...accountEmptyBalance(), status: 'no-url' };
  try {
    const response = await fetch(account.balanceUrl, {
      headers: { Authorization: `Bearer ${account.key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      logLine('balance', `account ${account.id} http ${response.status}`);
      return { ...base, ...accountEmptyBalance(), status: `http-${response.status}` };
    }
    const data = await response.json();
    const info = pickBalanceInfo(data && data.balance_infos);
    const total = info ? Number(info.total_balance) : Number.NaN;
    if (!Number.isFinite(total)) return { ...base, ...accountEmptyBalance(), status: 'bad-response' };
    return {
      ...base,
      status: 'ok',
      total,
      bonus: numberOrNull(info.granted_balance),
      recharge: numberOrNull(info.topped_up_balance),
      currency: String(info.currency || 'CNY'),
    };
  } catch (error) {
    const status = error && error.name === 'AbortError' ? 'timeout' : 'network';
    logLine('balance', `account ${account.id} ${status}`);
    return { ...base, ...accountEmptyBalance(), status };
  }
}

async function refreshAccounts(config) {
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  if (!accounts.length) return [];
  const settled = await Promise.allSettled(accounts.map((account) => queryAccount(account)));
  return settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    const account = accounts[index];
    return {
      id: account.id,
      name: account.name,
      balanceUrl: account.balanceUrl,
      visible: account.visible !== false,
      hasKey: Boolean(account.key),
      ...accountEmptyBalance(),
      status: 'network',
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
  const accountId = String(snapshot.accountId || '');
  let ledger = readJson(BALANCE_LEDGER_FILE, null);
  // 主账户换人时重置基线，避免把不同账户的余额差算成“今日已用”
  const switched = Boolean(ledger && ledger.accountId && accountId && ledger.accountId !== accountId);
  if (!ledger || ledger.day !== day || switched) {
    ledger = {
      day,
      accountId,
      startTotal: snapshot.total,
      lastTotal: snapshot.total,
      spent: 0,
      recharge: 0,
      lastAlertAt: 0,
    };
  } else {
    if (accountId) ledger.accountId = accountId;
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

function accountStatusText(status) {
  const value = String(status || '');
  if (value === 'ok') return '已查询';
  if (value === 'no-key') return '未配置 key';
  if (value === 'no-url') return '未填接口';
  if (value === 'timeout') return '查询超时';
  if (value === 'network') return '网络错误';
  if (value === 'bad-response') return '接口异常';
  if (value === 'http-401' || value === 'http-403') return 'key 无效';
  if (value.startsWith('http-')) return `HTTP ${value.slice(5)}`;
  if (value === 'no-accounts') return '未配置账户';
  return '查询失败';
}

function errorText(reason) {
  const value = String(reason || '');
  if (value === 'no-accounts') return '未配置余额账户：请在插件设置里添加';
  if (value === 'no-key') return '未配置账户 API key：请在插件设置里填写';
  if (value === 'no-url') return '账户未填余额接口地址：请在插件设置里补充';
  if (value === 'http-401' || value === 'http-403') return '余额查询失败：API key 无效或无权限';
  if (value === 'timeout') return '余额查询超时，稍后再试';
  if (value === 'network') return '余额查询失败：网络错误';
  if (value === 'bad-response') return '余额查询失败：接口返回格式不对';
  if (value.startsWith('http-')) return `余额查询失败：HTTP ${value.slice(5)}`;
  return `余额查询失败：${value || '未知原因'}`;
}

async function showSnapshot(snapshot, ledger, config, accounts = []) {
  const peak = peakInfo();
  const lines = [];
  const listed = accounts.filter((account) => account.visible !== false);
  if (listed.length) {
    for (const account of listed) {
      if (account.status === 'ok') {
        let line = `${account.name} ¥${money(account.total)}`;
        if (account.bonus !== null && account.bonus > 0) line += `（赠金 ¥${money(account.bonus)}）`;
        lines.push(line);
      } else {
        lines.push(`${account.name} ${accountStatusText(account.status)}`);
      }
    }
  } else if (accounts.length) {
    lines.push('余额 —（账户都未勾选气泡显示）');
  } else {
    lines.push('未配置余额账户');
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
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  return {
    refreshSec: Number(config.refreshSec) || DEFAULTS.refreshSec,
    alertThreshold: Number(config.alertThreshold) || 0,
    autoReturnEnabled: config.autoReturnEnabled !== false,
    autoReturnDelaySec: Number.isFinite(Number(config.autoReturnDelaySec)) ? Math.max(0, Math.round(Number(config.autoReturnDelaySec))) : DEFAULTS.autoReturnDelaySec,
    petSize: readPetSize(config),
    bubbleScale: Number.isFinite(Number(config.bubbleScale)) ? Math.max(0.6, Math.min(2, Number(config.bubbleScale))) : DEFAULTS.bubbleScale,
    bubbleFontSize: Number.isFinite(Number(config.bubbleFontSize)) ? Math.max(10, Math.min(30, Math.round(Number(config.bubbleFontSize)))) : DEFAULTS.bubbleFontSize,
    balanceUrl: accounts[0] ? accounts[0].balanceUrl : DEFAULTS.balanceUrl,
    hasApiKey: accountsHaveKey(config),
    accountCount: accounts.length,
  };
}

/** 第一个查到余额的账户作为主 snapshot（驱动预警、今日已用、气泡） */
function primarySnapshot(accounts) {
  const primary = accounts.find((account) => account.status === 'ok');
  if (primary) {
    return {
      ok: true,
      total: primary.total,
      bonus: primary.bonus,
      recharge: primary.recharge,
      currency: primary.currency,
      accountId: primary.id,
      accountName: primary.name,
    };
  }
  const first = accounts[0];
  return { ok: false, reason: first ? first.status : 'no-accounts', accountId: first ? first.id : '' };
}

async function refresh({ show = false, force = false } = {}) {
  if (refreshing) {
    if (!force) {
      const result = await refreshing;
      if (show && result && result.ok && lastSnapshot && lastLedger) {
        await showSnapshot(lastSnapshot, lastLedger, loadConfig(), lastAccounts);
      }
      return result;
    }
    // 保存设置后强制用新配置重查：先等旧任务收尾
    try {
      await refreshing;
    } catch {
      /* 旧任务失败不影响新任务 */
    }
  }
  const task = (async () => {
    const config = loadConfig();
    const accounts = await refreshAccounts(config);
    lastAccounts = accounts;
    const snapshot = primarySnapshot(accounts);
    if (!snapshot.ok) {
      logLine('balance', `refresh failed: ${snapshot.reason} accounts=${accounts.length}`);
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
  refreshing = task;
  try {
    return await task;
  } finally {
    if (refreshing === task) refreshing = null;
  }
}

/** 保存设置后触发一次新配置刷新，最多等 ms 毫秒，不阻塞保存响应太久 */
async function refreshAfterSave(ms = 4000) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    await Promise.race([refresh({ force: true }).catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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

/** 脱敏账户：只暴露 id/name/URL/可见性/是否有 key，绝不返回 key 本身 */
function publicAccounts(config) {
  return (Array.isArray(config.accounts) ? config.accounts : []).map((account) => ({
    id: account.id,
    name: account.name,
    balanceUrl: account.balanceUrl,
    visible: account.visible !== false,
    hasKey: Boolean(account.key),
  }));
}

function settingsData() {
  const config = loadConfig();
  return {
    refreshSec: Number(config.refreshSec) || DEFAULTS.refreshSec,
    alertThreshold: Number(config.alertThreshold) || 0,
    autoReturnEnabled: config.autoReturnEnabled !== false,
    autoReturnDelaySec: Number.isFinite(Number(config.autoReturnDelaySec)) ? Math.max(0, Math.round(Number(config.autoReturnDelaySec))) : DEFAULTS.autoReturnDelaySec,
    petSize: readPetSize(config),
    bubbleScale: Number.isFinite(Number(config.bubbleScale)) ? Math.max(0.6, Math.min(2, Number(config.bubbleScale))) : DEFAULTS.bubbleScale,
    bubbleFontSize: Number.isFinite(Number(config.bubbleFontSize)) ? Math.max(10, Math.min(30, Math.round(Number(config.bubbleFontSize)))) : DEFAULTS.bubbleFontSize,
    hasConfigKey: accountsHaveKey(config),
    hasEnvKey: false,
    accounts: publicAccounts(config),
    maxAccounts: MAX_ACCOUNTS,
    defaultBalanceUrl: DEFAULTS.balanceUrl,
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

function isMeaningfulAccountRow(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return Boolean(
    String(raw.name || '').trim() ||
      String(raw.balanceUrl || '').trim() ||
      (typeof raw.key === 'string' && raw.key.trim()),
  );
}

/** 合并前端提交的账户：新增 / 编辑 / 删除；key 留空表示保留旧 key，删除账户即删除其 key */
function mergeIncomingAccounts(config, incoming) {
  const current = Array.isArray(config.accounts) ? config.accounts : [];
  const byId = new Map(current.map((account) => [account.id, account]));
  const seen = new Set();
  const accounts = [];
  const warnings = [];
  const list = Array.isArray(incoming) ? incoming : [];
  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index];
    if (!raw || typeof raw !== 'object') continue;
    const rawId = sanitizeAccountId(raw.id);
    const existing = rawId ? byId.get(rawId) : null;
    // 新行且什么都没填：直接忽略，避免产生空账户
    if (!existing && !isMeaningfulAccountRow(raw)) continue;
    const nameRaw = String(raw.name || '').trim().slice(0, 40);
    const parsed = parseBalanceUrl(raw.balanceUrl);
    if (!parsed.ok) {
      warnings.push(
        `账户「${nameRaw || (existing && existing.name) || '未命名'}」的余额接口地址不合法（只支持 http/https），已跳过`,
      );
      continue;
    }
    if (accounts.length >= MAX_ACCOUNTS) {
      if (list.slice(index + 1).some(isMeaningfulAccountRow)) {
        warnings.push(`最多 ${MAX_ACCOUNTS} 个账户，多余的已忽略`);
      }
      break;
    }
    const keyRaw = typeof raw.key === 'string' ? raw.key.trim().slice(0, 200) : '';
    let key = existing ? String(existing.key || '') : '';
    if (raw.clearKey === true) key = '';
    if (keyRaw) key = keyRaw;
    const name = nameRaw || (existing && existing.name) || defaultAccountName(accounts.length);
    const id = uniqueAccountId(existing ? existing.id : rawId || stableAccountId(name, parsed.value), seen);
    seen.add(id);
    accounts.push({ id, name, balanceUrl: parsed.value, key, visible: raw.visible !== false });
  }
  return { accounts, warnings };
}

function saveSettings(body) {
  const config = loadConfig();
  const next = { ...config };
  const warnings = [];
  if (Array.isArray(body.accounts)) {
    const merged = mergeIncomingAccounts(config, body.accounts);
    next.accounts = merged.accounts;
    warnings.push(...merged.warnings);
    // 账户是唯一凭证来源：清掉旧顶层 key 与旧映射，避免删除后又“复活”
    next.apiKey = '';
    next.accountNames = {};
    next.accountVisibility = {};
    next.balanceUrl = merged.accounts[0] ? merged.accounts[0].balanceUrl : DEFAULTS.balanceUrl;
  } else {
    // 旧版客户端（没传 accounts）：把顶层 apiKey / 名称 / 可见性映射到账户
    const accounts = (Array.isArray(next.accounts) ? next.accounts : []).map((account) => ({ ...account }));
    const legacyKey = typeof body.apiKey === 'string' ? body.apiKey.trim().slice(0, 200) : '';
    if (body.clearApiKey === true || legacyKey) {
      if (!accounts.length && legacyKey) {
        accounts.push({
          id: DEFAULT_ACCOUNT_ID,
          name: 'DeepSeek',
          balanceUrl: normalizeBalanceUrl(next.balanceUrl) || DEFAULTS.balanceUrl,
          key: legacyKey,
          visible: true,
        });
      } else if (accounts.length) {
        accounts[0] = { ...accounts[0], key: body.clearApiKey === true ? '' : legacyKey };
      }
    }
    if (body.accountNames && typeof body.accountNames === 'object') {
      for (const account of accounts) {
        const raw = body.accountNames[account.id];
        if (raw === undefined) continue;
        const value = String(raw || '').trim().slice(0, 40);
        if (value) account.name = value;
      }
    }
    if (body.accountVisibility && typeof body.accountVisibility === 'object') {
      for (const account of accounts) {
        const raw = body.accountVisibility[account.id];
        if (raw === undefined) continue;
        account.visible = raw === true;
      }
    }
    next.accounts = accounts;
    next.apiKey = '';
    next.accountNames = {};
    next.accountVisibility = {};
  }
  const refreshSec = Number(body.refreshSec);
  if (Number.isFinite(refreshSec)) next.refreshSec = Math.max(15, Math.round(refreshSec));
  const alertThreshold = Number(body.alertThreshold);
  if (Number.isFinite(alertThreshold)) next.alertThreshold = Math.max(0, alertThreshold);
  if (typeof body.autoReturnEnabled === 'boolean') next.autoReturnEnabled = body.autoReturnEnabled;
  const autoReturnDelaySec = Number(body.autoReturnDelaySec);
  if (Number.isFinite(autoReturnDelaySec)) next.autoReturnDelaySec = Math.max(0, Math.min(3600, Math.round(autoReturnDelaySec)));
  let reloadPet = false;
  const petSize = Number(body.petSize);
  if (Number.isFinite(petSize)) {
    const safeSize = Math.max(160, Math.min(640, Math.round(petSize)));
    if (safeSize !== readPetSize(next)) {
      next.petSize = safeSize;
      reloadPet = writePetSize(safeSize);
    } else {
      next.petSize = safeSize;
    }
  }
  const bubbleScale = Number(body.bubbleScale);
  if (Number.isFinite(bubbleScale)) next.bubbleScale = Math.max(0.6, Math.min(2, bubbleScale));
  const bubbleFontSize = Number(body.bubbleFontSize);
  if (Number.isFinite(bubbleFontSize)) next.bubbleFontSize = Math.max(10, Math.min(30, Math.round(bubbleFontSize)));
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
  writeJson(BALANCE_CONFIG_FILE, next);
  applyRefreshInterval(next.refreshSec);
  return { config: configSummary(next), warnings, reloadPet };
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

/** 对话 key：优先对话专用 key，其次第一个有 key 的账户（不读取任何环境变量） */
function resolveChatKey(config) {
  const direct = String(config.chatApiKey || '').trim();
  if (direct) return direct;
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  const withKey = accounts.find((account) => Boolean(account && account.key));
  if (withKey) return String(withKey.key).trim();
  return String(config.apiKey || '').trim();
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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    // 只允许插件自己的两个本地页面/Electron file origin 访问面板；
    // 防止任意网页借 CORS 调用 /chat、/settings 消耗用户的 key。
    const origin = req.headers.origin;
    const allowedOrigins = new Set([
      'null',
      'file://',
      'http://127.0.0.1:34740',
      'http://localhost:34740',
      'http://127.0.0.1:34741',
      'http://localhost:34741',
    ]);
    if (origin && !allowedOrigins.has(origin)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
      return;
    }
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
    if (url.pathname === '/behavior' && req.method === 'GET') {
      const config = loadConfig();
      const delay = Number(config.autoReturnDelaySec);
      return json(res, 200, {
        autoReturnEnabled: config.autoReturnEnabled !== false,
        autoReturnDelaySec: Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : DEFAULTS.autoReturnDelaySec,
        petSize: readPetSize(config),
        bubbleScale: Number.isFinite(Number(config.bubbleScale)) ? Math.max(0.6, Math.min(2, Number(config.bubbleScale))) : DEFAULTS.bubbleScale,
        bubbleFontSize: Number.isFinite(Number(config.bubbleFontSize)) ? Math.max(10, Math.min(30, Math.round(Number(config.bubbleFontSize)))) : DEFAULTS.bubbleFontSize,
        returnAnchor: normalizeReturnAnchor(config.returnAnchor),
      });
    }
    if (url.pathname === '/return-anchor' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const config = loadConfig();
      const anchor = body && body.clear === true ? null : normalizeReturnAnchor(body);
      if (body && body.clear !== true && !anchor) {
        return json(res, 400, { ok: false, error: 'invalid anchor: expected {rx,ry} in 0..1' });
      }
      config.returnAnchor = anchor;
      writeJson(BALANCE_CONFIG_FILE, config);
      return json(res, 200, { ok: true, returnAnchor: anchor });
    }
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
      let saved;
      try {
        saved = saveSettings(body);
      } catch (error) {
        logLine('balance', `save settings failed: ${error && error.message ? error.message : String(error)}`);
        return json(res, 500, { ok: false, error: '保存失败：配置文件无法写入' });
      }
      // 保存后立刻用新配置刷新一次账户余额（限时，避免保存请求卡太久）
      await refreshAfterSave();
      if (saved.reloadPet) void reloadPetRuntime();
      const data = settingsData();
      return json(res, 200, {
        ok: true,
        config: saved.config,
        warnings: saved.warnings,
        accounts: data.accounts,
      });
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
      const message = String(body.message || body.text || '').trim();
      if (!message) return json(res, 400, { ok: false, error: 'message required' });
      const config = loadConfig();
      if (!resolveChatKey(config)) {
        await say('对话 API 未配置：右键 → 设置 → 对话 API');
        return json(res, 200, { ok: false, error: 'no-key', message: '对话 API 未配置：右键 → 设置 → 对话 API' });
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
        return json(res, 200, { ok: false, error: text, message: text });
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
    if (url.pathname === '/shutdown' && req.method === 'POST') {
      json(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100);
      return;
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
}

startBalanceService();
