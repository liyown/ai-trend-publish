# REST API

所有 `/api/*` 请求都需要：

```http
Authorization: Bearer <server.apiKey>
```

## 读取

- `GET /api/health`
- `GET /api/workspace`
- `GET /api/connections`
- `GET /api/identities`
- `GET /api/knowledge-bases`
- `GET /api/source-collections`
- `GET /api/content-plans`
- `GET /api/channel-accounts`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/activities`
- `GET /api/jobs`
- `GET /api/jobs/:jobId`

## 配置对象

- `POST|PATCH|DELETE /api/connections[/:id]`
- `POST /api/connections/test`
- `POST|PATCH|DELETE /api/identities[/:id]`
- `POST|PATCH|DELETE /api/knowledge-bases[/:id]`
- `POST|PATCH|DELETE /api/source-collections[/:id]`
- `POST|PATCH|DELETE /api/content-plans[/:id]`
- `POST|PATCH|DELETE /api/channel-accounts[/:id]`

工作区对象更新可携带 `revision`。版本落后时返回 `409`，避免覆盖他人修改。

## 执行

- `GET /api/automations`：列出自动化任务。
- `POST /api/automations`：创建自动化任务。
- `PATCH /api/automations/:id`：更新自动化任务。
- `DELETE /api/automations/:id`：删除自动化任务。
- `POST /api/automations/:id/run`：手动运行自动化任务。
- `POST /api/automation-runs/:jobId/resume`：原子恢复同一个自动化运行及其已记录的文章/发布子 Job；不会重新创建发布任务。
- `POST /api/articles`：按内容方案生成内容。
- `POST /api/articles/:jobId/resume`：原子取得执行权并从检查点恢复文章 Job；以 `202 Accepted` 立即返回，实际执行在后台继续。同一 Job 的并发恢复不会重复执行。
- `POST /api/publications`：接收 `packageId` 和 `destinations[{accountId, publicationType, options?}]`，把内容包发布到一个或多个目的地。
- `POST /api/publications/:jobId/resume`：原子取得执行权并恢复发布 Job；以 `202 Accepted` 立即返回，实际执行在后台继续。同一 Job 的并发恢复不会重复执行。
- `POST /api/runs/:runId/resume`：恢复该运行中可安全重试的失败 Job。
- `POST /api/runs/:runId/destinations/:destinationId/retry`：仅重试失败目的地；`needs_attention` 目的地返回 `409`，避免重复未知外部副作用。

创建文章、发布和自动化运行时，接口会以 `202 Accepted` 返回 `{ job, run }`，本地执行器随后在后台运行。用户界面使用运行接口；Job 接口保留给内部诊断和恢复。

## 运行实时流

- `GET /api/runs/:runId/events`：可恢复活动 SSE。活动先落库再推送，SSE `id` 是稳定 `sequence`；客户端用 `Last-Event-ID` 或 `afterSequence` 续传并去重。
- `GET /api/runs/:runId/model-stream`：仅在线的模型原始增量 SSE。包含 provider 返回的 assistant 文本和 Tool Call 名称、参数 JSON 增量；不回放，不持久化，不包含隐藏思维链、凭证、授权头或 Connector 内部配置。

Dashboard 把模型增量显示在对应的模型轮次活动内，而不是建立第二条历史时间线。页面刷新、切换设备或 SSE 断线期间丢失的增量不可恢复；模型轮次状态、工具活动和最终提交仍通过活动流恢复。活动 SSE 不可用时客户端降级为轮询 `/activities`。

内部任务详情仍可通过 `GET /api/jobs/:jobId` 读取，`GET /api/jobs/:jobId/events` 提供通用 Job SSE。它不用于承载原始模型文本。

本地服务启动时会自动恢复仍处于 `queued` 的 Job。服务中断时遗留的 `running` Job
会转为 `needs_attention`，避免界面永久显示运行中；这类任务需要先确认可能发生的外部副作用，再手动恢复。

运行详情只返回安全的运行、会话和聚合快照，不暴露内部检查点、渠道凭证或模型原始输出。
