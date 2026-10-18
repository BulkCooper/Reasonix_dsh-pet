# Reasonix_dsh-pet

把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 桌宠适配到 Reasonix Studio 的插件。

> 版本：`DSH_pet_reasonix 2.0.0`  
> 固定源码：`https://github.com/BulkCooper/Reasonix_dsh-pet/tree/COMMIT_PLACEHOLDER`  
> 上游：`dsh-pet@0.3.7`（MIT），Electron `43.3.0`

## 功能

- 桌面透明置顶桌宠，支持拖拽、点击、右键菜单
- Reasonix 会话事件联动：思考 / 工作 / 整理 / 等待 / 完成 / 出错
- 本地余额面板：余额、今日已用、峰谷状态、余额预警
- 按下 / 松开双音效；松开等待按下播放完
- 可配置 OpenAI 兼容对话 API；右键「对话」「碎碎念」
- 设置页底部固定保存栏、清除今日已用

## 合规说明（审核整改）

- **生命周期**：只由 Reasonix hooks 控制。
  - `SessionStart`：启动桌宠和本地面板服务
  - `SessionEnd`：停止桌宠和本地面板服务
  - 没有 Startup 文件夹条目、没有常驻 supervisor、没有独立 watchdog。
- **运行时固定附带**：`vendor/*.zip` 内置 `dsh-pet@0.3.7` 与 Electron `43.3.0`。
  - 安装和首次启动都不访问 npm / Electron 镜像，不下载代码。
  - `scripts/install.mjs` 只在本地解压；解压后 `runtime/` 与 `home/electron/` 即固定版本。
- **不修改安装后的第三方文件**：余额气泡、菜单调整和音效代码已经包含在 `vendor/pet-runtime.zip` 的适配构建中；仓库不再运行 `patch-*.mjs`。
- **不读取其他组件凭证**：
  - 不读取 Reasonix 的 `.env`、`config.toml`、stats 或其他用户文件。
  - 余额/对话 API key 只读取插件自己的 `home/balance-config.json`，由用户在设置页填写。
  - key 不写入日志，也不通过 `/status` 返回。
- **网络**：
  - 本地：`127.0.0.1:34740`（桌宠）、`127.0.0.1:34741`（余额/对话面板）
  - 余额：`https://api.deepseek.com/user/balance`
  - 对话：用户在设置里填写的 `chatBaseUrl`（默认 `https://api.deepseek.com/v1`）
- **进程**：
  - 一个 `node` 进程运行 `runtime/node_modules/dsh-pet/lib/standalone.js`
  - 一个 `node` 进程运行 `scripts/balance.mjs`
  - 一个 Electron 子进程显示桌面窗口
  - 这些进程都随 hooks 启停，不常驻。

## 安装

1. 确认 `vendor/pet-runtime.zip`、`vendor/electron-1.zip`、`vendor/electron-2.zip` 完整。
2. 运行：

```bat
pet.cmd install
```

安装脚本只做本地解压和校验，不联网。

3. 右键桌宠 → 设置，填写自己的 DeepSeek API key；需要对话时填写对话 API key（可留空复用余额 key）。

## 生命周期

- 打开 Reasonix 会话：`SessionStart` 启动桌宠
- 结束会话：`SessionEnd` 停止桌宠和面板
- 不安装启动项；Reasonix 未打开时不会运行桌宠。
- 强制结束 Reasonix 进程属于异常路径，hook 不会触发；下次正常启动时会重新拉起。

## 目录

```
reasonix-plugin.json
pet.cmd / pet-hook.cmd
scripts/config.mjs / control.mjs / pet-hook.mjs / pet.mjs / install.mjs
scripts/balance.mjs / settings-page.mjs
vendor/pet-runtime.zip
vendor/electron-1.zip / electron-2.zip
vendor/manifest.json
home/dsh-pet/main-config.jsonc
skills/pet/SKILL.md
commands/pet.md
```

## 账户说明

为满足审核要求，插件不再自动读取 Reasonix 的 providers。余额面板使用**一个用户自己填写的 DeepSeek 账户**（key + 余额接口），不读取 `.env` 或 `config.toml`。多账户自动发现和每轮消耗统计已移除。

## 来源与许可

- `dsh-pet@0.3.7`：MIT，原作者 PC2005-cloud
- 自适应修改：BulkCooper
- Electron `43.3.0`：Electron 许可证包含在 `vendor/electron-2.zip`
- 点击音效 D1/D2/Ya1/Ya2：来自 DeepSeek-Balance-Whale-Widget（MIT）
