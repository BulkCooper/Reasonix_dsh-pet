#!/usr/bin/env node
/** reasonix-pet 命令行：start / install / stop / status / say / play / state / doctor / electron / logs */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANIM,
  LOG_DIR,
  configPath,
  loadState,
  logLine,
  petVersion,
  runtimeInstalled,
} from './config.mjs';
import {
  callApi,
  doctor,
  ensureElectron,
  getStatus,
  paths,
  play,
  say,
  startPet,
  stopPet,
} from './control.mjs';

const argv = process.argv.slice(2);
const jsonOutput = argv.includes('--json');
const args = argv.filter((arg) => arg !== '--json');
const command = args[0] || 'status';
const rest = args.slice(1);

const HELP = `reasonix-pet — Reasonix 桌宠控制

用法：pet.cmd <命令> [参数] [--json]

  start              启动桌宠（透明置顶桌面窗口）
  install            解压/校验固定版本运行时（本地，不联网）
  stop               停止桌宠
  restart            重启桌宠
  status             查看运行状态、端口与宠物
  say <文本>         让桌宠冒一句话（服务未运行会自动启动）
  play <动画名>      点播一段动画（不带参数时列出工作状态动画）
  state              打印桌宠 /state 原始状态
  doctor             运行 dsh-pet 自带的配置 / Electron 体检
  electron           下载或确认 Electron 运行时
  logs               打印日志路径与最后 40 行
  paths              打印插件、配置、日志与运行时路径

示例：
  pet.cmd say "今天也要加油哦～"
  pet.cmd play 工作状态-思考冒泡
  pet.cmd status --json
`;

async function readStdinText() {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

function printStatus(status) {
  if (!status.running) {
    console.log('reasonix-pet: 未运行');
    if (status.state?.port) console.log(`  残留状态：端口 ${status.state.port}（pid ${status.state.pid ?? '?'}）`);
    console.log(`  启动：pet.cmd start`);
    return;
  }
  const { state, health, pets } = status;
  console.log(`reasonix-pet 2.1.18 · dsh-pet ${petVersion()}`);
  console.log(`  状态   运行中 · 端口 ${state.port} · pid ${state.pid} · 启动于 ${state.startedAt}`);
  if (health?.name) console.log(`  服务   ${health.name}（已运行 ${health.uptimeSec ?? '?'} 秒）`);
  console.log(
    status.balance
      ? '  面板   本地余额/对话服务正常（127.0.0.1:34741）'
      : '  面板   未运行（由 SessionStart hook 启动）',
  );
  if (pets?.length) {
    console.log(`  宠物   ${pets.map((p) => `${p.id}(${p.name || '-'}, display=${p.display}, size=${p.size})`).join('  ')}`);
  } else {
    console.log('  宠物   （配置里没有宠物）');
  }
  console.log(`  配置   ${configPath()}`);
  console.log(`  日志   ${state.log || LOG_DIR}`);
}

async function main() {
  switch (command) {
    case 'install': {
      // install.mjs 是顶层执行脚本：成功返回，失败 process.exit(1)。
      await import('./install.mjs');
      return;
    }
    case 'start': {
      if (!runtimeInstalled()) {
        console.error('dsh-pet 运行时未安装，请先安装 runtime/node_modules/dsh-pet');
        process.exitCode = 1;
        return;
      }
      const state = await startPet({ quiet: false });
      if (jsonOutput) console.log(JSON.stringify(state, null, 2));
      else console.log(`桌宠已启动：端口 ${state.port}，pid ${state.pid}${state.reused ? '（复用现有进程）' : ''}`);
      return;
    }
    case 'ensure': {
      try {
        await startPet({ quiet: true });
      } catch (error) {
        logLine('pet', `ensure 失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    case 'stop': {
      const result = await stopPet({ manual: true });
      if (jsonOutput) console.log(JSON.stringify(result, null, 2));
      else console.log(result.stopped ? `已停止（pid ${result.pid}，端口 ${result.port}）` : '桌宠本来就没在运行');
      return;
    }
    case 'restart': {
      await stopPet();
      const state = await startPet({ quiet: false });
      if (jsonOutput) console.log(JSON.stringify(state, null, 2));
      else console.log(`已重启：端口 ${state.port}，pid ${state.pid}`);
      return;
    }
    case 'status': {
      const status = await getStatus();
      if (jsonOutput) console.log(JSON.stringify(status, null, 2));
      else printStatus(status);
      return;
    }
    case 'say': {
      const text = rest.join(' ').trim() || (await readStdinText());
      if (!text) {
        console.error('用法：pet.cmd say <文本>');
        process.exitCode = 2;
        return;
      }
      const response = await say(text);
      if (jsonOutput) console.log(JSON.stringify(response, null, 2));
      else if (response.ok) console.log(`桌宠：${text}`);
      else console.error(`发送失败：${response.error || `HTTP ${response.status}`}`);
      if (!response.ok) process.exitCode = 1;
      return;
    }
    case 'play': {
      const name = rest.join(' ').trim();
      if (!name) {
        console.log('可用的工作状态动画：');
        for (const [kind, animation] of Object.entries(ANIM)) console.log(`  ${kind.padEnd(9)} ${animation}`);
        console.log('\n其它动画名见 GET /dsh-pet-7340/config 的 animations，或右键宠物菜单。');
        return;
      }
      const response = await play(name);
      if (jsonOutput) console.log(JSON.stringify(response, null, 2));
      else if (response.ok) console.log(`已点播：${name}`);
      else console.error(`点播失败：${response.error || `HTTP ${response.status}`} ${response.text || ''}`);
      if (!response.ok) process.exitCode = 1;
      return;
    }
    case 'state': {
      const response = await callApi('/state', { timeout: 1200 });
      if (!response.ok) {
        console.error(`读取状态失败：${response.error || `HTTP ${response.status}`}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(response.json, null, 2));
      return;
    }
    case 'doctor': {
      const result = doctor();
      if (!result.ok) {
        console.error(result.error || `体检失败（退出码 ${result.status}）`);
        process.exitCode = 1;
      }
      return;
    }
    case 'electron': {
      const result = ensureElectron();
      if (!result.ok) {
        console.error(result.error || `Electron 准备失败（退出码 ${result.status}）`);
        process.exitCode = 1;
      }
      return;
    }
    case 'logs': {
      const state = loadState();
      const file = state?.log || join(LOG_DIR, 'pet.log');
      console.log(file);
      try {
        console.log(readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-40).join('\n'));
      } catch {
        console.log('（还没有日志）');
      }
      return;
    }
    case 'paths': {
      const value = paths();
      if (jsonOutput) console.log(JSON.stringify(value, null, 2));
      else Object.entries(value).forEach(([key, path]) => console.log(`${key.padEnd(11)} ${path}`));
      return;
    }
    case 'help':
    case '-h':
    case '--help': {
      console.log(HELP);
      return;
    }
    default: {
      console.error(`未知命令：${command}\n`);
      console.error(HELP);
      process.exitCode = 2;
    }
  }
}

main().catch((error) => {
  console.error(`reasonix-pet: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
