#!/usr/bin/env node
/**
 * 安装/校验固定版本运行时。
 *
 * 合规约束：不访问 npm、不下载 Electron、不写启动文件夹、不启动 supervisor、
 * 不修改任何第三方文件。运行时随包放在 vendor/*.zip，本地解压。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELECTRON_EXE,
  PET_RUNTIME_ZIP,
  ELECTRON_ZIP_1,
  ELECTRON_ZIP_2,
  STANDALONE_ENTRY,
  STATE_DIR,
  ensureDirs,
  ensureRuntime,
} from './config.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js >= 22.12 is required (current: ${process.versions.node}).`);
  process.exit(1);
}

ensureDirs();
console.log('[install] 使用随包附带的固定版本运行时，不联网下载 ...');
console.log(`[install] runtime: ${PET_RUNTIME_ZIP}`);
console.log(`[install] electron: ${ELECTRON_ZIP_1} + ${ELECTRON_ZIP_2}`);
if (!ensureRuntime()) {
  console.error('[install] 固定运行时缺失或解压失败，请检查 vendor/*.zip 是否完整。');
  process.exit(1);
}
writeFileSync(join(STATE_DIR, 'node-path.txt'), process.execPath, 'utf8');
console.log(`[install] standalone: ${STANDALONE_ENTRY}`);
console.log(`[install] electron:   ${ELECTRON_EXE}`);
console.log('[install] 完成；生命周期只由 Reasonix hooks 控制。');
