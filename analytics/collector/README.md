# 自托管埋点采集服务

该服务接收现有客户端 `POST /track` 普通埋点，以及独立的 `POST /workflow-events` 流程事件，并写入 PostgreSQL；不提供 Dashboard、许可证、资源/插件市场、IP 封禁或 Agent 失败诊断上传。

## PostgreSQL 12

迁移脚本和表结构兼容 PostgreSQL 12。服务连接已部署的内网数据库，不负责创建或运行 PostgreSQL 实例。首次启动的账号需拥有目标 schema 的 `USAGE`、`CREATE` 以及表的 `INSERT` 权限；迁移完成后，运行账号至少需要 schema 的 `USAGE`、`tracking_events` 与 `workflow_events` 表的 `INSERT`，以及对应 `BIGSERIAL` 序列的 `USAGE` 权限。

配置内网 PostgreSQL 连接后执行：

```powershell
cd analytics\collector
Copy-Item .env.example .env
$env:DATABASE_URL = 'postgres://collector:password@postgres.internal.example:5432/yibiao_analytics'
npm install
npm run migrate
npm run dev
```

`POST /track` 与当前 Cloudflare Worker 保持字段兼容；本次客户端只将新增的流程统计发送到 `POST /workflow-events`，普通埋点继续发送到原 Cloudflare 地址。`/workflow-events` 保存 `project_created` 与 `word_export` 的生命周期、项目 ID、项目名称及文件名；`GET /health` 用于健康检查。所有接口成功返回 `{ "code": 0 }`。服务不保存原始请求 JSON，只保存当前协议中已归一化的统计字段。

## Docker

```powershell
cd analytics\collector
Copy-Item .env.example .env
docker compose up --build
```

Docker Compose 从未提交的 `.env` 读取内网 `DATABASE_URL`。容器会在启动 API 前自动执行未应用的迁移，并通过 PostgreSQL advisory lock 避免多实例重复执行。

生产环境应放在 HTTPS 反向代理后，并把 `TRUST_PROXY=true` 仅用于可信代理。客户端的普通 `analytics.agnet.top` 服务地址保持不变；仅将 `workflowAnalytics.cjs` 中新增流程事件的接收地址配置为该服务域名和路径前缀，例如 `https://medox.dpark.com.cn/yibiao/workflow-events`。当 Nginx 使用 `location /yibiao/` 与结尾带 `/` 的 `proxy_pass http://127.0.0.1:8787/` 时，它会将该请求转发为采集器实际接口 `/workflow-events`。
