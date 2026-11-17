import {
  ArticleFetchProvider,
  ArticleSource,
  ArticleSourceKind,
  parseArticleSources,
} from "@src/features/weixin-article/domain/article-source.ts";
import {
  FetchProviderId,
  fetchProviderRegistry,
  inferFetchProvider,
  isSearchFetchProvider,
} from "@src/integrations/fetch/fetch-provider-registry.ts";
import {
  FetchProviderName,
  ResolvedTrendPublishConfig,
} from "@src/utils/config/define-config.ts";

export function planArticleSources(
  config: Pick<
    ResolvedTrendPublishConfig,
    "features" | "fetchGroups" | "providers"
  >,
): ArticleSource[] {
  if (!config.fetchGroups.default) {
    throw new Error("未配置默认抓取分组: fetchGroups.default");
  }

  return parseArticleSources(config.features.article.sources).map((source) => {
    const groupProviders = config.fetchGroups[source.group];
    if (!groupProviders) {
      throw new Error(
        `数据源 ${source.raw} 引用了未定义的抓取分组: ${source.group}`,
      );
    }

    const providers = resolveSourceProviders(
      source.url,
      groupProviders,
      source.kind,
      source.group !== "default",
    );
    if (!providers.length) {
      throw new Error(`数据源 ${source.raw} 没有可用的显式抓取 provider`);
    }
    validateSourceProviders(source.url, source.kind, providers, config);

    return {
      ...source,
      providers,
    };
  });
}

export function resolveSourceProviders(
  sourceValue: string,
  groupProviders: FetchProviderName[],
  kind: ArticleSourceKind = "url",
  // Supplemental research shares this resolver; operator-only providers are
  // excluded unless the source planner explicitly opts in for a named group.
  operatorIntake = false,
): ArticleFetchProvider[] {
  if (groupProviders.length === 0) {
    throw new Error(`数据源 ${sourceValue} 的抓取分组未配置任何 provider`);
  }

  const providers = groupProviders.filter((provider) =>
    provider !== "parallel-search" || operatorIntake
  ).flatMap((provider) =>
    provider === "auto" ? [inferProvider(sourceValue, kind)] : [provider]
  );
  return [...new Set(providers)] as ArticleFetchProvider[];
}

export function inferProvider(
  sourceValue: string,
  kind: ArticleSourceKind = "url",
): ArticleFetchProvider {
  if (kind === "query") return "jina-search";
  return inferFetchProvider(sourceValue);
}

function validateSourceProviders(
  sourceValue: string,
  kind: ArticleSourceKind,
  providers: ArticleFetchProvider[],
  config: Pick<ResolvedTrendPublishConfig, "providers">,
): void {
  for (const provider of providers) {
    if (
      provider === "parallel-search" &&
      !config.providers.fetch.parallel?.publicReleaseQueries.includes(
        sourceValue,
      )
    ) {
      throw new Error(
        "Parallel 仅允许 providers.fetch.parallel.publicReleaseQueries 中操作员明确提供的公开软件发布文档查询",
      );
    }
    if (kind === "query" && !isSearchFetchProvider(provider)) {
      throw new Error(
        `搜索数据源 ${sourceValue} 只能使用搜索类 provider`,
      );
    }
    if (kind === "url" && isSearchFetchProvider(provider)) {
      throw new Error(
        `URL 数据源 ${sourceValue} 不能使用搜索类 provider`,
      );
    }
    const adapter = fetchProviderRegistry.get(provider as FetchProviderId);
    if (!adapter.isConfigured(config as ResolvedTrendPublishConfig)) {
      throw new Error(
        `数据源 ${sourceValue} 需要配置 ${
          getFetchProviderConfigHint(provider)
        }`,
      );
    }
  }
}

function getFetchProviderConfigHint(provider: ArticleFetchProvider): string {
  switch (provider) {
    case "firecrawl":
      return "providers.fetch.firecrawl.apiKey";
    case "jina":
    case "jina-search":
      return "providers.fetch.jina.apiKey";
    case "brave-search":
      return "providers.fetch.brave.apiKey";
    case "tavily-search":
      return "providers.fetch.tavily.apiKey";
    case "exa-search":
      return "providers.fetch.exa.apiKey";
    case "serper-search":
      return "providers.fetch.serper.apiKey";
    case "newsapi":
      return "providers.fetch.newsapi.apiKey";
    case "gdelt":
    case "hackernews":
    case "arxiv":
      return "无需 API Key";
    case "twitter":
      return "providers.fetch.twitter.bearerToken 或 providers.fetch.twitter.xquikApiKey";
    case "rss":
      return "providers.fetch.rss.baseUrl";
    default:
      return `providers.fetch.${provider}`;
  }
}
