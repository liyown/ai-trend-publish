# 数据获取 API

TrendPublish 的数据获取分成两类：

- URL 抓取：用户已经给出明确网页、RSS、X/Twitter 地址，系统负责读取正文。
- 关键词发现：用户给出
  `search:关键词`，系统通过搜索、新闻、社区、论文源找到候选内容。

数据获取 API 都通过 `fetchGroups` 路由。分组内 provider 按顺序
fallback，先返回有效内容的 provider 会被采用。

## 免费或无需 Key 的来源

- GDELT：全球新闻线索，无需 API Key。适合补充媒体报道和事件背景。Provider
  名称：`gdelt`。
- Hacker News：技术社区线索，无需 API Key。适合
  AI、开发者工具、开源项目热度判断。Provider 名称：`hackernews`。
- arXiv：论文和研究线索，无需 API Key。适合模型、算法、评测和研究趋势。Provider
  名称：`arxiv`。
- RSS / RSSHub：明确订阅源抓取，无需商业 API Key。Provider 名称：`rss`。

推荐免费搜索分组：

```ts
fetchGroups: {
  search: ["gdelt", "hackernews", "arxiv"],
}
```

## 低成本或强能力来源

- Brave Search：独立搜索索引，成本低，适合作为通用 web search 第一层。Provider
  名称：`brave-search`，配置 `providers.fetch.brave.apiKey`。
- Jina Search / Reader：搜索和网页正文读取都比较适合 AI 工作流。Provider
  名称：`jina-search`、`jina`，配置 `providers.fetch.jina.apiKey`。
- Tavily：面向 AI Agent 的搜索 API，适合补充研究和 EvidencePack。Provider
  名称：`tavily-search`，配置 `providers.fetch.tavily.apiKey`。
- Exa：语义搜索能力强，适合研究型选题和相似内容发现。Provider
  名称：`exa-search`，配置 `providers.fetch.exa.apiKey`。
- Serper：Google SERP 风格结果，适合需要 Google 覆盖时使用。Provider
  名称：`serper-search`，配置 `providers.fetch.serper.apiKey`。
- NewsAPI：新闻搜索源，适合新闻候选补充。Provider 名称：`newsapi`，配置
  `providers.fetch.newsapi.apiKey`。

推荐增强搜索分组：

```ts
fetchGroups: {
  search: [
    "brave-search",
    "jina-search",
    "tavily-search",
    "exa-search",
    "serper-search",
    "gdelt",
    "hackernews",
    "arxiv",
  ],
}
```

只把已经配置好 key 的付费 provider 放进分组。否则 doctor 会提示缺少对应凭证。

## 显式公开软件发布查询（Parallel）

`parallel-search` 使用 Unified MCP 的 `web_search`，将搜索结果中的原始 URL、
标题和摘录交给现有文章流程。不需要 API Key；服务可用性和限制见
[Parallel MCP setup](https://docs.parallel.ai/integrations/mcp/quickstart)。

只有操作员明确授权的**公开软件发布文档查询**可用。先在部署配置中填写
`providers.fetch.parallel.publicReleaseQueries`，再通过命名抓取分组选择：

```ts
providers: {
  fetch: {
    parallel: {
      publicReleaseQueries: ["Deno 2.7 release documentation"],
    },
  },
},
fetchGroups: {
  default: ["auto"],
  releases: ["parallel-search"],
},
features: {
  article: {
    dryRun: true,
    sources: ["releases:query:Deno 2.7 release documentation"],
    sourceLimits: { maxAgeDays: 365, maxItemsPerSource: 5 },
  },
},
```

查询必须与授权列表中的字符串完全匹配。只授权公开发布信息；不要填写私有上下文、
账号信息或内部资料。请求仅将该字符串作为 `objective` 和单个 `search_queries`
发送，不附加文章、模型生成的查询或账号上下文。连接地址为
`https://mcp.parallel.ai/mcp?tools=web_search`，不会调用 `web_fetch`，也不会深抓
Parallel 结果页或从摘录扩展文章链接。

授权列表默认为空。`auto`、`default` 分组和补充研究不会选择 Parallel，即使
`fetchGroups.search` 或自定义配置包含它；其他 provider 的 fallback
顺序保持不变。 空结果、服务错误和 30
秒超时通过现有数据源失败记录返回，可继续尝试同组其他 provider。

用独立配置和独立 SQLite/产物目录运行本地检查，避免复用 Dashboard
中已有的数据源。 完整 dry-run 需要配置 LLM；可将 LLM
指向本地兼容服务，并关闭配图、通知和向量去重。

```bash
# 先检查数据源；不进入模型或发布链路
deno task article --config /tmp/trendpublish-parallel.ts --sources-only --source parallel-search

# 官方 dry-run：不上传、不发布
deno task article --config /tmp/trendpublish-parallel.ts --dry-run --source parallel-search --dry-run-output src/temp/parallel-output
```

完整 dry-run 的 `02-scraped-contents`、`07-processed-contents` 和 template-data
JSON 产物保留结果原始 URL，HTML 在同次运行的 `dry-run-preview` 产物中。
页面链接是否出现在正文中仍由现有模板和正文生成决定；请同时检查 JSON 来源字段。

## URL 抓取来源

- FireCrawl：普通网页正文抓取。Provider 名称：`firecrawl`。
- Jina Reader：普通网页正文读取和正文深抓 fallback。Provider 名称：`jina`。
- Twitter/X：X/Twitter 数据源。Provider 名称：`twitter`。
- RSS / RSSHub：RSS 源。Provider 名称：`rss`。

推荐网页抓取分组：

```ts
fetchGroups: {
  web: ["firecrawl", "jina"],
  social: ["twitter"],
  rss: ["rss"],
}
```

## 官方入口

- Brave Search API: <https://brave.com/search/api/>
- Jina Reader/Search: <https://jina.ai/reader/>
- Tavily API: <https://docs.tavily.com/>
- Exa API: <https://docs.exa.ai/>
- Serper API: <https://serper.dev/>
- NewsAPI: <https://newsapi.org/>
- GDELT DOC API: <https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/>
- Hacker News Search API: <https://hn.algolia.com/api>
- arXiv API: <https://info.arxiv.org/help/api/>
