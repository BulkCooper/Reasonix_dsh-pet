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
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BALANCE_CONFIG_FILE,
  BALANCE_LEDGER_FILE,
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
};

let started = false;
let refreshing = null;
let lastSnapshot = null;
let lastLedger = null;
let refreshTimer = null;

function loadConfig() {
  ensureDirs();
  if (!existsSync(BALANCE_CONFIG_FILE)) writeJson(BALANCE_CONFIG_FILE, DEFAULTS);
  return { ...DEFAULTS, ...readJson(BALANCE_CONFIG_FILE, {}) };
}

function keyFromEnvFile() {
  const appData = process.env.APPDATA || '';
  for (const file of [join(appData, 'reasonix', '.env'), join(appData, 'reasonix', '.env.local')]) {
    try {
      for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
        const line = raw.trim().replace(/^export\s+/, '');
        const match = /^DEEPSEEK_API_KEY\s*=\s*(.*)$/.exec(line);
        if (match) {
          const value = match[1].trim().replace(/^['"]|['"]$/g, '');
          if (value) return value;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return '';
}

function resolveApiKey(config) {
  return (
    String(config.apiKey || '').trim() ||
    String(process.env.DEEPSEEK_API_KEY || '').trim() ||
    keyFromEnvFile()
  );
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

async function showSnapshot(snapshot, ledger, config) {
  const peak = peakInfo();
  const lines = [];
  let balanceLine = `余额 ¥${money(snapshot.total)}`;
  if (snapshot.bonus !== null && snapshot.bonus > 0) balanceLine += `（赠金 ¥${money(snapshot.bonus)}）`;
  lines.push(balanceLine);
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
      await showSnapshot(lastSnapshot, lastLedger, loadConfig());
    }
    return result;
  }
  refreshing = (async () => {
    const config = loadConfig();
    const snapshot = await fetchBalance(config);
    if (!snapshot.ok) {
      logLine('balance', `refresh failed: ${snapshot.reason}`);
      if (show) await say(errorText(snapshot.reason));
      return { ok: false, reason: snapshot.reason, config: configSummary(config) };
    }
    const ledger = updateLedger(snapshot);
    lastSnapshot = snapshot;
    lastLedger = ledger;
    const alerted = await checkAlert(snapshot, ledger, config);
    if (show && !alerted) await showSnapshot(snapshot, ledger, config);
    return { ok: true, snapshot, ledger, peak: peakInfo(), config: configSummary(config) };
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
  writeJson(BALANCE_CONFIG_FILE, next);
  applyRefreshInterval(next.refreshSec);
  return configSummary(next);
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
