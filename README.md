# Reasonix_dsh-pet

把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（DeepSeek Harness 的大肥鱼桌宠）
移植到 **Reasonix Studio**：宠物以透明置顶小窗住在桌面上，跟随 Reasonix 会话事件切换
思考 / 工作 / 整理 / 成功 / 出错动画，并随 Reasonix 主进程自动启停。

## 功能

- 桌面透明置顶宠物（dsh-pet 0.3.7 的 106 个手绘动画、拖拽/甩抛、右键动作菜单）
- Reasonix 会话事件联动：思考 / 工作 / 整理 / 等待 / 成功 / 出错
- 随 Reasonix 主进程启停：结束 Reasonix 后约 6 秒停止桌宠；重新启动后自动拉起
- 独立 `DSH_HOME`（`home/`）与端口（默认 34740），不读写 `~/.dsh`
- 移除桌面右键菜单里的「打开网站 / 打开 DeepSeek Harness」项

## 安装

### Reasonix 市场安装

1. 在市场安装 **DSH_pet_reasonix**。
2. 打开插件目录（Reasonix 设置 → 插件 → DSH_pet_reasonix → 打开目录）。
3. 在插件目录运行：

   ```bat
   node scripts/install.mjs
   ```

4. 重启 Reasonix（或运行 `pet.cmd start`）。首次启动会自动下载 Electron 到 `home/electron`。

### 手动安装

```bat
git clone https://github.com/BulkCooper/Reasonix_dsh-pet.git "%APPDATA%/reasonix\plugins\DSH_pet_reasonix"
cd /d "%APPDATA%/reasonix\plugins\DSH_pet_reasonix"
node scripts/install.mjs
```

然后把插件登记到 `%APPDATA%/reasonix\plugin-packages.json`（或在 Reasonix 插件管理中安装该目录），重启 Reasonix。

### 依赖

- Node.js **>= 22.12**
- 网络：npm 安装 `dsh-pet@0.3.7`；首次启动下载 Electron（约 138 MB，走 npmmirror）
- 安装脚本可加 `--with-electron` 提前下载 Electron

## 使用

```bat
pet.cmd status
pet.cmd start
pet.cmd say "今天也要加油哦～"
pet.cmd play 工作状态-思考冒泡
pet.cmd stop
```

重启 Reasonix 后会加载插件自带的 `pet` 技能和 `/pet` 命令。

## 生命周期

- **启动**：Reasonix 会话启动时 `SessionStart` hook 调用 `pet.cmd start`，桌宠与看护进程一起拉起。
- **关闭**：看护每 2 秒检查启动时记录的 Reasonix 主进程 PID，连续 3 次（约 6 秒）检测不到就停止桌宠。
  只看进程、不看窗口：关闭到后台（`close_behavior=background`）时桌宠继续；结束 Reasonix 进程后停止。
- **应用重启**：主进程 PID 变化时，`SessionStart` 会主动重启桌宠并重新接管。
- `pet.cmd stop` 会同时结束看护进程。
- 想让桌宠常驻（不随应用退出）：设置 `REASONIX_PET_NO_WATCHDOG=1` 后再启动。

## 事件联动

| Reasonix hook | 桌宠状态 |
| --- | --- |
| SessionStart | waiting（并自动拉起桌宠） |
| UserPromptSubmit | thinking |
| PreToolUse | working |
| PostToolUse | result |
| PostToolUseFailure / StopFailure | error |
| Stop | success |
| Notification / PermissionRequest | waiting |
| SessionEnd | waiting（道别） |

## 限制

独立模式不提供余额、碎碎念、对话生成与系统通知（这些依赖 DSH 的凭证/模型/会话）。
需要宠物“说话”时用 `pet.cmd say <文本>` 直接投喂。

## 上游修改

- `runtime/electron-helper/sprite.js`：桌面右键菜单移除「打开网站 / 打开 DeepSeek Harness」项。
  该文件是 dsh-pet 的构建产物，升级/重装 dsh-pet 后会被覆盖；重新运行
  `node scripts/remove-open-site.mjs`（幂等），然后 `pet.cmd restart`。

## 目录

```
reasonix-plugin.json        Reasonix 原生插件清单（skills/commands/hooks）
pet.cmd / pet-hook.cmd      Windows 入口
scripts/install.mjs         安装 dsh-pet 运行时并打菜单补丁
scripts/                    控制、hook 桥接、看护与共享配置
home/dsh-pet/main-config.jsonc  独立配置（DSH_HOME 隔离）
skills/pet/SKILL.md         给 agent 的控制说明
commands/pet.md             /pet 命令
```

`runtime/`、`state/` 与 `home/electron/` 由安装脚本/运行过程生成，不随仓库分发。

## 许可

上游 dsh-pet 为 MIT 许可；本适配层同样以 MIT 许可发布。见 [LICENSE](LICENSE)。
