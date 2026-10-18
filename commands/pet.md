---
description: 控制 Reasonix 桌宠（说一句话 / 点播动画 / 查看状态）
argument-hint: [say <文本> | play <动画名> | status]
---

用户想操作 Reasonix 桌宠。执行：

```bat
"%APPDATA%\reasonix\plugins\reasonix-pet\pet.cmd" $ARGUMENTS
```

如果 `$ARGUMENTS` 为空，先运行 `status` 并展示结果。根据输出用中文回复；失败时给出下一步
（`start`、`doctor` 或 `logs`），不要反复重试同一条命令。
