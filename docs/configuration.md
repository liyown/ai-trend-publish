# 配置说明

本项目推荐使用 `trendpublish.config.ts` 作为主要配置来源。它有 TypeScript
类型提示，适合集中组织模型、抓取源、微信发布、图片和通知配置。

```bash
cp trendpublish.config.example.ts trendpublish.config.ts
deno task doctor
```

部署级配置只从 `trendpublish.config.ts` 读取。Dashboard
可编辑的运行时业务配置会写入 SQLite/D1；密钥、binding 和外部服务连接仍然只放在
TS 配置或部署环境里。 `doctor` 会按功能块检查缺失项，并把
`your_api_key`、`change-me` 这类占位值视为未配置。

## 配置文件路径

默认读取当前目录的 `trendpublish.config.ts`。需要切换配置文件时，可以显式指定：

```bash
deno task doctor --config ./config/trendpublish.config.ts
deno task article --dry-run --config ./config/trendpublish.config.ts
deno task dev --config ./config/trendpublish.config.ts
```

也可以设置 `TRENDPUBLISH_CONFIG` 指向配置文件。Docker 镜像默认读取
`/app/config/trendpublish.config.ts`。

## 运行时配置函数

配置仍然是 TypeScript 结构。如果部署环境里的密钥或地址需要动态注入，可以把
`defineConfig` 写成函数：

```ts
import { defineConfig } from "@src/utils/config/define-config.ts";

export default defineConfig((runtime) => ({
  server: {
    apiKey: runtime.required("SERVER_API_KEY"),
  },
  providers: {
    ai: {
      baseUrl: runtime.value("AI_BASE_URL", "https://api.deepseek.com/v1"),
      apiKey: runtime.required("AI_API_KEY"),
      model: runtime.value("AI_MODEL", "deepseek-chat"),
    },
  },
  features: {
    article: {
      dryRun: true,
      sources: ["https://news.ycombinator.com/"],
    },
  },
}));
```

这样只有“哪些值从运行时来”是显式的，不会出现通用覆盖规则导致配置来源混乱。

## 最小配置

如果只是启动服务、预览模板、跑 AI 摘要和动态模板，先填这一组：

```ts
import { defineConfig } from "@src/utils/config/define-config.ts";

export default defineConfig({
  server: { apiKey: "your-api-key" },
  providers: {
    ai: {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "your_api_key",
      model: "deepseek-chat",
    },
  },
  features: {
    article: {
      renderer: { template: "minimal" },
      dryRun: true,
    },
  },
});
```

如果要在固定 IP 的本地服务器或 Docker 里直连微信公众号，还必须填：

```ts
providers: {
  publish: {
    weixin: {
      appId: "your_app_id",
      appSecret: "your_app_secret",
    },
  },
}
```

多公众号时，把每个公众号放进 `accounts`，再由文章方案选择目标账号：

```ts
providers: {
  publish: {
    weixin: {
      accounts: {
        main: { appId: "main_app_id", appSecret: "main_secret" },
        lab: { appId: "lab_app_id", appSecret: "lab_secret" },
      },
    },
  },
},
features: {
  article: {
    publisher: { provider: "weixin", accountId: "main" },
  },
},
```

这里的 `providers.publish.weixin.accounts`
只保存微信连接信息。账号的运营信息不放在 TS 配置里，而是进入运行时配置：

- Dashboard
  `账号矩阵`：维护账号名称、定位、目标读者、语气、标题偏好、禁区和内容来源分组。
- `defaultArticleProfileId`：给账号绑定默认文章方案。
- `defaults`：允许账号覆盖模板、提示词风格、文章数量和数据源分组，但不会反向修改文章方案。

运行时会分别解析文章方案和账号：

- 文章方案：本次运行传入的 `profileId` > 账号绑定的 `defaultArticleProfileId` /
  `defaults.articleProfileId` > 默认文章方案。
- 目标账号：本次运行传入的 `accountId` > 文章方案里的 `publisher.accountId`。
- 账号覆盖项：`defaults.template`、`defaults.promptProfile`、`defaults.count` 和
  `defaults.sourceGroupIds` 只影响当前账号的本次运行。

`defaults.sourceGroupIds` 会把文章方案的数据源收窄到指定分组，例如
`["search",
"rss"]`。这适合让不同公众号账号消费不同来源池，从同一套系统里生成差异化内容。解析后的账号快照和最终来源列表都会写入本次
run 的配置 artifact，便于复盘某篇文章用了哪个账号风格和哪些来源。

如果是 Cloudflare Worker / Workflows 这类没有固定出口 IP 的环境，推荐发布到固定
IP 机器上的 `weixin-relay`。新的 relay 是无账号状态的固定 IP 代理：

- relay 机器只配置 `server.apiKey`，不保存公众号 AppID/AppSecret。
- Cloudflare / 主服务仍配置
  `providers.publish.weixin`，运行时会把本次账号凭证随请求透传给 relay。
- `providers.publish.weixinRelay.token` 必须与 relay 机器的 `server.apiKey`
  一致。

```ts
providers: {
  publish: {
    weixin: {
      accounts: {
        main: { appId: "main_app_id", appSecret: "main_secret" },
      },
    },
    weixinRelay: {
      url: "https://relay.example.com",
      token: "your_relay_token",
    },
  },
},
features: {
  article: {
    publisher: { provider: "weixin-relay", accountId: "main" },
    dryRun: false,
  },
},
```

## 功能开关与必需配置

| 想开启的功能            | TS 配置位置                                                                                        | 说明                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 启动 JSON-RPC 服务      | `server.apiKey`                                                                                    | API 请求需带 `Authorization: Bearer <key>`                                                           |
| AI 摘要、排序、动态模板 | `providers.ai.*`                                                                                   | 使用 OpenAI Chat Completions 兼容接口                                                                |
| 本地模板预览            | `features.article.renderer.template`                                                               | 静态模板不依赖公众号配置                                                                             |
| 提示词风格              | `features.article.renderer.promptProfile`                                                          | 控制排序、摘要、标题、动态排版和配图口径                                                             |
| 微信文章 dry-run        | `features.article.dryRun: true`                                                                    | 不发布，本地输出 HTML，Cloudflare 输出 R2 artifact                                                   |
| 微信公众号正式发布      | `features.article.publisher`, `providers.publish.weixin`，按需配置 `providers.publish.weixinRelay` | 本地固定 IP 可直连微信；Cloudflare 推荐 relay。relay 不保存公众号凭证，主服务透传本次账号凭证        |
| 文章数据源              | `features.article.sources`                                                                         | URL 列表，可用抓取分组前缀                                                                           |
| 抓取供应商              | `providers.fetch.*`                                                                                | FireCrawl、Twitter/X、Xquik、Jina、Brave、Tavily、Exa、Serper、NewsAPI、RSS；GDELT/HN/arXiv 无需 Key |
| 封面生图                | `features.article.cover`, `providers.image.dashscope/minimax.apiKey`                               | 支持阿里云图片生成和 MiniMax，失败时使用兜底封面                                                     |
| 正文 AI 智能配图        | `features.article.bodyImages`, `providers.image.dashscope/minimax.apiKey`                          | 按文章内容生成正文配图，失败时回退已有图片                                                           |
| 发布前质量门禁          | `features.article.qualityGate`                                                                     | 只保护真实发布，dry-run 永远继续产出                                                                 |
| 文章向量去重            | `features.article.deduplication`, `providers.vector.embedding.*`, `storage.vector.*`               | 本地/Docker 用 SQLite，Cloudflare 用 D1                                                              |
| 运行看板和产物          | `storage.artifacts`, `storage.runState`                                                            | 本地写文件，Cloudflare 使用 R2/KV/D1                                                                 |
| 日志观测                | `observability`                                                                                    | 镜像所有 Logger 输出到 stdout 或 HTTP ingest                                                         |
| Bark 通知               | `features.article.notifications.channels`, `providers.notify.bark`                                 | channels 中包含 `bark` 时检查 Bark URL                                                               |
| 钉钉通知                | `features.article.notifications.channels`, `providers.notify.dingtalk`                             | channels 中包含 `dingtalk` 时检查 webhook                                                            |
| 飞书通知                | `features.article.notifications.channels`, `providers.notify.feishu`                               | channels 中包含 `feishu` 时检查 webhook                                                              |

## 运行产物与看板存储

本地/Docker 默认配置无需手动填写：

```ts
storage: {
  artifacts: {
    provider: "local",
    outputDir: "src/temp",
  },
  runState: {
    provider: "local-json",
    outputDir: "src/temp",
  },
  runtimeConfig: {
    provider: "sqlite",
    sqlitePath: "src/temp/trendpublish.sqlite3",
  },
  vector: {
    provider: "sqlite",
    sqlitePath: "src/temp/trendpublish.sqlite3",
  },
},
```

Cloudflare Workflow 原生模式使用 bindings：

```ts
storage: {
  artifacts: {
    provider: "r2",
    bucketBinding: "ARTICLE_ARTIFACTS",
  },
  runState: {
    provider: "kv-d1",
    kvBinding: "ARTICLE_RUNS",
    d1Binding: "ARTICLE_DB",
  },
  runtimeConfig: {
    provider: "d1",
    d1Binding: "ARTICLE_DB",
  },
  vector: {
    provider: "d1",
    d1Binding: "ARTICLE_DB",
  },
},
```

`runtimeConfig` 是 Dashboard 可编辑配置的存储位置。它只保存 Profile、
数据源、抓取分组、定时规则和非敏感功能参数；provider 密钥仍来自
`providers.*`、Docker secrets 或 Cloudflare secrets。

Dashboard 中的运行时配置分成两类：

- 能力 Profile：LLM、图片生成、通知、抓取策略、Embedding 等可复用能力。
- 功能 Profile：微信文章这类具体功能，引用能力 Profile，并允许覆盖少量参数。
- 账号 Profile：公众号运营定位和默认文章方案，用于多账号矩阵运行。

例如多个微信文章 Profile 可以共用同一个“正文配图”能力 Profile，也可以分别覆盖
图片数量或尺寸。

`/dashboard` 会读取同一套 run state 和 artifact，因此本地和 Cloudflare
都能查看步骤、错误、耗时和 HTML 产物。

## 推荐配置路径

### 1. 只看模板效果

```ts
server: { apiKey: "your-api-key" },
providers: {
  ai: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your_api_key",
    model: "deepseek-chat",
  },
},
features: {
  article: {
    renderer: { template: "minimal" },
    dryRun: true,
  },
},
```

运行：

```bash
deno task preview
```

### 2. 跑一次微信文章 dry-run

在最小配置基础上，配置抓取供应商和 URL 列表：

```ts
providers: {
  fetch: {
    firecrawl: { apiKey: "your_firecrawl_key" },
    twitter: { xquikApiKey: "your_xquik_key" },
    jina: { apiKey: "your_jina_key" },
    brave: { apiKey: "your_brave_key" },
    tavily: { apiKey: "your_tavily_key" },
    exa: { apiKey: "your_exa_key" },
    serper: { apiKey: "your_serper_key" },
    newsapi: { apiKey: "your_newsapi_key" },
  },
},
fetchGroups: {
  default: ["auto"],
  web: ["firecrawl", "jina"],
  social: ["twitter"],
  search: ["gdelt", "hackernews", "arxiv"],
  paidSearch: ["brave-search", "jina-search", "tavily-search", "exa-search", "serper-search"],
},
features: {
  article: {
    dryRun: true,
    renderer: {
      template: "dynamic",
      promptProfile: "technology",
    },
    sources: [
      "https://news.ycombinator.com/",
      "web:https://openai.com/news/",
      "social:https://x.com/OpenAIDevs",
      "search:AI agent research breakthrough latest",
    ],
  },
},
```

无前缀 URL 使用 `fetchGroups.default`；`web:`、`social:` 是自定义抓取分组名。
`search:` 是关键词搜索源，可以路由到 `jina-search`、`brave-search`、
`tavily-search`、`exa-search`、`serper-search`、`newsapi`、`gdelt`、
`hackernews`、`arxiv`。分组内 provider 按顺序 fallback，成功一个就停止。 `auto`
会按 URL 推断：Twitter/X 域名走 Twitter，RSS/RSSHub 走 RSS，其余网页走
FireCrawl；query 源默认推断到 Jina Search。`gdelt`、`hackernews`、`arxiv` 不需要
API Key，适合免费补充新闻、技术社区和论文线索。

如果你要直接接入自定义 RSS / Atom / JSON Feed，最小配置可以写成：

```ts
fetchGroups: {
  default: ["auto"],
},
features: {
  article: {
    dryRun: true,
    sources: [
      "https://your-feed.example.com/rss.xml",
      "https://another-feed.example.com/feed",
    ],
  },
},
```

建议先执行一次 `deno task article --dry-run`，确认 run 产物里已经包含这些 RSS
条目，再叠加 prompt profile、通知和正式发布配置。

运行：

```bash
deno task article --dry-run
```

### 3. 正式发布公众号

在 dry-run 跑通后，再配置：

```ts
providers: {
  publish: {
    weixin: {
      appId: "your_app_id",
      appSecret: "your_app_secret",
      // 多公众号时也可以改用 accounts，并在 publisher.accountId 里选择。
    },
  },
},
features: { article: { publisher: { provider: "weixin" }, dryRun: false } },
```

运行：

```bash
deno task article
```

### 4. 开启封面生图

```ts
providers: {
  image: { dashscope: { apiKey: "your_dashscope_key" } },
},
features: {
  article: {
    cover: { enabled: true, provider: "dashscope", model: "qwen-image-2.0-pro" },
  },
},
```

如果使用 MiniMax：

```ts
providers: {
  image: { minimax: { apiKey: "your_minimax_key" } },
},
features: {
  article: {
    cover: { enabled: true, provider: "minimax", model: "image-01" },
  },
},
```

封面生成失败不会中断主流程，会回退默认封面。

### 5. 开启正文 AI 智能配图

```ts
providers: {
  image: { dashscope: { apiKey: "your_dashscope_key" } },
},
features: {
  article: {
    bodyImages: {
      mode: "missing",
      provider: "dashscope",
      model: "qwen-image-2.0",
      count: 1,
      size: "1024*1024",
    },
  },
},
```

MiniMax 正文配图写法：

```ts
providers: {
  image: { minimax: { apiKey: "your_minimax_key" } },
},
features: {
  article: {
    bodyImages: {
      mode: "missing",
      provider: "minimax",
      model: "image-01",
      count: 1,
      size: "1024*1024",
    },
  },
},
```

默认只在文章没有抓取到原文 `media` 图片时生成正文配图。生成失败不会中断发布，
会回退到已有 media 图片布局。

### 6. 开启文章去重

```ts
providers: {
  vector: {
    embedding: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "your_dashscope_key",
      model: "text-embedding-v3",
    },
  },
},
features: {
  article: {
    deduplication: {
      enabled: true,
      embeddingProvider: "dashscope",
      vectorStore: "sqlite",
    },
  },
},
storage: {
  vector: {
    provider: "sqlite",
    sqlitePath: "src/temp/trendpublish.sqlite3",
  },
},
```

SQLite 也需要建表，但你不需要手工执行。Local/Docker 首次使用 `SQLiteVectorStore`
时会自动执行内置建表 SQL。Cloudflare D1 使用
`migrations/0001_article_workflow_state.sql`，通过 `deno task cf migrate`
应用到远端，或通过 `deno task cf migrate:local` 应用到本地 Wrangler dev 数据库。

### 7. 开启发布前质量门禁

```ts
features: {
  article: {
    qualityGate: {
      enabled: true,
      minScore: 80,
      blockOnHighFactIssue: true,
      forcePublish: false,
      allowForcePublish: true,
      maxRevisionRounds: 1,
    },
  },
},
```

质量门禁默认开启，并且只保护真实发布。`dryRun: true` 时仍会完整产出
HTML、文章计划和质量审稿 artifact，方便先观察质量；`dryRun: false`
时，如果审稿分低于 `minScore`、审稿建议不是 `publish`、存在 blocker
或高危事实问题，默认会写入 `blocked` 发布结果，不会创建微信草稿。 如果把
`forcePublish` 配成 `true`，真实发布即使质量不达标也会继续创建微信草稿， 只记录
warning 和质量审稿 artifact。 `maxRevisionRounds` 控制自动修复轮次，建议保持
`1`：只修 reviewer
指出的可安全自动修复问题，修完会复审一次，再决定最终发布结果。

### 8. 开启工作流通知

```ts
providers: {
  notify: {
    bark: { url: "https://api.day.app/your_key" },
    dingtalk: { webhook: "https://oapi.dingtalk.com/robot/send?access_token=..." },
    feishu: { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/..." },
  },
},
features: {
  article: {
    notifications: {
      channels: ["bark"],
    },
  },
},
```

通知是否启用只看 `features.article.notifications.channels`；`providers.notify.*`
只保存对应渠道的凭证。

### 9. 接入日志观测

项目里的日志仍然使用原来的 `new Logger("name").info/warn/error/debug` 写法。
配置 `observability` 后，这些日志会被额外镜像成结构化事件，可送到 stdout 或 HTTP
日志入口。原本的控制台输出不会改变。

```ts
observability: {
  enabled: true,
  serviceName: "trendpublish",
  environment: "production",
  stdout: {
    enabled: false,
    format: "json",
  },
  http: {
    enabled: true,
    endpoint: "https://logs.example.com/ingest",
    bearerToken: "your_log_token",
    headers: {},
    format: "object",
    timeoutMs: 5000,
  },
},
```

HTTP sink 是通用入口，适合接 Axiom、Better Stack、自建 OpenTelemetry Collector
或其他支持 HTTP ingest 的日志服务。`apiKey`、`token`、`secret`
等字段会做基础脱敏。

也可以直接用内置的平台便捷配置：

```ts
observability: {
  enabled: true,
  serviceName: "trendpublish",
  environment: "production",
  axiom: {
    enabled: true,
    dataset: "trendpublish",
    token: "your_axiom_api_token",
  },
  betterStack: {
    enabled: false,
    sourceToken: "your_better_stack_source_token",
    ingestingHost: "https://in.logs.betterstack.com",
  },
},
```

Axiom 需要先创建 dataset 和带 ingest 权限的 API token。Better Stack Logs
需要创建 HTTP source，使用 source token。workflow 内部日志会自动带上
`runId`、`step`、 `profileId` 等字段，方便按一次运行过滤。

## 模型配置

默认情况下，全项目只使用一套模型配置，内容排序、摘要、标题生成和动态模板都会走这组配置。

常见兼容 OpenAI Chat Completions 的供应商示例：

- OpenAI: `baseUrl: "https://api.openai.com/v1"`，`model: "gpt-4o-mini"`
- DeepSeek: `baseUrl: "https://api.deepseek.com/v1"`，`model: "deepseek-chat"`
- Qwen:
  `baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"`，`model: "qwen-max"`
- OrcaRouter: `baseUrl: "https://api.orcarouter.ai/v1"`，`model: "orcarouter/fusion-flash"`

## 提示词风格

`features.article.renderer.promptProfile`
控制同一条微信文章链路里的排序、摘要、标题、动态模板和 AI 配图口径。默认值是
`technology`，适合 AI 科技资讯。

可选值：

- `technology`: AI 科技趋势，关注模型、产品、开源、工程和科技商业动态。
- `general`: 通用资讯，适合更宽泛的信息简报。
- `business`: 商业与产业，关注公司战略、资本、市场和产业信号。
- `product`: 产品与体验，关注产品更新、用户价值、设计和工作流。
- `developer`: 开发者与工程，关注开源、API、架构、部署和工程实践。
- `research`: 学术与研究，关注论文、方法、实验、评测和模型能力。

示例：

```ts
features: {
  article: {
    renderer: {
      template: "dynamic",
      promptProfile: "business",
    },
  },
},
```

## 微信文章模板

`features.article.renderer.template` 可选值：

- `default`: 微信原生正式风
- `modern`: 蓝青科技资讯风
- `tech`: 工程技术专栏风
- `mianpro`: AI 日报风
- `longform`: 杂志长文风
- `product`: 更新日志风
- `minimal`: 极简阅读风
- `darktech`: 深色研究笔记风
- `dynamic`: AI 根据本次文章内容实时生成公众号内联 HTML，失败自动回退 `minimal`
- `random`: 每次随机选择一个模板

## 定时任务

服务启动后使用 heartbeat 调度：本地/Docker 和 Cloudflare 都会定期检查
`runtimeConfig` 中保存的 schedule，命中后才创建微信文章 workflow 运行实例。
默认初始化出的 schedule 是每天凌晨 3 点（`Asia/Shanghai`），后续可以在 Dashboard
修改，不需要重新部署。项目不再按星期切换其他工作流。

## 排查建议

- 每次改完 `trendpublish.config.ts` 后先跑 `deno task doctor`。
- 先跑 `deno task preview`，再跑 `deno task article --dry-run`，最后再正式发布。
- 新环境建议先关闭 `features.article.deduplication.enabled`
  和通知，跑通主链路后再逐项开启。
- 本地真实的 `trendpublish.config.ts` 已加入 `.gitignore`，不要提交真实密钥。
