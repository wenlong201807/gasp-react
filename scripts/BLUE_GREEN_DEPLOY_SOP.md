# 蓝绿部署 SOP（gsap-react）

## 1. 目标与原则

本项目使用单机 Docker Compose + 宿主机 Nginx 实现蓝绿部署：

- Blue 和 Green 使用独立 Compose project 与宿主机回环端口。
- 当前线上实例（Active）始终保持运行。
- 新版本先部署到非 Active 实例（Candidate），健康检查通过后才切换 Nginx。
- Candidate 启动或验证失败时，只清理 Candidate，不触碰线上实例。
- 切换后保留旧实例，便于快速回滚。

默认端口：

| 颜色 | 端口 | Compose project |
| --- | ---: | --- |
| Blue | 18080 | `gsap-react-blue` |
| Green | 18081 | `gsap-react-green` |

## 2. 发布前检查

在项目根目录执行：

```bash
bash -n scripts/deploy.sh scripts/health-check.sh scripts/rollback.sh

docker compose -f docker/docker-compose.yml config

nginx -t

curl -fsS http://127.0.0.1:18080/health || true
curl -fsS http://127.0.0.1:18081/health || true
```

确认：

1. 当前域名服务正常。
2. Docker、Docker Compose、Nginx、curl、flock 可用。
3. 当前用户有 Docker、Nginx 配置和 systemd reload 权限。
4. `18080` 或 `18081` 的占用情况符合预期；Active 端口被占用是正常现象。
5. 不在两个部署命令并发执行。

## 3. 正常发布

使用当前代码和默认镜像标签：

```bash
./scripts/deploy.sh
```

指定镜像标签：

```bash
./scripts/deploy.sh <image-tag>
```

脚本执行顺序：

1. 获取部署锁。
2. 识别 Active 颜色，并选择另一颜色作为 Candidate。
3. 构建镜像。
4. 在 Candidate 端口启动对应 Compose project。
5. 轮询 Candidate 的 `/health`。
6. Candidate 健康后暂停，交互询问是否切换生产流量。
7. 只有输入 `y`、`Y`、`yes` 或 `YES` 才执行 `nginx -t`、平滑 reload Nginx。
8. 验证本机代理健康状态。
9. 原子写入 `/opt/gsap-react/active.env`。
10. 切换成功后保留旧实例，便于回滚。

交互行为：

- 输入 `n`、`N`、空输入或其他内容：停止并清理 Candidate，退出成功；Active 实例和 Nginx 流量保持不变。
- 从非交互终端执行时：默认拒绝切流，清理 Candidate，并以失败状态退出，避免后台任务意外发布。
- 如确需自动化发布，必须显式设置 `DEPLOY_AUTO_APPROVE=true ./scripts/deploy.sh <image-tag>`，仅应在已由外部流程完成审批时使用。

## 4. 发布后验证

```bash
cat /opt/gsap-react/active.env

docker compose -p gsap-react-blue -f docker/docker-compose.yml ps
docker compose -p gsap-react-green -f docker/docker-compose.yml ps

curl -fsS https://gsap.wetogether.best/health
curl -I https://gsap.wetogether.best/
```

检查 Nginx upstream：

```bash
grep -n 'proxy_pass' /etc/nginx/conf.d/gsap-react.conf
```

持续观察一段时间：

```bash
docker compose -p gsap-react-blue -f docker/docker-compose.yml logs --tail=100 -f production
docker compose -p gsap-react-green -f docker/docker-compose.yml logs --tail=100 -f production
```

## 5. Candidate 失败处理

如果 Candidate 健康检查失败、Nginx 校验失败或切换后验证失败：

- 脚本会停止本次 Candidate。
- 旧 Active 实例继续提供服务。
- Nginx 在切换失败时恢复到切换前配置。
- 不要手工执行 `docker compose down`，避免误停 Active。

排查命令：

```bash
docker compose -p gsap-react-blue -f docker/docker-compose.yml logs --tail=200 production
docker compose -p gsap-react-green -f docker/docker-compose.yml logs --tail=200 production
curl -v http://127.0.0.1:18080/health
curl -v http://127.0.0.1:18081/health
```

## 6. 回滚

默认回滚到状态文件中的 `PREVIOUS_COLOR`：

```bash
./scripts/rollback.sh
```

明确回滚到某个颜色：

```bash
./scripts/rollback.sh blue
./scripts/rollback.sh green
```

回滚前脚本会验证目标实例健康；目标不健康时不会改变当前线上流量。回滚也只切换 Nginx，不执行 Active 实例的 `down`。

## 7. 旧实例清理

默认不自动清理旧实例。确认新版本稳定后，先确认 Active 颜色：

```bash
cat /opt/gsap-react/active.env
```

只停止非 Active project，并再次确认端口与颜色对应关系：

```bash
docker compose -p gsap-react-blue -f docker/docker-compose.yml down --remove-orphans
# 仅当 ACTIVE_COLOR=green 时执行
```

或：

```bash
docker compose -p gsap-react-green -f docker/docker-compose.yml down --remove-orphans
# 仅当 ACTIVE_COLOR=blue 时执行
```

严禁对 Active project 执行 `down`。

## 8. 故障安全要求

- 不删除 `/opt/gsap-react`，其中包含状态和备份。
- 不执行全局 `docker system prune` 或 `docker compose down`。
- Nginx 配置修改前必须备份并执行 `nginx -t`。
- 任何切流失败都以保持旧流量为优先。
- 生产发布必须记录镜像标签、Active/Previous 颜色、发布时间和验证结果。
