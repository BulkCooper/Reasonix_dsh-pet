/**
 * 桌宠进程控制：启动 / 停止 / 状态 / API 调用。
 *
 * 合规约束：
 *   - 没有启动文件夹、常驻 supervisor、watchdog。
 *   - 桌宠和本地面板服务都只由 Reasonix hook（SessionStart/SessionEnd）拉起和停止。
 *   - 不下载运行时；运行时由 vendor/*.zip 固定版本附带并在本地解压。
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_PREFIX,
  DEFAULT_PORT,
  HOME_DIR,
  LOG_DIR,
  PET_ID,
  PLUGIN_ROOT,
  PET_PACKAGE_ROOT,
  STANDALONE_ENTRY,
  STATE_DIR,
  clearState,
  configPath,
  ensureDirs,
  ensureRuntime,
  findFreePort,
  isHealthy,
  loadState,
  logLine,
  openLog,
  petVersion,
  request,
  runtimeInstalled,
  saveState,
  sleep,
} from './config.mjs';

const LOCK_FILE = join(STATE_DIR, 'start.lock');
const LOCK_STALE_MS = 30_000;
const BALANCE_PORT = 34741;

function lockIsStale() {
  try {
    return Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function tailLog(file, lines = 12) {
  try {
    if (!file || !existsSync(file)) return '';
    return readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function waitHealthy(port, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) return port;
    await sleep(250);
  }
  return null;
}

async function waitBalance(waitMs = 8000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const response = await request(BALANCE_PORT, '/health', { timeout: 500 });
    if (response.ok) return true;
    await sleep(250);
  }
  return false;
}

/** 启动余额/对话面板服务；由 hook 的 SessionStart 触发，不常驻 */
async function startBalance() {
  if (await waitBalance(300)) return { ok: true, reused: true };
  const entry = join(PLUGIN_ROOT, 'scripts', 'balance.mjs');
  if (!existsSync(entry)) return { ok: false, error: 'balance.mjs missing' };
  const log = openLog('balance');
  const child = spawn(process.execPath, [entry], {
    cwd: PLUGIN_ROOT,
    env: { ...process.env, DSH_HOME: HOME_DIR },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log.fd, log.fd],
  });
  child.unref();
  const ok = await waitBalance(8000);
  logLine('control', `balance pid=${child.pid} ok=${ok} log=${log.file}`);
  return { ok, pid: child.pid, log: log.file };
}

async function stopBalance() {
  const response = await request(BALANCE_PORT, '/shutdown', { method: 'POST', timeout: 1200 });
  if (!response.ok && response.status !== 0) {
    logLine('control', `balance shutdown: ${response.error || response.status}`);
  }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const health = await request(BALANCE_PORT, '/health', { timeout: 300 });
    if (!health.ok) break;
    await sleep(150);
  }
}

/**
 * 启动桌宠（幂等）。
 * @returns {{pid:number, port:number, startedAt:string, log:string, reused?:boolean}}
 */
export async function startPet(options = {}) {
  const { quiet = false, waitMs = 20_000 } = options;
  ensureDirs();
  if (!ensureRuntime()) {
    throw new Error('固定运行时缺失：vendor/pet-runtime.zip 或 vendor/electron-*.zip 不存在');
  }
  if (!runtimeInstalled()) {
    throw new Error(`dsh-pet 运行时未安装：${STANDALONE_ENTRY} 不存在，请运行 pet.cmd install`);
  }

  const existing = loadState();
  if (existing?.port && (await isHealthy(existing.port))) {
    const balance = await startBalance();
    const reused = { ...existing, balance: balance.ok, balancePid: balance.pid ?? existing.balancePid };
    saveState(reused);
    return { ...reused, reused: true };
  }

  let lockFd = null;
  try {
    lockFd = openSync(LOCK_FILE, 'wx');
  } catch {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(250);
      const current = loadState();
      if (current?.port && (await isHealthy(current.port))) {
        const balance = await startBalance();
        return { ...current, balance: balance.ok, reused: true };
      }
      if (lockIsStale()) break;
    }
    if (lockIsStale()) {
      try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    }
    throw new Error('桌宠正在启动中，请稍后再试');
  }

  try {
    const port = await findFreePort(DEFAULT_PORT);
    if (!port) throw new Error(`找不到可用端口（从 ${DEFAULT_PORT} 开始尝试）`);

    const log = openLog('standalone');
    const child = spawn(process.execPath, [STANDALONE_ENTRY, '--port', String(port)], {
      cwd: PET_PACKAGE_ROOT,
      env: { ...process.env, DSH_HOME: HOME_DIR },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    child.unref();

    const state = {
      pid: child.pid,
      port,
      startedAt: new Date().toISOString(),
      log: log.file,
      pluginVersion: petVersion(),
    };
    saveState(state);
    logLine('control', `spawn pid=${child.pid} port=${port} log=${log.file}`);

    const ready = await waitHealthy(port, waitMs);
    if (!ready) {
      const output = tailLog(log.file);
      throw new Error(`桌宠服务启动超时（端口 ${port}）。日志：\n${output || '（无输出）'}`);
    }
    const balance = await startBalance();
    const finalState = { ...state, balance: balance.ok, balancePid: balance.pid };
    saveState(finalState);
    if (!quiet) logLine('control', `balance ok=${balance.ok}`);
    return finalState;
  } finally {
    try { closeSync(lockFd); } catch { /* ignore */ }
    try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  }
}

/** 停止桌宠（幂等），同时停止本地面板服务 */
export async function stopPet() {
  await stopBalance();
  const state = loadState();
  if (!state?.port) {
    clearState();
    return { ok: true, stopped: false };
  }
  await request(state.port, '/shutdown', { method: 'POST', timeout: 2000 });
  await sleep(400);
  try { process.kill(state.pid); } catch { /* ignore */ }
  clearState();
  logLine('control', `stopped pid=${state.pid} port=${state.port}`);
  return { ok: true, stopped: true };
}

/** 查询状态（不做任何启动/下载） */
export async function getStatus() {
  const state = loadState();
  if (!state?.port) return { running: false, state: null };
  const health = await request(state.port, '/health', { timeout: 800 });
  if (!health.ok) return { running: false, state };
  const petState = await request(state.port, `${API_PREFIX}/state`, { timeout: 1000 });
  const config = await request(state.port, `${API_PREFIX}/config`, { timeout: 1500 });
  const pets = Object.values(config.json ?? {})
    .flatMap((entry) => (entry && Array.isArray(entry.pets) ? entry.pets : []))
    .filter((pet) => pet && typeof pet === 'object')
    .map((pet) => ({ id: pet.id, name: pet.name, display: pet.display, size: pet.size }));
  const balance = await request(BALANCE_PORT, '/health', { timeout: 500 });
  return {
    running: true,
    state,
    health: health.json,
    pets,
    petState: petState.json,
    balance: balance.ok,
  };
}

/** 调 API；服务未运行时自动启动（用户主动 say/play 时） */
export async function callApi(path, options = {}, { autoStart = true } = {}) {
  let state = loadState();
  if (!state?.port || !(await isHealthy(state.port))) {
    if (!autoStart) return { ok: false, error: '桌宠未运行' };
    state = await startPet({ quiet: true });
  }
  return request(state.port, `${API_PREFIX}${path}`, options);
}

export async function say(text) {
  return callApi(`/broadcast?pet=${encodeURIComponent(PET_ID)}`, {
    method: 'POST',
    body: { text },
  });
}

export async function play(name) {
  return callApi(`/anim?pet=${encodeURIComponent(PET_ID)}`, {
    method: 'POST',
    body: { name },
  });
}

/** 运行 dsh-pet 自带体检（--check）；不下载任何东西 */
export function doctor() {
  if (!ensureRuntime() || !runtimeInstalled()) {
    return { ok: false, error: `运行时未安装：${STANDALONE_ENTRY}` };
  }
  const result = spawnSync(process.execPath, [STANDALONE_ENTRY, '--check'], {
    cwd: PET_PACKAGE_ROOT,
    env: { ...process.env, DSH_HOME: HOME_DIR },
    stdio: 'inherit',
  });
  return { ok: result.status === 0, status: result.status };
}

/** 兼容旧命令：确认固定运行时已就位，不下载 */
export function ensureElectron() {
  const ok = ensureRuntime();
  return { ok, status: ok ? 0 : 1 };
}

export function paths() {
  ensureDirs();
  return {
    pluginRoot: PLUGIN_ROOT,
    config: configPath(),
    logs: LOG_DIR,
    runtime: PET_PACKAGE_ROOT,
    state: join(STATE_DIR, 'runtime.json'),
    balance: join(STATE_DIR, 'balance.json'),
  };
}
