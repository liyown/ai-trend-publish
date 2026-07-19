# 部署

## Docker

```bash
mkdir -p config data
cp trendpublish.config.docker.example.ts config/trendpublish.config.ts
docker compose up -d
```

`./data` 挂载到 `/app/data`，其中包含 SQLite 数据库。镜像先构建 Dashboard，再只启动 API 服务，不运行前端开发服务器。

## Cloudflare

Cloudflare 使用一个 Worker、静态 Dashboard assets 和一个 D1 数据库。

```bash
vp run cf:sync-secrets
vp run cf:migrate
vp run cf:deploy
vp run cf:smoke --url https://<worker-url> --api-key <key>
```

这是全新 schema；`migrations/0001_modular_runtime.sql` 是唯一迁移，不兼容旧数据库表。已经部署旧版本时，应创建新的 D1 数据库并重新配置连接和工作区对象。

## 微信 Relay

Cloudflare 出口 IP 不适合微信公众号白名单时，在固定 IP 主机运行 Relay：

```bash
vp run relay
# 或
docker compose -f docker-compose.relay.yml up -d
```

在 Dashboard 创建“微信公众号 Relay”连接，填入 Relay URL、Token、App ID 和 App Secret；主服务通过该连接调用 Relay。Relay 本身不保存账号配置。

## 安全边界

- 必须配置非空 `server.apiKey` / `SERVER_API_KEY`，否则本地服务拒绝启动。
- Dashboard API 全部使用 Bearer Token。
- Connector 凭证不回显到浏览器。
- 生产数据库和配置目录必须纳入备份，但不要把 `trendpublish.config.ts` 或 SQLite 文件提交到 Git。
