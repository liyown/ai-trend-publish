import {
  ProviderAdapter,
  ProviderCreateContext,
  ProviderRegistry,
} from "@src/registry/provider-registry.ts";
import { ArxivSearchScraper } from "@src/integrations/fetch/providers/arxiv-search-scraper.ts";
import { BraveSearchScraper } from "@src/integrations/fetch/providers/brave-search-scraper.ts";
import { ExaSearchScraper } from "@src/integrations/fetch/providers/exa-search-scraper.ts";
import { ContentScraper } from "@src/core/ports/content-scraper.ts";
import { FireCrawlScraper } from "@src/integrations/fetch/providers/firecrawl-scraper.ts";
import { GdeltScraper } from "@src/integrations/fetch/providers/gdelt-scraper.ts";
import { HackerNewsSearchScraper } from "@src/integrations/fetch/providers/hackernews-search-scraper.ts";
import { JinaDeepSearchScraper } from "@src/integrations/fetch/providers/jina/jina-deepsearch-scraper.ts";
import { JinaScraper } from "@src/integrations/fetch/providers/jina/jina-reader-scraper.ts";
import { JinaSearchScraper } from "@src/integrations/fetch/providers/jina/jina-search-scraper.ts";
import { NewsApiScraper } from "@src/integrations/fetch/providers/newsapi-scraper.ts";
import { ParallelSearchScraper } from "@src/integrations/fetch/providers/parallel-search-scraper.ts";
import { RsshubScraper } from "@src/integrations/fetch/providers/rsshub-scraper.ts";
import { ScraperType } from "@src/integrations/fetch/scraper-type.ts";
import { SerperSearchScraper } from "@src/integrations/fetch/providers/serper-search-scraper.ts";
import { TavilySearchScraper } from "@src/integrations/fetch/providers/tavily-search-scraper.ts";
import { TwitterScraper } from "@src/integrations/fetch/providers/twitter-scraper.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";

export interface ScraperAdapter
  extends ProviderAdapter<ResolvedTrendPublishConfig, ScraperType> {
  kind: "fetch";
  create(
    context?: ProviderCreateContext<ResolvedTrendPublishConfig>,
  ): ContentScraper;
}

export const scraperRegistry = new ProviderRegistry<
  ResolvedTrendPublishConfig,
  ScraperAdapter
>();

scraperRegistry.register({
  id: ScraperType.JINA_READER,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.jina.apiKey),
  create: (context) =>
    new JinaScraper(context?.config?.providers.fetch.jina.apiKey),
});

scraperRegistry.register({
  id: ScraperType.JINA_SEARCH,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.jina.apiKey),
  create: (context) =>
    new JinaSearchScraper(context?.config?.providers.fetch.jina.apiKey),
});

scraperRegistry.register({
  id: ScraperType.JINA_DEEPSEARCH,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.jina.apiKey),
  create: (context) =>
    new JinaDeepSearchScraper(context?.config?.providers.fetch.jina.apiKey),
});

scraperRegistry.register({
  id: ScraperType.PARALLEL_SEARCH,
  kind: "fetch",
  isConfigured: (config) =>
    Boolean(config.providers.fetch.parallel?.publicReleaseQueries.length),
  create: (context) =>
    new ParallelSearchScraper(
      context?.config?.providers.fetch.parallel?.publicReleaseQueries,
    ),
});

scraperRegistry.register({
  id: ScraperType.BRAVE_SEARCH,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.brave.apiKey),
  create: (context) =>
    new BraveSearchScraper(context?.config?.providers.fetch.brave.apiKey),
});

scraperRegistry.register({
  id: ScraperType.TAVILY_SEARCH,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.tavily.apiKey),
  create: (context) =>
    new TavilySearchScraper(context?.config?.providers.fetch.tavily.apiKey),
});

scraperRegistry.register({
  id: ScraperType.EXA_SEARCH,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.exa.apiKey),
  create: (context) =>
    new ExaSearchScraper(context?.config?.providers.fetch.exa.apiKey),
});

scraperRegistry.register({
  id: ScraperType.SERPER_SEARCH,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.serper.apiKey),
  create: (context) =>
    new SerperSearchScraper(context?.config?.providers.fetch.serper.apiKey),
});

scraperRegistry.register({
  id: ScraperType.NEWSAPI,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.newsapi.apiKey),
  create: (context) =>
    new NewsApiScraper(context?.config?.providers.fetch.newsapi.apiKey),
});

scraperRegistry.register({
  id: ScraperType.GDELT,
  kind: "fetch",
  isConfigured: () => true,
  create: () => new GdeltScraper(),
});

scraperRegistry.register({
  id: ScraperType.HACKERNEWS,
  kind: "fetch",
  isConfigured: () => true,
  create: () => new HackerNewsSearchScraper(),
});

scraperRegistry.register({
  id: ScraperType.ARXIV,
  kind: "fetch",
  isConfigured: () => true,
  create: () => new ArxivSearchScraper(),
});

scraperRegistry.register({
  id: ScraperType.FIRECRAWL,
  kind: "fetch",
  isConfigured: (config) => Boolean(config.providers.fetch.firecrawl.apiKey),
  create: (context) =>
    new FireCrawlScraper(context?.config?.providers.fetch.firecrawl.apiKey),
});

scraperRegistry.register({
  id: ScraperType.RSSHUB,
  kind: "fetch",
  isConfigured: () => true,
  create: () => new RsshubScraper(),
});

scraperRegistry.register({
  id: ScraperType.TWITTER,
  kind: "fetch",
  isConfigured: (config) =>
    Boolean(
      config.providers.fetch.twitter.xquikApiKey ||
        config.providers.fetch.twitter.bearerToken,
    ),
  create: (context) =>
    new TwitterScraper(context?.config?.providers.fetch.twitter),
});
