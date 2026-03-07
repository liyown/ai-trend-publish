# 快速开始

## 1. 环境要求

- Deno v2.0.0+
- Node.js 18+（用于 VitePress 文档）

## 2. 克隆项目

```bash
git clone https://github.com/liyown/ai-trend-publish
cd ai-trend-publish
```

## 3. 初始化配置

```bash
cp .env.example .env
```

至少先完成以下变量：

- `SERVER_API_KEY`
- `WEIXIN_APP_ID`
- `WEIXIN_APP_SECRET`
- 你使用的模型供应商 API Key（如 `DEEPSEEK_API_KEY`）

如需抓取增强能力，再配置：

- `FIRE_CRAWL_API_KEY`
- `JINA_API_KEY`

## 4. 本地启动

```bash
# 启动主服务（含定时任务 + JSON-RPC 服务）
deno task start

# 运行一次测试流程
deno task test
```

默认会启动在 `http://localhost:8000`，并暴露 `POST /api/workflow`。

## 5. 触发一次工作流

```bash
curl -X POST http://localhost:8000/api/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "triggerWorkflow",
    "params": {
      "workflowType": "weixin-article-workflow"
    },
    "id": 1
  }'
```

## 6. 文档开发（VitePress）

```bash
npm install
npm run docs:dev
npm run docs:build
```

## 7. 常用构建命令

```bash
# Windows
deno task build:win

# macOS
deno task build:mac-x64
deno task build:mac-arm64

# Linux
deno task build:linux-x64
deno task build:linux-arm64
```
