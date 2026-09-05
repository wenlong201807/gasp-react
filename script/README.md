# 验收脚本

本目录集中存放项目校验、诊断与浏览器验收脚本。

## 事件循环动画

- `event-loop-trace-verify.mjs`：Node 严格校验脚本。加载三个事件循环预设，在 Node 中执行预设代码并核对真实 Console 输出顺序、trace 不变量与 Lottie 编译结果；运行 `node script/event-loop-trace-verify.mjs --strict`。
- `event-loop-accept.py`：Playwright 端到端验收脚本。启动页面后依次验证菜单、三张预设、舞台区域、2x 播放、Console 输出、单步回退、进度点跳转、重播及另外两个预设。
- `event-loop-playback-probe.py`：播放诊断脚本。按时间轮询步骤计数和暂停按钮状态，并保存结束截图，用于确认 Lottie 帧事件持续推进。
- `event-loop-console-probe.py`：浏览器事件诊断脚本。以 2x 播放预设并收集前若干条 Console，辅助定位 `enterFrame`、播放和事件回调问题。

Python 脚本需要 Playwright。推荐由服务器管理脚本运行：

```bash
python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm dev" --port 5173 \
  -- python3.11 script/event-loop-accept.py
```

## 其他脚本

- `fiber-todo-cdp-diagnostics.mjs`：Fiber Todo 页面 CDP 诊断脚本，用于采集浏览器运行时诊断信息。
- `health-check.sh`、`deploy.sh`：项目既有健康检查与部署脚本。
