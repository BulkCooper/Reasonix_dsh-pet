/**
 * 桌宠进程控制：启动 / 停止 / 状态 / API 调用。
 * 被 pet.mjs（用户命令）与 pet-hook.mjs（Reasonix 事件）共用。
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_PREFIX,
  DEFAULT_PORT,
  ENSURE_ELECTRON_ENTRY,
  HOME_DIR,
  LOG_DIR,
  PET_ID,
  PLUGIN_ROOT,
  PET_PACKAGE_ROOT,
  AGENT_LOCK_FILE,
  MANUAL_STOP_FILE,
  STANDALONE_ENTRY,
  STATE_DIR,
  WATCHDOG_FILE,
  clearState,
  configPath,
  ensureDirs,
  findFreePort,
  isHealthy,
  loadState,
  logLine,
  openLog,
  petVersion,
  readJson,
  request,
  runtimeInstalled,
  saveState,
  sleep,
  writeJson,
} from './config.mjs';

const LOCK_FILE = join(STATE_DIR, 'start.lock');
const LOCK_STALE_MS = 30_000;

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

/** 等健康接口就绪；返回实际端口或 null */
async function waitHealthy(port, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) return port;
    await sleep(250);
  }
  return null;
}

/** Reasonix Studio 是否在运行（用于生命周期看护） */
export function detectReasonixApp() {
  const forced = process.env.REASONIX_PET_APP_RUNNING;
  if (forced === '1') return true;
  if (forced === '0') return false;
  try {
    const output = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq Reasonix Studio.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'buffer', windowsHide: true, timeout: 3000 },
    );
    // CSV 行形如 "Reasonix Studio.exe","1234",...；latin1 只用于匹配 ASCII 进程名
    return Buffer.from(output).toString('latin1').includes('"Reasonix Studio.exe","');
  } catch {
    return false;
  }
}

/**
 * Reasonix Studio 主进程 PID（有主窗口的那个）。
 * 看护只盯这个 PID：窗口隐藏到后台不影响；主进程结束就停止桌宠。
 * PowerShell 不可用时回退 tasklist 的第一条（主进程通常先启动、PID 最小）。
 */
export function getReasonixMainPid() {
  try {
    const script =
      "Get-Process 'Reasonix Studio' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object Id | Select-Object -First 1 -ExpandProperty Id";
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    }).trim();
    const pid = Number(output);
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {
    /* 回退 */
  }
  try {
    const output = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq Reasonix Studio.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'buffer', windowsHide: true, timeout: 3000 },
    );
    const line = Buffer.from(output)
      .toString('latin1')
      .split(String.fromCharCode(10))
      .find((value) => value.includes('"Reasonix Studio.exe","'));
    if (line) {
      const pid = Number(line.split('","')[1]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function watchdogAlive(info) {
  if (!info?.pid) return false;
  try {
    process.kill(Number(info.pid), 0);
    return true;
  } catch {
    return false;
  }
}

/** 启动/复用生命周期看护（只在能检测到 Reasonix Studio 时启动） */
export function startWatchdog(state) {
  if (process.env.REASONIX_PET_NO_WATCHDOG === '1') return null;
  if (!detectReasonixApp()) return null;
  const appPid = Number(state.appPid) > 0 ? Number(state.appPid) : getReasonixMainPid();

  const previous = readJson(WATCHDOG_FILE);
  if (watchdogAlive(previous)) {
    if (
      Number(previous.petPid) === Number(state.pid) &&
      Number(previous.appPid ?? 0) === Number(appPid ?? 0)
    ) {
      return previous;
    }
    try { process.kill(Number(previous.pid)); } catch { /* ignore */ }
  }

  const entry = join(PLUGIN_ROOT, 'scripts', 'watchdog.mjs');
  if (!existsSync(entry)) return null;
  const log = openLog('watchdog');
  const args = [entry, '--pet-pid', String(state.pid), '--port', String(state.port)];
  if (appPid) args.push('--app-pid', String(appPid));
  const child = spawn(
    process.execPath,
    args,
    {
      cwd: PLUGIN_ROOT,
      env: { ...process.env },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
    },
  );
  child.unref();
  const info = {
    pid: child.pid,
    petPid: state.pid,
    port: state.port,
    appPid: appPid ?? null,
    startedAt: new Date().toISOString(),
  };
  writeJson(WATCHDOG_FILE, info);
  logLine('control', `watchdog pid=${child.pid} pet=${state.pid}`);
  return info;
}

function ensureWatchdog(state) {
  try {
    startWatchdog(state);
  } catch (error) {
    logLine('control', `watchdog 启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 停止生命周期看护（幂等） */
export function stopWatchdog() {
  const info = readJson(WATCHDOG_FILE);
  if (info?.pid) {
    try { process.kill(Number(info.pid)); } catch { /* 已退出 */ }
  }
  try { unlinkSync(WATCHDOG_FILE); } catch { /* ignore */ }
}

/**
 * 启动桌宠（幂等）。
 * @returns {{pid:number, port:number, startedAt:string, log:string, reused?:boolean}}
 */
export async function startPet(options = {}) {
  const { quiet = false, waitMs = 20_000, watchdog = true, appPidOverride, clearManual = true } = options;
  ensureDirs();
  if (!runtimeInstalled()) {
    throw new Error(`dsh-pet 运行时未安装：${STANDALONE_ENTRY} 不存在，请先运行 pet.cmd install`);
  }

  const appPid = appPidOverride ?? getReasonixMainPid();
  if (clearManual) {
    try { unlinkSync(MANUAL_STOP_FILE); } catch { /* ignore */ }
  }
  const existing = loadState();
  if (existing?.port && (await isHealthy(existing.port))) {
    if (appPid && existing.appPid && Number(existing.appPid) !== appPid) {
      // Reasonix 主进程换过了（应用重启）：旧桌宠/旧看护作废，重启一只新的
      logLine('control', `Reasonix 主进程变化 ${existing.appPid} -> ${appPid}，重启桌宠`);
      await stopPet();
    } else {
      const reused = existing.appPid ? existing : { ...existing, appPid: appPid ?? undefined };
      if (!existing.appPid) saveState(reused);
      if (watchdog) ensureWatchdog(reused);
      return { ...reused, reused: true };
    }
  }

  let lockFd = null;
  try {
    lockFd = openSync(LOCK_FILE, 'wx');
  } catch {
    // 另一个进程正在启动：等它完成（或等锁过期）
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(250);
      const current = loadState();
      if (current?.port && (await isHealthy(current.port))) {
        return { ...current, reused: true };
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
      env: {
        ...process.env,
        DSH_HOME: HOME_DIR,
        // dsh-pet 首次启动会下载 Electron；默认走 npmmirror，允许用户覆盖
        DSH_PET_ELECTRON_MIRROR:
          process.env.DSH_PET_ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
      },
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
      appPid: appPid ?? undefined,
    };
    saveState(state);
    logLine('control', `spawn pid=${child.pid} port=${port} log=${log.file}`);

    const ready = await waitHealthy(port, waitMs);
    if (!ready) {
      const output = tailLog(log.file);
      throw new Error(`桌宠服务启动超时（端口 ${port}）。日志：\n${output || '（无输出）'}`);
    }
    if (watchdog) ensureWatchdog(state);
    return state;
  } finally {
    try { closeSync(lockFd); } catch { /* ignore */ }
    try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  }
}

/** 停止桌宠（幂等） */
export async function stopPet(options = {}) {
  const { manual = false } = options;
  if (manual) {
    const current = loadState();
    writeJson(MANUAL_STOP_FILE, { at: Date.now(), appPid: current?.appPid ?? null });
  }
  stopWatchdog();
  const state = loadState();
  if (!state?.port) {
    clearState();
    return { stopped: false, reason: '未运行' };
  }
  await request(state.port, '/shutdown', { method: 'POST', timeout: 2500 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await isHealthy(state.port))) break;
    await sleep(200);
  }
  // 兜底：进程还在就结束它
  if (state.pid) {
    try { process.kill(state.pid, 0); process.kill(state.pid); } catch { /* 已退出 */ }
  }
  clearState();
  try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  logLine('control', `stopped pid=${state.pid} port=${state.port}`);
  return { stopped: true, pid: state.pid, port: state.port };
}

/** 读状态（/health + /state + /config 摘要） */
export async function getStatus() {
  const state = loadState();
  if (!state?.port) return { running: false, state: null };
  const health = await request(state.port, '/health', { timeout: 800 });
  if (!health.ok) return { running: false, state, error: health.error || `HTTP ${health.status}` };
  const [petState, config] = await Promise.all([
    request(state.port, `${API_PREFIX}/state`, { timeout: 1200 }),
    request(state.port, `${API_PREFIX}/config`, { timeout: 1200 }),
  ]);
  // /config 的顶层是“条目名 → 条目”的对象，每个条目里有 pets 数组
  const pets = Object.values(config.json ?? {})
    .flatMap((entry) => (entry && Array.isArray(entry.pets) ? entry.pets : []))
    .filter((pet) => pet && typeof pet === 'object')
    .map((pet) => ({
      id: pet.id,
      name: pet.name,
      display: pet.display,
      size: pet.size,
    }));
  const watchdog = readJson(WATCHDOG_FILE);
  const agent = readJson(AGENT_LOCK_FILE);
  return {
    running: true,
    state,
    health: health.json,
    pets,
    petState: petState.json,
    watchdog: watchdogAlive(watchdog) ? watchdog : null,
    agent: watchdogAlive(agent) ? agent : null,
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

/** 运行 dsh-pet 自带体检（--check） */
export function doctor() {
  if (!runtimeInstalled()) {
    return { ok: false, error: `运行时未安装：${STANDALONE_ENTRY}` };
  }
  const result = spawnSync(process.execPath, [STANDALONE_ENTRY, '--check'], {
    cwd: PET_PACKAGE_ROOT,
    env: { ...process.env, DSH_HOME: HOME_DIR },
    stdio: 'inherit',
  });
  return { ok: result.status === 0, status: result.status };
}

/** 下载/确认 Electron（桌面透明窗依赖） */
export function ensureElectron() {
  if (!existsSync(ENSURE_ELECTRON_ENTRY)) {
    return { ok: false, error: `ensure-electron 脚本不存在：${ENSURE_ELECTRON_ENTRY}` };
  }
  const result = spawnSync(process.execPath, [ENSURE_ELECTRON_ENTRY], {
    cwd: PET_PACKAGE_ROOT,
    env: {
      ...process.env,
      DSH_HOME: HOME_DIR,
      DSH_PET_ELECTRON_MIRROR:
        process.env.DSH_PET_ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    },
    stdio: 'inherit',
  });
  return { ok: result.status === 0, status: result.status };
}

export function paths() {
  ensureDirs();
  return {
    pluginRoot: PLUGIN_ROOT,
    config: configPath(),
    logs: LOG_DIR,
    runtime: PET_PACKAGE_ROOT,
    state: join(STATE_DIR, 'runtime.json'),
    watchdog: join(STATE_DIR, 'watchdog.json'),
  };
}
