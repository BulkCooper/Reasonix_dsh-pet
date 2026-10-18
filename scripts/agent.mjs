#!/usr/bin/env node
/**
 * Login-time supervisor：让桌宠跟着 Reasonix 进程快速启停。
 *
 * 为什么不只靠 SessionStart：Reasonix 启动后要等会话恢复才会触发 SessionStart，
 * 实测可能晚 40 秒以上。这个常驻进程由启动文件夹在登录时拉起，每 2 秒看一眼
 * Reasonix 主进程，应用一出现就启动桌宠，应用退出就停止。
 *
 * 单实例：state/agent.lock。手动 `pet.cmd stop` 会写 manual-stop 标记，
 * 本应用实例内不会被 supervisor 重新拉起；应用重启后才会重新启动。
 */
import {
  AGENT_LOCK_FILE,
  MANUAL_STOP_FILE,
  ensureDirs,
  isHealthy,
  loadState,
  logLine,
  readJson,
  sleep,
  writeJson,
} from './config.mjs';
import { detectReasonixApp, getReasonixMainPid, startPet, stopPet } from './control.mjs';
import { startBalanceService } from './balance.mjs';

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

ensureDirs();
const previous = readJson(AGENT_LOCK_FILE);
if (previous?.pid && alive(previous.pid)) {
  logLine('agent', `already running pid=${previous.pid}`);
  process.exit(0);
}
writeJson(AGENT_LOCK_FILE, { pid: process.pid, startedAt: new Date().toISOString() });
logLine('agent', `start pid=${process.pid}`);
startBalanceService();

let appPid = null;
let lastMainAttempt = 0;
let lastStartAttempt = 0;
let lastFailureLog = 0;

for (;;) {
  await sleep(2000);

  const appPresent = detectReasonixApp();
  const state = loadState();
  let petRunning = Boolean(state?.port) && (await isHealthy(state.port));

  if (!appPresent) {
    if (appPid !== null) logLine('agent', 'Reasonix 退出');
    appPid = null;
    if (petRunning) {
      await stopPet();
      logLine('agent', '桌宠已停止');
    }
    continue;
  }

  if (!appPid || !alive(appPid)) {
    if (Date.now() - lastMainAttempt < 5000) continue;
    lastMainAttempt = Date.now();
    const next = getReasonixMainPid();
    if (!next) continue;
    const changed = appPid !== null && appPid !== next;
    appPid = next;
    if (changed && petRunning) {
      await stopPet();
      petRunning = false;
      logLine('agent', `Reasonix 主进程变化，重启桌宠 app=${appPid}`);
    }
  }

  if (petRunning) continue;

  const manual = readJson(MANUAL_STOP_FILE);
  if (manual && Number(manual.appPid) === Number(appPid)) continue;

  if (Date.now() - lastStartAttempt < 4000) continue;
  lastStartAttempt = Date.now();
  try {
    const started = await startPet({
      quiet: true,
      watchdog: false,
      appPidOverride: appPid,
      clearManual: true,
      waitMs: 8000,
    });
    logLine('agent', `启动桌宠 pid=${started.pid} port=${started.port} app=${appPid}`);
  } catch (error) {
    const now = Date.now();
    if (now - lastFailureLog > 30000) {
      lastFailureLog = now;
      logLine('agent', `启动失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
