/**
 * reasonix-pet 的共享路径、状态与 HTTP 小工具。
 *
 * 设计约束：
 *   - 桌宠本体（dsh-pet）保持原样，不做源码级修改；适配全部在本目录完成。
 *   - 独立运行：DSH_HOME 指向插件自己的 home/，不碰用户已有的 ~/.dsh 配置与素材。
 *   - 所有状态落在插件目录，卸载插件即清理干净。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOME_DIR = join(PLUGIN_ROOT, 'home');
export const STATE_DIR = join(PLUGIN_ROOT, 'state');
export const LOG_DIR = join(STATE_DIR, 'logs');
export const STATE_FILE = join(STATE_DIR, 'runtime.json');
export const HOOK_STATE_FILE = join(STATE_DIR, 'hook-state.json');
export const WATCHDOG_FILE = join(STATE_DIR, 'watchdog.json');
export const MANUAL_STOP_FILE = join(STATE_DIR, 'manual-stop.json');
export const AGENT_LOCK_FILE = join(STATE_DIR, 'agent.lock');
export const BALANCE_CONFIG_FILE = join(HOME_DIR, 'balance-config.json');
export const BALANCE_LEDGER_FILE = join(STATE_DIR, 'balance-ledger.json');
export const CHAT_HISTORY_FILE = join(STATE_DIR, 'chat-history.json');

export const RUNTIME_ROOT = join(PLUGIN_ROOT, 'runtime');
export const PET_PACKAGE_ROOT = join(RUNTIME_ROOT, 'node_modules', 'dsh-pet');
export const STANDALONE_ENTRY = join(PET_PACKAGE_ROOT, 'lib', 'standalone.js');
export const ENSURE_ELECTRON_ENTRY = join(PET_PACKAGE_ROOT, 'scripts', 'ensure-electron.mjs');

export const DEFAULT_PORT = 34740;
export const PET_ID = 'main';
export const API_PREFIX = '/dsh-pet-7340';

/** 工作状态档位 → dsh-pet 默认配置里的事件动画名（与 assets/config.jsonc 的 events.workStatus 对齐） */
export const ANIM = {
  thinking: '工作状态-思考冒泡',
  working: '工作状态-忙碌点按',
  result: '工作状态-清点归档',
  waiting: '工作状态-原地踱步张望',
  success: '工作状态-雀跃庆祝',
  error: '工作状态-垂头叹气冒汗',
};

export const MESSAGES = {
  sessionStart: ['在呢，随时待命～', '来啦来啦，今天也要加油哦～'],
  success: ['这一轮搞定啦～', '任务完成，可以摸鱼啦～', '收工！真棒！'],
  error: ['这一步好像卡住了呢', '刚才的操作遇到点问题哦'],
  waiting: ['需要你确认一下哦', '轮到你来决定啦，等你～'],
  farewell: ['下次见～', '先歇一会儿，回头见～'],
};

export function ensureDirs() {
  for (const dir of [STATE_DIR, LOG_DIR, join(HOME_DIR, 'dsh-pet')]) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDirs();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

export function loadState() {
  const state = readJson(STATE_FILE);
  return state && typeof state === 'object' ? state : null;
}

export function saveState(state) {
  writeJson(STATE_FILE, state);
}

export function clearState() {
  try {
    writeFileSync(STATE_FILE, '', 'utf8');
  } catch {
    /* ignore */
  }
}

export function logLine(scope, message) {
  try {
    ensureDirs();
    const line = `${new Date().toISOString()} [${scope}] ${message}\n`;
    appendFileSync(join(LOG_DIR, 'pet.log'), line, 'utf8');
  } catch {
    /* 日志写不进去也不能影响 Reasonix */
  }
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** 从 startPort 开始找第一个可监听的本地端口 */
export async function findFreePort(startPort = DEFAULT_PORT, tries = 40) {
  for (let offset = 0; offset < tries; offset += 1) {
    const port = startPort + offset;
    if (await portFree(port)) return port;
  }
  return 0;
}

function portFree(port) {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => server.close(() => resolvePromise(true)));
    server.listen(port, '127.0.0.1');
  });
}

/** 发一个本地 HTTP 请求；失败返回结构化错误，不抛异常 */
export async function request(port, path, options = {}) {
  const { method = 'GET', body, timeout = 900 } = options;
  const url = `http://127.0.0.1:${port}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      headers:
        body === undefined
          ? { connection: 'close' }
          : { 'content-type': 'application/json', connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON 响应保留 text */
    }
    return { ok: response.ok, status: response.status, text, json };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function isHealthy(port) {
  if (!port) return false;
  const response = await request(port, '/health', { timeout: 600 });
  return response.ok;
}

/** 打开 standalone 的日志文件（追加），返回 fd；失败回退到 ignore */
export function openLog(prefix) {
  ensureDirs();
  const file = join(LOG_DIR, `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  try {
    return { fd: openSync(file, 'a'), file };
  } catch {
    return { fd: 'ignore', file: '' };
  }
}

export function configPath() {
  return join(HOME_DIR, 'dsh-pet', 'main-config.jsonc');
}

export function petVersion() {
  const pkg = readJson(join(PET_PACKAGE_ROOT, 'package.json'));
  return pkg?.version ?? '未安装';
}

export function runtimeInstalled() {
  return existsSync(STANDALONE_ENTRY);
}
