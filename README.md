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
- **启动加速**：安装脚本在 `%APPDATA%/Microsoft/Windows/Start Menu/Programs/Startup/reasonix-pet-agent.vbs`
  注册隐藏的登录 supervisor；应用进程出现后约 2-5 秒拉起桌宠（`SessionStart` 实测可能晚 40 秒以上）。
- **手动停止**：`pet.cmd stop` 在当前应用实例内生效，supervisor 不会立即重新拉起；应用重启后恢复。
- 不需要随登录启动：删除上面的 VBS，并结束 `agent.mjs` 进程。
- `pet.cmd stop` 会同时结束看护进程。
- 想让桌宠常驻（不随应用退出）：设置 `REASONIX_PET_NO_WATCHDOG=1` 后再启动。

## 余额功能（DeepSeek）

- **双击宠物**：随机播放 4 个点击音效之一，并显示多行余额气泡
- **右键「刷新余额」**：立即刷新
- **右键「设置」**：打开设置页，编辑 API key、刷新间隔和余额预警阈值
- **气泡排版**：余额 / 今日已用 / 梁文峰或梁文谷 / 下次峰谷切换时间，各一行
- **峰谷称呼**：高峰 = 梁文峰，谷价 = 梁文谷
- **60 秒自动刷新**：可在设置页修改（保存后定时器立即切换）
- **余额预警**：低于阈值（默认 10 元）时气泡 + 余额动画，1 小时内不重复
- **今日已用**：按余额下降累计；充值/赠金上升单独记录，不冲掉消费
- **简单峰谷**：工作日 9:00–12:00、14:00–18:00 高峰，其余及周末谷价
- **每轮消耗**：读取 Reasonix `stats/*.jsonl` 的 `selected_amount`，每轮结束气泡显示
- **API key**：可在设置页保存到 `home/balance-config.json`，也可使用环境变量或 `%APPDATA%/reasonix/.env` 中的 `DEEPSEEK_API_KEY`
- 数据：`state/balance-ledger.json`；配置模板：`home/balance-config.example.json`
- Kaspersky/本地代理：服务会自动并入系统根证书（不关闭证书校验）
- 四个双击音效（D1/D2/Ya1/Ya2）来自 DeepSeek-Balance-Whale-Widget（MIT）

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

- `runtime/electron-helper/sprite.js`：双击余额、右键「刷新余额」「设置」与双击音效。
  升级/重装 dsh-pet 后重新运行 `node scripts/patch-balance-ui.mjs`（幂等），然后 `pet.cmd restart`。

## 目录

```
reasonix-plugin.json        Reasonix 原生插件清单（skills/commands/hooks）
pet.cmd / pet-hook.cmd      Windows 入口
scripts/install.mjs         安装 dsh-pet 运行时并打菜单补丁
scripts/balance.mjs         余额查询、今日已用、预警、峰谷与每轮消耗
scripts/settings-page.mjs   设置页
scripts/patch-balance-ui.mjs 双击余额/右键刷新/设置/音效补丁
scripts/agent.mjs           登录时 supervisor：快速拉起/停止桌宠
scripts/                    控制、hook 桥接、看护与共享配置
home/dsh-pet/main-config.jsonc  独立配置（DSH_HOME 隔离）
skills/pet/SKILL.md         给 agent 的控制说明
commands/pet.md             /pet 命令
```

`runtime/`、`state/` 与 `home/electron/` 由安装脚本/运行过程生成，不随仓库分发。

## 启动速度

- 登录 supervisor 实测在应用运行中自动拉起桌宠约 0.6 秒；应用冷启动时通常 2-5 秒出现窗口。
- `SessionStart` 仍保留为兜底，但不再依赖它做首次启动。

## 许可

上游 dsh-pet 为 MIT 许可；本适配层同样以 MIT 许可发布。见 [LICENSE](LICENSE)。
