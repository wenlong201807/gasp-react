# 验收脚本

本目录集中存放项目校验、诊断与浏览器验收脚本。

## 事件循环动画

- `event-loop-trace-verify.mjs`：Node 严格校验脚本。加载三个事件循环预设，在 Node 中执行预设代码并核对真实 Console 输出顺序、trace 不变量与 Lottie 编译结果；运行 `node script/event-loop-trace-verify.mjs --strict`。
- `event-loop-accept.py`：Playwright 端到端验收脚本。启动页面后依次验证菜单、三张预设、舞台区域、2x 播放、Console 输出、单步回退、进度点跳转、重播、全屏/FPS 信息及退出行为；若浏览器拒绝原生全屏，则验收页面内沉浸模式。
- `event-loop-fps-probe.mjs`：Node 行为探针，验证实时 FPS 采样的 1 秒窗口、首帧不足和 500ms 过期规则。
- `event-loop-playback-probe.py`：播放诊断脚本。按时间轮询步骤计数和暂停按钮状态，并保存结束截图，用于确认 Lottie 帧事件持续推进。
- `event-loop-console-probe.py`：浏览器事件诊断脚本。以 2x 播放预设并收集前若干条 Console，辅助定位 `enterFrame`、播放和事件回调问题。
- `url-lifecycle-accept.py`：Playwright 端到端验收脚本。依次验证菜单 🌐 卡片、两幕选择页、舞台七节点/TLS/缓存判定区/六泳道、全屏入口及沉浸降级、2x 播放到 20/20 与 14/14、单步回退、进度点跳步、重播、切幕重建、第 6 步 304 与第 9 步 from disk cache 徽标，并收集 pageerror 与保存结束截图。

URL 生命周期验收执行：

```bash
# 先查看脚本参数与执行说明
python3 script/url-lifecycle-accept.py --help

# 推荐：由 with_server 管理 pnpm dev 生命周期并执行完整浏览器验收
python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py \\
  --server "pnpm dev" --port 5173 \\
  -- python3.11 script/url-lifecycle-accept.py
```

脚本会验证 URL 生命周期全屏目标只包含动画舞台和控制栏，不包含标题栏/换幕按钮；会通过浏览器外部 `exitFullscreen()` 验证 `fullscreenchange` 能同步按钮状态；在浏览器拒绝原生 Fullscreen API 时，允许并验证页面内沉浸模式。验收结束截图保存到 `/tmp/url-lifecycle-final.png`。

```bash
python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm dev" --port 5173 \
  -- python3.11 script/event-loop-accept.py
```

## 其他脚本

- `fiber-todo-cdp-diagnostics.mjs`：Fiber Todo 页面 CDP 诊断脚本，用于采集浏览器运行时诊断信息。
- `health-check.sh`、`deploy.sh`：项目既有健康检查与部署脚本。
