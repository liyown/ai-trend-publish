import { z } from "zod";
import { defineConnector, type ConnectorCreateContext } from "../definition.ts";
import type { HttpRequest } from "../http.ts";
import type {
  CallContext,
  ConnectorOperation,
  SourceCandidate,
  SourceDocument,
  SourceFetchClient,
  SourceSearchClient,
  SourceSearchInput,
} from "../types.ts";

const empty = z.object({});
const apiKey = z.object({ apiKey: z.string().min(1) });
const optionalApiKey = z.object({ apiKey: z.string().min(1).optional() });
const bearer = z.object({ bearerToken: z.string().min(1) });
type Empty = z.infer<typeof empty>;
type ApiKey = z.infer<typeof apiKey>;
type OptionalApiKey = z.infer<typeof optionalApiKey>;
type Bearer = z.infer<typeof bearer>;

type ProviderId =
  | "auto"
  | "firecrawl"
  | "jina"
  | "jina-search"
  | "brave-search"
  | "tavily-search"
  | "exa-search"
  | "serper-search"
  | "newsapi"
  | "twitter"
  | "rss"
  | "gdelt"
  | "hackernews"
  | "arxiv";

interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  credential: "none" | "apiKey" | "optionalApiKey" | "bearerToken";
}

const urlProviders = new Set<ProviderId>(["auto", "firecrawl", "jina", "rss"]);

const providers: ProviderDefinition[] = [
  { id: "auto", name: "自动网页", description: "直接读取公开网页。", credential: "none" },
  { id: "firecrawl", name: "Firecrawl", description: "网页正文提取与清洗。", credential: "apiKey" },
  {
    id: "jina",
    name: "Jina Reader",
    description: "将网页转换为可读正文；API Key 仅用于提高限额。",
    credential: "optionalApiKey",
  },
  { id: "jina-search", name: "Jina Search", description: "Jina 搜索结果。", credential: "apiKey" },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Brave 网页搜索。",
    credential: "apiKey",
  },
  {
    id: "tavily-search",
    name: "Tavily",
    description: "面向研究任务的网页搜索。",
    credential: "apiKey",
  },
  { id: "exa-search", name: "Exa", description: "语义搜索与正文摘要。", credential: "apiKey" },
  {
    id: "serper-search",
    name: "Serper",
    description: "Google 搜索结果接口。",
    credential: "apiKey",
  },
  { id: "newsapi", name: "NewsAPI", description: "新闻搜索与时间排序。", credential: "apiKey" },
  { id: "twitter", name: "X / Twitter", description: "社交趋势搜索。", credential: "bearerToken" },
  { id: "rss", name: "RSS", description: "RSS 与 Atom 订阅。", credential: "none" },
  { id: "gdelt", name: "GDELT", description: "全球新闻事件搜索。", credential: "none" },
  { id: "hackernews", name: "Hacker News", description: "技术社区趋势。", credential: "none" },
  { id: "arxiv", name: "arXiv", description: "论文与研究动态。", credential: "none" },
];

export const sourceConnectors = providers.map((provider) =>
  defineConnector({
    id: provider.id,
    version: 1,
    displayName: provider.name,
    description: provider.description,
    capabilities: [urlProviders.has(provider.id) ? "source-fetch" : "source-search"],
    settingsSchema: empty,
    credentialsSchema:
      provider.credential === "apiKey"
        ? apiKey
        : provider.credential === "optionalApiKey"
          ? optionalApiKey
          : provider.credential === "bearerToken"
            ? bearer
            : empty,
    fields:
      provider.credential === "none"
        ? []
        : [
            {
              key: provider.credential === "bearerToken" ? "bearerToken" : "apiKey",
              location: "credentials" as const,
              label: provider.credential === "bearerToken" ? "Bearer Token" : "API Key",
              input: "password" as const,
              required: provider.credential !== "optionalApiKey",
              description:
                provider.credential === "optionalApiKey"
                  ? "可选；填写后可获得更高请求限额。"
                  : undefined,
            },
          ],
    requestOverrides: false,
    create(context) {
      const client = new BuiltInSourceClient(provider.id, context as SourceContext);
      return urlProviders.has(provider.id)
        ? { "source-fetch": client }
        : { "source-search": client };
    },
    async check(context, signal) {
      const client = new BuiltInSourceClient(provider.id, context as SourceContext);
      const result = urlProviders.has(provider.id)
        ? await client.fetch("https://example.com", { signal })
        : await client.search({ query: "OpenAI", limit: 1 }, { signal });
      return `测试成功，返回 ${result.length} 条结果`;
    },
  }),
);

type SourceContext = ConnectorCreateContext<Empty, Empty | ApiKey | OptionalApiKey | Bearer>;

const searchOperation = { name: "source.search", capability: "source-search" } as const;
const fetchOperation = { name: "source.fetch", capability: "source-fetch" } as const;

class BuiltInSourceClient implements SourceSearchClient, SourceFetchClient {
  constructor(
    private readonly provider: ProviderId,
    private readonly context: SourceContext,
  ) {}

  async search(input: SourceSearchInput, call: CallContext = {}): Promise<SourceCandidate[]> {
    if (urlProviders.has(this.provider)) throw new Error(`来源连接 ${this.provider} 不支持搜索`);
    const raw = await this.request(input.query, searchOperation, input.limit, call.signal);
    return normalizeCandidates(this.provider, input.query, raw).slice(0, input.limit ?? 10);
  }

  async fetch(url: string, call: CallContext = {}): Promise<SourceDocument[]> {
    if (!urlProviders.has(this.provider)) {
      throw new Error(`来源连接 ${this.provider} 不支持网页抓取`);
    }
    const raw = await this.request(url, fetchOperation, undefined, call.signal);
    return normalizeFetchedDocuments(this.provider, url, raw);
  }

  private async request(
    value: string,
    operation: ConnectorOperation,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const credentials = this.context.credentials as Record<string, string>;
    value = value.trim();
    if (this.provider === "auto" || this.provider === "rss") {
      return await executeText(this.context, operation, { url: value }, signal);
    }
    if (this.provider === "jina") {
      return await executeText(
        this.context,
        operation,
        { url: `https://r.jina.ai/${value}`, headers: bearerHeader(credentials.apiKey) },
        signal,
      );
    }
    if (this.provider === "jina-search") {
      return await executeText(
        this.context,
        operation,
        {
          url: `https://s.jina.ai/?q=${encodeURIComponent(value)}`,
          headers: bearerHeader(credentials.apiKey),
        },
        signal,
      );
    }
    if (this.provider === "firecrawl") {
      return await executeJson(
        this.context,
        operation,
        {
          url: "https://api.firecrawl.dev/v1/scrape",
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: value, formats: ["markdown"] }),
        },
        signal,
      );
    }
    if (this.provider === "brave-search") {
      return await executeJson(
        this.context,
        operation,
        {
          url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(value)}&count=${limit ?? 10}`,
          headers: { "X-Subscription-Token": credentials.apiKey, Accept: "application/json" },
        },
        signal,
      );
    }
    if (this.provider === "tavily-search") {
      return await executeJson(
        this.context,
        operation,
        {
          url: "https://api.tavily.com/search",
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: value, max_results: limit ?? 10 }),
        },
        signal,
      );
    }
    if (this.provider === "exa-search") {
      return await executeJson(
        this.context,
        operation,
        {
          url: "https://api.exa.ai/search",
          method: "POST",
          headers: { "x-api-key": credentials.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ query: value, numResults: limit ?? 10 }),
        },
        signal,
      );
    }
    if (this.provider === "serper-search") {
      return await executeJson(
        this.context,
        operation,
        {
          url: "https://google.serper.dev/search",
          method: "POST",
          headers: { "X-API-KEY": credentials.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: value, num: limit ?? 10 }),
        },
        signal,
      );
    }
    if (this.provider === "newsapi") {
      return await executeJson(
        this.context,
        operation,
        {
          url: `https://newsapi.org/v2/everything?q=${encodeURIComponent(value)}&pageSize=${limit ?? 10}&sortBy=publishedAt`,
          headers: { "X-Api-Key": credentials.apiKey },
        },
        signal,
      );
    }
    if (this.provider === "twitter") {
      return await executeJson(
        this.context,
        operation,
        {
          url: `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(value)}&max_results=${Math.max(10, limit ?? 10)}`,
          headers: { Authorization: `Bearer ${credentials.bearerToken}` },
        },
        signal,
      );
    }
    if (this.provider === "gdelt") {
      return await executeJson(
        this.context,
        operation,
        {
          url: `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(value)}&mode=artlist&format=json&sort=datedesc&maxrecords=${limit ?? 10}`,
        },
        signal,
      );
    }
    if (this.provider === "hackernews") {
      return await executeJson(
        this.context,
        operation,
        {
          url: `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(value)}&tags=story&hitsPerPage=${limit ?? 10}`,
        },
        signal,
      );
    }
    return await executeText(
      this.context,
      operation,
      {
        url: `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(value)}&max_results=${limit ?? 10}&sortBy=submittedDate&sortOrder=descending`,
      },
      signal,
    );
  }
}

function normalizeFetchedDocuments(
  provider: ProviderId,
  url: string,
  raw: unknown,
): SourceDocument[] {
  if (typeof raw === "string") {
    return [
      {
        id: `${provider}-${crypto.randomUUID()}`,
        title: url,
        url,
        content: raw,
        sourceName: provider,
      },
    ];
  }
  const data = raw as Record<string, any>;
  const firecrawl = data.data?.markdown
    ? [{ title: data.data.metadata?.title, url, content: data.data.markdown }]
    : [];
  return firecrawl.map((item: Record<string, any>, index: number) => ({
    id: `${provider}-${index}-${crypto.randomUUID()}`,
    title: String(item.title ?? url),
    url: item.url ?? url,
    content: String(item.content ?? ""),
    sourceName: provider,
  }));
}

function normalizeCandidates(provider: ProviderId, query: string, raw: unknown): SourceCandidate[] {
  if (typeof raw === "string") {
    if (provider === "arxiv") return atomCandidates(raw, provider);
    return markdownCandidates(raw, provider);
  }
  const data = raw as Record<string, any>;
  const rows =
    data.results ??
    data.web?.results ??
    data.organic ??
    data.articles ??
    data.hits ??
    data.data ??
    [];
  return (Array.isArray(rows) ? rows : [])
    .map((item: Record<string, any>, index: number): SourceCandidate | undefined => {
      const url =
        item.url ??
        item.link ??
        item.story_url ??
        (provider === "twitter" && item.id ? `https://x.com/i/status/${item.id}` : undefined);
      if (typeof url !== "string" || !url.trim()) return undefined;
      const snippet = String(
        item.content ?? item.description ?? item.snippet ?? item.text ?? item.summary ?? "",
      ).trim();
      return {
        id: `${provider}-${index}-${crypto.randomUUID()}`,
        title: String(item.title ?? item.story_title ?? item.text ?? query),
        url: url.trim(),
        ...(snippet ? { snippet } : {}),
        publishedAt: item.publishedAt ?? item.published_date ?? item.created_at ?? item.seendate,
        sourceName: provider,
      };
    })
    .filter((item): item is SourceCandidate => Boolean(item));
}

async function executeJson(
  context: SourceContext,
  operation: ConnectorOperation,
  request: HttpRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  return (await context.execute(operation, request, { signal })).json();
}

async function executeText(
  context: SourceContext,
  operation: ConnectorOperation,
  request: HttpRequest,
  signal?: AbortSignal,
): Promise<string> {
  return (await context.execute(operation, request, { signal })).text();
}

function bearerHeader(value?: string): Record<string, string> | undefined {
  return value ? { Authorization: `Bearer ${value}` } : undefined;
}

function atomCandidates(xml: string, provider: string): SourceCandidate[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match, index) => {
      const entry = match[1];
      const text = (tag: string) =>
        decode(entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "");
      return {
        id: `${provider}-${index}-${crypto.randomUUID()}`,
        title: text("title"),
        snippet: text("summary"),
        url: entry.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? "",
        publishedAt: text("published"),
        sourceName: provider,
      };
    })
    .filter((candidate) => Boolean(candidate.url));
}

function markdownCandidates(markdown: string, provider: string): SourceCandidate[] {
  const seen = new Set<string>();
  const candidates: SourceCandidate[] = [];
  for (const [index, match] of [
    ...markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g),
  ].entries()) {
    const url = match[2]?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push({
      id: `${provider}-${index}-${crypto.randomUUID()}`,
      title: match[1]?.trim() || url,
      url,
      sourceName: provider,
    });
  }
  return candidates;
}

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
