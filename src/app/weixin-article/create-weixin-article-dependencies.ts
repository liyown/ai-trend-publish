import { ContentRanker } from "@src/modules/content-rank/ai.content-ranker.ts";
import { AISummarizer } from "@src/modules/summarizer/ai.summarizer.ts";
import { WeixinPublisher } from "@src/integrations/publish/providers/weixin-publisher.ts";
import { WeixinRelayPublisher } from "@src/integrations/publish/providers/weixin-relay-publisher.ts";
import { WeixinArticleTemplateRenderer } from "@src/features/weixin-article/rendering/article.renderer.ts";
import { WeixinDynamicHtmlGenerator } from "@src/features/weixin-article/rendering/dynamic/dynamic-html.generator.ts";
import {
  isMiniMaxH3ImageModel,
  MINIMAX_H3_TIMEOUT_MS,
} from "@src/integrations/image/providers/minimax/minimax-image-generator.ts";
import { ImageGeneratorResolver } from "@src/integrations/image/image-generator-resolver.ts";
import { LlmProviderResolver } from "@src/integrations/llm/llm-provider-resolver.ts";
import { EmbeddingProviderResolver } from "@src/integrations/vector/embedding-provider-resolver.ts";
import { EmbeddingProviderType } from "@src/core/ports/embedding.ts";
import { ImageGeneratorType } from "@src/core/ports/image-generator.ts";
import {
  planArticleSources,
  resolveSourceProviders,
} from "@src/app/weixin-article/fetch/article-fetch-planner.ts";
import { ArticleFetchRouter } from "@src/app/weixin-article/fetch/article-fetch-router.ts";
import { createArticleNotifier } from "@src/app/weixin-article/notifications.ts";
import {
  FetchProviderId,
  fetchProviderRegistry,
  isSearchFetchProvider,
} from "@src/integrations/fetch/fetch-provider-registry.ts";
import type {
  WeixinArticleDependencies,
  WeixinArticlePublisher,
} from "@src/features/weixin-article/dependencies.ts";
import {
  AiArticleImageLayoutService,
  WeixinArticleImageLayoutService,
} from "@src/features/weixin-article/services/article-image-layout.service.ts";
import { WeixinArticleContentDedupService } from "@src/features/weixin-article/services/content-dedup.service.ts";
import { WeixinArticleContentProcessService } from "@src/features/weixin-article/services/content-process.service.ts";
import { WeixinArticleContentScrapeService } from "@src/features/weixin-article/services/content-scrape.service.ts";
import { WeixinArticleCoverService } from "@src/features/weixin-article/services/article-cover.service.ts";
import { WeixinArticleDryRunOutputService } from "@src/features/weixin-article/services/dry-run-output.service.ts";
import { WeixinArticleRenderService } from "@src/features/weixin-article/services/article-render.service.ts";
import { WeixinArticleTitleService } from "@src/features/weixin-article/services/article-title.service.ts";
import { WeixinArticleEditorialTopicService } from "@src/features/weixin-article/services/editorial-topic.service.ts";
import { WeixinArticleEditorialDecisionService } from "@src/features/weixin-article/services/editorial-decision.service.ts";
import { WeixinArticlePlanService } from "@src/features/weixin-article/services/article-plan.service.ts";
import { WeixinArticleDraftService } from "@src/features/weixin-article/services/article-draft.service.ts";
import { WeixinArticleResearchService } from "@src/features/weixin-article/services/article-research.service.ts";
import { WeixinArticleQualityReviewService } from "@src/features/weixin-article/services/quality-review.service.ts";
import { WeixinArticleRevisionService } from "@src/features/weixin-article/services/article-revision.service.ts";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import type { ArtifactStore } from "@src/core/ports/artifact-store.ts";
import type {
  RunStateStore,
  RuntimeMode,
} from "@src/core/ports/run-state-store.ts";
import { MemoryArtifactStore } from "@src/core/storage/memory-artifact-store.ts";
import { MemoryRunStateStore } from "@src/core/storage/memory-run-state-store.ts";
import type { VectorStore } from "@src/core/ports/vector-store.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import {
  type EditorialMemoryStore,
  NoopEditorialMemoryStore,
} from "@src/core/ports/editorial-memory-store.ts";

export interface CreateWeixinArticleDependenciesOptions {
  artifactStore?: ArtifactStore;
  runStateStore?: RunStateStore;
  mode?: RuntimeMode;
  vectorStoreFactory?: () => Promise<VectorStore>;
  editorialMemoryStore?: EditorialMemoryStore;
  profileId?: string;
  accountId?: string;
  accountBrand?: JsonObject;
  runtimeConfigSnapshot?: JsonObject;
}

export async function createWeixinArticleDependencies(
  config: ResolvedTrendPublishConfig,
  options: CreateWeixinArticleDependenciesOptions = {},
): Promise<WeixinArticleDependencies> {
  const stats = {
    success: 0,
    failed: 0,
    contents: 0,
    duplicates: 0,
  };
  const effectiveAccountId = options.accountId ??
    config.features.article.publisher.accountId;
  const publisher = createPublisher(config, effectiveAccountId);
  const notifier = createArticleNotifier(config);
  const llmResolver = new LlmProviderResolver(config);
  const llmProvider = await llmResolver.getDefaultProvider();
  const imageGeneratorResolver = new ImageGeneratorResolver(config);
  const embeddingResolver = new EmbeddingProviderResolver(config);
  const cover = config.features.article.cover;
  const bodyImages = config.features.article.bodyImages;
  const deduplication = config.features.article.deduplication;
  const renderer = config.features.article.renderer;
  const promptProfile = renderer.promptProfile;
  const accountBrand = options.accountBrand;
  const artifactStore = options.artifactStore ?? new MemoryArtifactStore();
  const runStateStore = options.runStateStore ?? new MemoryRunStateStore();
  const editorialMemoryStore = options.editorialMemoryStore ??
    new NoopEditorialMemoryStore();
  const articleFetchRouter = new ArticleFetchRouter(config);
  const researchSearchProviders = resolveResearchSearchProviders(config);
  const imageLayoutService = new AiArticleImageLayoutService(
    new WeixinArticleImageLayoutService(),
    imageGeneratorResolver,
    {
      enabled: bodyImages.mode !== "off",
      imageCount: bodyImages.count,
      onlyWhenNoMedia: bodyImages.mode === "missing",
      imageSize: bodyImages.size,
      imageModel: bodyImages.model,
      imageGeneratorType: resolveImageGeneratorType(
        bodyImages.provider,
        "body",
      ),
      promptProfile,
    },
  );

  return {
    publisher,
    notifier,
    scrapeService: new WeixinArticleContentScrapeService(
      planArticleSources(config),
      notifier,
      stats,
      articleFetchRouter,
      config.features.article.sourceLimits,
    ),
    dedupService: new WeixinArticleContentDedupService(
      stats,
      {
        enabled: deduplication.enabled,
        providerType: resolveEmbeddingProviderType(
          deduplication.embeddingProvider,
        ),
        model: config.providers.vector.embedding.model,
      },
      embeddingResolver,
      options.vectorStoreFactory ?? (async () => {
        throw new Error(
          `向量去重需要注入 ${config.storage.vector.provider} VectorStore`,
        );
      }),
    ),
    processService: new WeixinArticleContentProcessService(
      new AISummarizer(llmProvider, promptProfile),
      notifier,
      config.features.article.count,
      articleFetchRouter,
    ),
    titleService: new WeixinArticleTitleService(),
    coverService: new WeixinArticleCoverService(
      publisher,
      imageGeneratorResolver,
      promptProfile,
      cover.model,
      resolveImageGeneratorType(cover.provider, "cover"),
      accountBrand,
      cover.provider === "minimax" && isMiniMaxH3ImageModel(cover.model)
        ? { generationMs: MINIMAX_H3_TIMEOUT_MS }
        : undefined,
    ),
    renderService: new WeixinArticleRenderService(
      new WeixinArticleTemplateRenderer(
        new WeixinDynamicHtmlGenerator(
          llmProvider,
          promptProfile,
          accountBrand,
        ),
        true,
        imageLayoutService,
        publisher,
        renderer.template,
      ),
    ),
    dryRunOutputService: new WeixinArticleDryRunOutputService(artifactStore),
    contentRanker: new ContentRanker(llmProvider, promptProfile),
    editorialTopicService: new WeixinArticleEditorialTopicService(
      llmProvider,
      promptProfile,
      8,
      accountBrand,
    ),
    editorialDecisionService: new WeixinArticleEditorialDecisionService(
      llmProvider,
      promptProfile,
      accountBrand,
    ),
    articlePlanService: new WeixinArticlePlanService(
      llmProvider,
      promptProfile,
      accountBrand,
    ),
    articleDraftService: new WeixinArticleDraftService(
      llmProvider,
      promptProfile,
    ),
    researchService: new WeixinArticleResearchService(
      articleFetchRouter,
      {
        enabled: researchSearchProviders.length > 0,
        maxResearchQueries: 3,
        maxResultsPerQuery: 3,
        searchProviders: researchSearchProviders,
      },
    ),
    qualityReviewService: new WeixinArticleQualityReviewService(
      llmProvider,
      promptProfile,
      accountBrand,
    ),
    revisionService: new WeixinArticleRevisionService(
      llmProvider,
      promptProfile,
    ),
    stats,
    runtime: {
      artifactStore,
      runStateStore,
      editorialMemoryStore,
      mode: options.mode ?? "local",
    },
    config: {
      dryRun: config.features.article.dryRun,
      profileId: options.profileId,
      accountId: effectiveAccountId,
      accountBrand,
      runtimeConfigSnapshot: options.runtimeConfigSnapshot,
      qualityGate: config.features.article.qualityGate,
    },
  };
}

function resolveResearchSearchProviders(
  config: ResolvedTrendPublishConfig,
): FetchProviderId[] {
  const providers = resolveSourceProviders(
    "article quality research",
    config.fetchGroups.search ?? ["auto"],
    "query",
  ).filter(isSearchFetchProvider);

  return providers.filter((provider) =>
    fetchProviderRegistry.get(provider).isConfigured(config)
  ) as FetchProviderId[];
}

function createPublisher(
  config: ResolvedTrendPublishConfig,
  accountId = config.features.article.publisher.accountId,
): WeixinArticlePublisher {
  switch (config.features.article.publisher.provider) {
    case "weixin":
      return new WeixinPublisher(
        config.providers.publish.weixin,
        accountId,
      );
    case "weixin-relay":
      return new WeixinRelayPublisher(
        config.providers.publish.weixinRelay,
        config.providers.publish.weixin,
        accountId,
      );
  }
}

function resolveImageGeneratorType(
  provider: ResolvedTrendPublishConfig["features"]["article"]["cover"][
    "provider"
  ],
  usage: "cover",
): ImageGeneratorType.ALIYUN_POSTER | ImageGeneratorType.MINIMAX_IMAGE;
function resolveImageGeneratorType(
  provider: ResolvedTrendPublishConfig["features"]["article"]["bodyImages"][
    "provider"
  ],
  usage: "body",
): ImageGeneratorType.ALIYUN_IMAGE | ImageGeneratorType.MINIMAX_IMAGE;
function resolveImageGeneratorType(
  provider: ResolvedTrendPublishConfig["features"]["article"]["cover"][
    "provider"
  ],
  usage: "cover" | "body",
):
  | ImageGeneratorType.ALIYUN_POSTER
  | ImageGeneratorType.ALIYUN_IMAGE
  | ImageGeneratorType.MINIMAX_IMAGE {
  switch (provider) {
    case "dashscope":
      return usage === "cover"
        ? ImageGeneratorType.ALIYUN_POSTER
        : ImageGeneratorType.ALIYUN_IMAGE;
    case "minimax":
      return ImageGeneratorType.MINIMAX_IMAGE;
  }
}

function resolveEmbeddingProviderType(
  provider: ResolvedTrendPublishConfig["features"]["article"]["deduplication"][
    "embeddingProvider"
  ],
): EmbeddingProviderType {
  switch (provider) {
    case "dashscope":
      return EmbeddingProviderType.DASHSCOPE;
  }
}
