import {
  FetchProviderId,
  fetchProviderRegistry,
} from "@src/integrations/fetch/fetch-provider-registry.ts";
import { scraperRegistry } from "@src/integrations/fetch/scraper-registry.ts";
import {
  ContentScraper,
  ScrapedContent,
} from "@src/core/ports/content-scraper.ts";
import {
  ArticleSource,
} from "@src/features/weixin-article/domain/article-source.ts";
import type { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import type {
  ArticleContentFetcher,
  ArticleContentFetchFailure,
  ArticleContentFetchResult,
  ArticleContentHydrationResult,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { planArticleSources } from "./article-fetch-planner.ts";

type ArticleFetchProvider = FetchProviderId;

export class ArticleFetchRouter implements ArticleContentFetcher {
  private readonly config?: ResolvedTrendPublishConfig;
  private readonly scrapers: Map<ArticleFetchProvider, ContentScraper>;

  constructor(
    configOrScrapers?:
      | ResolvedTrendPublishConfig
      | Map<ArticleFetchProvider, ContentScraper>,
    scrapers = new Map<ArticleFetchProvider, ContentScraper>(),
  ) {
    if (configOrScrapers instanceof Map) {
      this.config = undefined;
      this.scrapers = configOrScrapers;
      return;
    }
    this.config = configOrScrapers;
    this.scrapers = scrapers;
  }

  async scrape(
    source: ArticleSource,
    onAttemptFailure?: (
      failure: ArticleContentFetchFailure,
    ) => Promise<void> | void,
  ): Promise<ArticleContentFetchResult> {
    const failures: ArticleContentFetchFailure[] = [];

    for (const provider of source.providers as ArticleFetchProvider[]) {
      try {
        if (provider === "parallel-search") {
          const authorized = this.config && source.kind === "query" &&
            source.group !== "default" &&
            planArticleSources(this.config).some((planned) =>
              planned.raw === source.raw && planned.url === source.url &&
              planned.group === source.group &&
              planned.providers.includes(provider)
            );
          if (!authorized) {
            throw new Error(
              "Parallel 仅允许显式配置的操作员公开软件发布文档查询",
            );
          }
        }
        const contents = await this.getScraper(provider).scrape(source.url);
        if (contents.length > 0) {
          return {
            contents,
            provider,
            failures,
          };
        }

        const failure = {
          provider,
          message: "抓取成功但未返回内容",
        };
        failures.push(failure);
        await onAttemptFailure?.(failure);
      } catch (error) {
        const failure = {
          provider,
          message: error instanceof Error ? error.message : String(error),
        };
        failures.push(failure);
        await onAttemptFailure?.(failure);
      }
    }

    return { contents: [], failures };
  }

  async hydrate(
    content: ScrapedContent,
    onAttemptFailure?: (
      failure: ArticleContentFetchFailure,
    ) => Promise<void> | void,
  ): Promise<ArticleContentHydrationResult> {
    const originalContentLength = content.content.length;
    const failures: ArticleContentFetchFailure[] = [];

    // Parallel intake uses search excerpts only; never fetch result pages.
    if (content.metadata.provider === "parallel-search") {
      return {
        content,
        hydrated: false,
        failures,
        originalContentLength,
        hydratedContentLength: originalContentLength,
      };
    }

    if (!isHttpUrl(content.url)) {
      return {
        content,
        hydrated: false,
        failures: [{
          provider: "hydrate",
          message: `跳过非 HTTP URL: ${content.url}`,
        }],
        originalContentLength,
        hydratedContentLength: originalContentLength,
      };
    }

    for (const provider of this.getHydrationProviders()) {
      try {
        const candidates = await this.getScraper(provider).scrape(content.url, {
          limit: 1,
          filters: {
            mode: "article-detail",
            originalId: content.id,
          },
        });
        const best = pickBestHydrationCandidate(candidates);
        if (best && isMeaningfullyRicher(best, content)) {
          const hydrated = mergeHydratedContent(content, best, provider);
          return {
            content: hydrated,
            hydrated: true,
            provider,
            failures,
            originalContentLength,
            hydratedContentLength: hydrated.content.length,
          };
        }

        const failure = {
          provider,
          message: "正文深抓内容未明显优于原始摘要",
        };
        failures.push(failure);
        await onAttemptFailure?.(failure);
      } catch (error) {
        const failure = {
          provider,
          message: error instanceof Error ? error.message : String(error),
        };
        failures.push(failure);
        await onAttemptFailure?.(failure);
      }
    }

    return {
      content,
      hydrated: false,
      failures,
      originalContentLength,
      hydratedContentLength: originalContentLength,
    };
  }

  private getScraper(provider: ArticleFetchProvider): ContentScraper {
    const existing = this.scrapers.get(provider);
    if (existing) {
      return existing;
    }

    const scraper = scraperRegistry.get(
      fetchProviderRegistry.get(provider).scraperType,
    ).create({ config: this.config });
    this.scrapers.set(provider, scraper);
    return scraper;
  }

  private getHydrationProviders(): ArticleFetchProvider[] {
    const preferred: ArticleFetchProvider[] = ["jina", "firecrawl"];
    if (!this.config) {
      return preferred.filter((provider) => this.scrapers.has(provider));
    }

    return preferred.filter((provider) =>
      fetchProviderRegistry.get(provider).isConfigured(this.config!)
    );
  }
}

function pickBestHydrationCandidate(
  candidates: ScrapedContent[],
): ScrapedContent | undefined {
  return candidates
    .filter((candidate) => candidate.content.trim().length > 0)
    .toSorted((left, right) => right.content.length - left.content.length)[0];
}

function isMeaningfullyRicher(
  candidate: ScrapedContent,
  original: ScrapedContent,
): boolean {
  const candidateLength = candidate.content.trim().length;
  const originalLength = original.content.trim().length;
  if (candidateLength < 300) return false;
  return candidateLength >=
    Math.max(originalLength * 1.5, originalLength + 200);
}

function mergeHydratedContent(
  original: ScrapedContent,
  hydrated: ScrapedContent,
  provider: ArticleFetchProvider,
): ScrapedContent {
  return {
    ...original,
    title: hydrated.title?.trim() || original.title,
    content: hydrated.content,
    url: hydrated.url || original.url,
    publishDate: hydrated.publishDate || original.publishDate,
    media: mergeMedia(original, hydrated),
    metadata: {
      ...original.metadata,
      hydrated: true,
      hydrationProvider: provider,
      hydrationOriginalContentLength: original.content.length,
      hydrationContentLength: hydrated.content.length,
      hydrationUrl: hydrated.url || original.url,
    },
  };
}

function mergeMedia(
  original: ScrapedContent,
  hydrated: ScrapedContent,
): ScrapedContent["media"] {
  const media = [...(original.media ?? []), ...(hydrated.media ?? [])];
  const seen = new Set<string>();
  return media.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
