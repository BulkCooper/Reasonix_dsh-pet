#!/usr/bin/env node
/**
 * 桌宠生命周期看护：Reasonix Studio 退出后自动停止桌宠。
 *
 * 为什么不用 SessionEnd 直接停：关闭一个会话不等于关闭应用，SessionEnd 会误伤；
 * 这里用进程存活检测，每 2 秒看一眼 Reasonix Studio 是否还在，连续 3 次（约 6 秒）
 * 都看不到才停止桌宠。应用重启时若已重新出现，桌宠保持运行，新会话直接复用。
 *
 * 只停止“自己启动的那只”桌宠：停止前再次核对 state.pid，避免误杀应用重启后拉起的新实例。
 * 测试/调试：REASONIX_PET_APP_RUNNING=0 可模拟“应用已退出”。
 */
import { unlinkSync } from 'node:fs';
import {
  WATCHDOG_FILE,
  clearState,
  isHealthy,
  loadState,
  logLine,
  readJson,
  request,
  sleep,
} from './config.mjs';
import { detectReasonixApp } from './control.mjs';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const petPid = Number(argValue('--pet-pid'));
const port = Number(argValue('--port'));
const appPidArg = Number(argValue('--app-pid'));
const appPid = Number.isInteger(appPidArg) && appPidArg > 0 ? appPidArg : null;
const force = process.argv.includes('--force');
const POLL_MS = 2000;
const MISS_LIMIT = 3;

if (!Number.isInteger(petPid) || petPid <= 0 || !Number.isInteger(port) || port <= 0) {
  console.error('watchdog: 需要 --pet-pid <pid> --port <port>');
  process.exit(2);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

logLine('watchdog', `start pid=${process.pid} pet=${petPid} port=${port} app=${appPid ?? 'by-name'} force=${force}`);

let misses = 0;
for (;;) {
  await sleep(POLL_MS);

  if (!force) {
    const info = readJson(WATCHDOG_FILE);
    if (!info || Number(info.pid) !== process.pid) break; // 被替换或主动停止
  }

  const state = loadState();
  if (!state?.port || Number(state.pid) !== petPid) break; // 桌宠已停止/已被新实例替换
  if (!(await isHealthy(port))) break; // 桌宠服务不在了

  const appAlive = appPid ? processAlive(appPid) : detectReasonixApp();
  if (appAlive) {
    misses = 0;
    continue;
  }

  misses += 1;
  if (misses < MISS_LIMIT) continue;

  logLine('watchdog', `Reasonix 主进程已退出（连续 ${misses} 次），停止桌宠 pet=${petPid}`);
  await request(port, '/shutdown', { method: 'POST', timeout: 2500 });

  const current = loadState();
  if (Number(current?.pid) === petPid) clearState();
  try { unlinkSync(WATCHDOG_FILE); } catch { /* ignore */ }
  break;
}

logLine('watchdog', `exit pid=${process.pid}`);
process.exitCode = 0;
