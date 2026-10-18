#!/usr/bin/env node
/**
 * Reasonix hook → 桌宠状态桥。
 *
 * 只把“发生了什么类型的事件”翻译成动画/气泡；不读取、不转发、不落盘任何用户内容。
 * 永远以 0 退出：hook 失败绝不能影响 Reasonix 的正常工具调用。
 */
import { unlinkSync } from 'node:fs';
import {
  ANIM,
  HOOK_STATE_FILE,
  MANUAL_STOP_FILE,
  MESSAGES,
  isHealthy,
  loadState,
  logLine,
  pick,
  readJson,
  writeJson,
} from './config.mjs';
import { callApi, getReasonixMainPid, startPet } from './control.mjs';

/** Reasonix 事件 → dsh-pet 工作状态档位 */
const EVENT_KIND = {
  SessionStart: 'waiting',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'working',
  PostToolUse: 'result',
  PostToolUseFailure: 'error',
  Stop: 'success',
  StopFailure: 'error',
  Notification: 'waiting',
  SessionEnd: 'waiting',
  SubagentStart: 'working',
  SubagentStop: 'result',
  PermissionRequest: 'waiting',
  PreCompact: 'working',
};

/** 哪些事件值得冒一句气泡（其余只播动画，保持安静） */
const EVENT_MESSAGE = {
  SessionStart: MESSAGES.sessionStart,
  Stop: MESSAGES.success,
  StopFailure: MESSAGES.error,
  PostToolUseFailure: MESSAGES.error,
  PermissionRequest: MESSAGES.waiting,
  SessionEnd: MESSAGES.farewell,
};

async function main() {
  // 事件名由 manifest 的命令参数给出；不读取 stdin（隐私 + 避开 Windows libuv 的 stdin 关闭竞态）
  const event = process.argv[2] || '';
  const kind = EVENT_KIND[event];
  if (!kind) return;

  let state = loadState();
  let running = Boolean(state?.port) && (await isHealthy(state.port));

  if (!running) {
    // 只有 SessionStart 负责拉起桌宠；其它事件在桌宠未运行时直接跳过，不拖慢 Reasonix
    if (event !== 'SessionStart') return;
    const manual = readJson(MANUAL_STOP_FILE);
    if (manual) {
      const currentApp = getReasonixMainPid();
      if (currentApp && Number(manual.appPid) === currentApp) return; // 本应用实例内用户手动停过
      try { unlinkSync(MANUAL_STOP_FILE); } catch { /* ignore */ } // 应用已重启，旧标记作废
    }
    try {
      await startPet({ quiet: true, waitMs: 8000, clearManual: false });
    } catch (error) {
      logLine('hook', `SessionStart 启动失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    state = loadState();
    running = Boolean(state?.port) && (await isHealthy(state.port));
    if (!running) return;
  }

  const previously = readJson(HOOK_STATE_FILE, {});
  const now = Date.now();
  const previousAt = Number(previously?.at || 0);
  const sameKindRecently = previously?.kind === kind && now - previousAt < 2500;
  const sameEventRecently = previously?.event === event && now - previousAt < 5000;
  const bubbleRecently =
    sameEventRecently ||
    (previously?.kind === kind && now - previousAt < 5000 && (kind === 'error' || kind === 'success'));

  if (!sameKindRecently) {
    const response = await callApi(
      `/anim?pet=main`,
      { method: 'POST', body: { name: ANIM[kind] }, timeout: 800 },
      { autoStart: false },
    );
    if (!response.ok) {
      logLine('hook', `anim ${kind} 失败：${response.error || `HTTP ${response.status}`}`);
    }
  }

  const messages = EVENT_MESSAGE[event];
  if (messages && !bubbleRecently) {
    const text = pick(messages);
    const response = await callApi(
      `/broadcast?pet=main`,
      { method: 'POST', body: { text }, timeout: 800 },
      { autoStart: false },
    );
    if (!response.ok) {
      logLine('hook', `broadcast 失败：${response.error || `HTTP ${response.status}`}`);
    }
  }

  writeJson(HOOK_STATE_FILE, { event, kind, at: now });
}

main()
  .catch((error) => {
    logLine('hook', `未处理错误：${error instanceof Error ? error.message : String(error)}`);
  })
  .finally(() => {
    // 不输出 stdout（SessionStart 的 stdout 会被注入上下文），始终 0 退出。
    // 用 exitCode 让 Node 自然收尾：Windows 上在 fetch 清理期间强退会触发 libuv 断言。
    process.exitCode = 0;
  });
