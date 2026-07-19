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
- `GET /api/publish-targets`
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
- `POST|PATCH|DELETE /api/publish-targets[/:id]`

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
- `POST /api/articles/complete`：提交 `{planId, reviewRequestId, source, assetRequests}`，从原编辑简报继续编译、质检、资源生产与冻结，不重新研究或写作。接口只接受 Markdown `ArticleSource` 和结构化资源请求，不接受 AST。
- `POST /api/publications`：把内容包发布到一个或多个目标。
- `POST /api/publications/:jobId/resume`：原子取得执行权并恢复发布 Job；以 `202 Accepted` 立即返回，实际执行在后台继续。同一 Job 的并发恢复不会重复执行。

创建文章、人工完成、发布和自动化运行时，接口会以 `202 Accepted` 立即返回处于
`queued` 状态的 Job；本地执行器随后在后台运行。任务详情先通过
`GET /api/jobs/:jobId` 读取持久化快照，运行期间可通过
`GET /api/jobs/:jobId/events` 订阅带 Bearer 鉴权的 SSE 通用事件流。客户端重连时可传
`Last-Event-ID`，Job 进入终态后事件流会关闭。

本地服务启动时会自动恢复仍处于 `queued` 的 Job。服务中断时遗留的 `running` Job
会转为 `needs_attention`，避免界面永久显示运行中；这类任务需要先确认可能发生的外部副作用，再手动恢复。

创建执行请求会返回完整运行记录。运行详情同时返回内部检查点。
