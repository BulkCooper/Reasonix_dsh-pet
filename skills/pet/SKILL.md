---
name: pet
description: 控制 Reasonix 桌面宠物（dsh-pet 适配版）——让宠物说一句话、点播动画、查看运行状态或诊断。Use when the user asks to control the desktop pet, make it say something, play an animation, or troubleshoot why the pet is not visible.
---

# Reasonix 桌宠（dsh-pet 适配版）

桌宠由独立进程运行（`dsh-pet` standalone + Electron 透明置顶窗），不依赖 DSH，也不需要模型调用。
插件目录：`%APPDATA%\reasonix\plugins\reasonix-pet`。

## 什么时候用它

- 用户说“让宠物说……”“叫桌宠……”“宠物怎么不见了”
- 用户想点播某个动作，或想看宠物当前状态
- 需要确认桌宠进程/端口是否正常

不要主动、频繁地调用；只在用户明确提到桌宠时使用。

## 命令

Windows（bash 或 cmd 均可）：

```bat
"%APPDATA%\reasonix\plugins\reasonix-pet\pet.cmd" status
"%APPDATA%\reasonix\plugins\reasonix-pet\pet.cmd" say "今天也要加油哦～"
"%APPDATA%\reasonix\plugins\reasonix-pet\pet.cmd" play 工作状态-思考冒泡
```

- `say <文本>`：把文本直接写进气泡（不调用模型）
- `play <动画名>`：点播动画；不带参数会列出工作状态动画
- `status` / `status --json`：运行状态、端口、宠物列表
- `start` / `stop` / `restart`：显式管理进程（`say`/`play` 会自动启动）
- `doctor`：dsh-pet 自带体检（配置、Electron、宠物清单）
- `logs`：查看最近日志

## 动画名

工作状态档位（默认配置）：

| 档位 | 动画名 |
| --- | --- |
| thinking | 工作状态-思考冒泡 |
| working | 工作状态-忙碌点按 |
| result | 工作状态-清点归档 |
| waiting | 工作状态-原地踱步张望 |
| success | 工作状态-雀跃庆祝 |
| error | 工作状态-垂头叹气冒汗 |

其它动画名取自 `GET /dsh-pet-7340/config` 的 `animations`，或在宠物右键菜单里查看。
不确定动画名时，先 `play`（不带参数）或 `status --json`，不要猜。

## 运行方式

- 端口默认 `34740`，被占用时自动顺延；实际端口见 `status`
- 配置：`%APPDATA%\reasonix\plugins\reasonix-pet\home\dsh-pet\main-config.jsonc`
- 日志：`%APPDATA%\reasonix\plugins\reasonix-pet\state\logs`
- Reasonix hooks 会自动把会话事件（思考/工作/完成/出错）映射成宠物动画

## 限制

独立模式不提供余额、碎碎念、对话生成与系统通知（这些依赖 DSH 的凭证/模型/会话）。
用户想让宠物“说点什么”时，直接用 `say` 喂文本即可；不要声称宠物能自行生成内容。

## 故障排查

1. `pet.cmd status` 看不到“运行中” → `pet.cmd start`
2. 进程在但桌面没有窗口 → `pet.cmd doctor` 看 Electron 是否就绪；`pet.cmd electron` 可手动下载
3. 动画名报错 → 用 `pet.cmd state` 或右键菜单确认可用动画
4. 仍不显示 → `pet.cmd logs` 查看 standalone 日志
