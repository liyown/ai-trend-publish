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

## 微信固定住宅 HTTP 代理

微信公众号要求调用 IP 位于账号白名单时，可以让主服务通过账号级 HTTP CONNECT 代理直接请求微信 API，不需要部署 Relay 服务。

在 Dashboard 的“发布账号”中选择“微信公众号”直连接入方式，并在接入配置中填写“HTTP 代理地址”：

```text
http://username:password@proxy.example.com:8080
```

代理地址按账号凭证保存，API 只返回是否已配置，不返回代理 URL。获取 `access_token`、上传封面、上传正文图片和创建草稿都会使用同一个代理；模型、搜索、抓取和图片生成连接不受影响。将代理的固定出口 IP 加入微信公众平台白名单后，使用账号对话框中的“测试连接”确认代理和微信凭证都可用。

代理不可达或认证失败只会让对应发布账号失败，不会切换到 Relay 或其他发布路径。

## 微信 Relay（兼容方式）

Cloudflare 出口 IP 不适合微信公众号白名单时，在固定 IP 主机运行 Relay：

```bash
vp run relay
# 或
docker compose -f docker-compose.relay.yml up -d
```

在 Dashboard 创建“微信公众号 Relay”连接，填入 Relay URL、Token、App ID 和 App Secret；主服务通过该连接调用 Relay。Relay 本身不保存账号配置。

主服务与 Relay 必须同步升级。账号的“测试连接”会校验 Relay 协议版本；图片上传还会核对 SHA-256 回执，避免旧 Relay 或错误路由复用其他封面素材。

## 安全边界

- 必须配置非空 `server.apiKey` / `SERVER_API_KEY`，否则本地服务拒绝启动。
- Dashboard API 全部使用 Bearer Token。
- Connector 凭证不回显到浏览器。
- 生产数据库和配置目录必须纳入备份，但不要把 `trendpublish.config.ts` 或 SQLite 文件提交到 Git。
