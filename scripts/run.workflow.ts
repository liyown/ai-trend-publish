import { WorkflowType } from "@src/controllers/cron.ts";
import { LocalWorkflowRuntime } from "@src/core/workflow/local-workflow-runtime.ts";
import { createLocalWeixinArticleWorkflowDefinition } from "@src/app/weixin-article/local-workflow.definition.ts";
import {
  getAppConfig,
  initializeAppConfig,
  parseConfigArgs,
  shutdownAppResources,
  validateAppConfig,
} from "@src/utils/config/app-config.ts";
import { createLocalArticleRuntimeStores } from "@src/app/weixin-article/local-runtime-stores.ts";
import {
  resolveArticleRuntimeConfig,
} from "@src/app/weixin-article/runtime/article-runtime-config.service.ts";
import { planArticleSources } from "@src/app/weixin-article/fetch/article-fetch-planner.ts";
import { ArticleFetchRouter } from "@src/app/weixin-article/fetch/article-fetch-router.ts";
import { runLocalWeixinArticleMatrixDryRun } from "@src/app/weixin-article/local-matrix-runner.ts";
import {
  type ArticleSourceFilter,
  WeixinArticleContentScrapeService,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import type { INotifier } from "@src/core/ports/notifier.ts";
import { join } from "node:path";

interface CliOptions {
  dryRun: boolean;
  maxArticles?: number;
  sourceType?: ArticleSourceFilter;
  dryRunOutputDir?: string;
  forcePublish?: boolean;
  profileId?: string;
  accountId?: string;
  accountIds: string[];
  matrix: boolean;
  sourcesOnly?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    accountIds: [],
    matrix: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--workflow":
        if (!next || next !== WorkflowType.WeixinArticle) {
          throw new Error(
            `--workflow 仅支持: ${WorkflowType.WeixinArticle}`,
          );
        }
        index++;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--dry-run-output":
        if (!next) {
          throw new Error("--dry-run-output 需要提供输出目录");
        }
        options.dryRunOutputDir = next;
        index++;
        break;
      case "--max-articles":
        if (!next || Number.isNaN(Number(next))) {
          throw new Error("--max-articles 需要提供数字");
        }
        options.maxArticles = Number(next);
        index++;
        break;
      case "--source":
        if (!isArticleSourceFilter(next)) {
          throw new Error(
            `--source 必须是以下值之一: ${
              Array.from(ARTICLE_SOURCE_FILTERS).join("、")
            }`,
          );
        }
        options.sourceType = next;
        index++;
        break;
      case "--force-publish":
        options.forcePublish = true;
        break;
      case "--profile":
        if (!next) {
          throw new Error("--profile 需要提供 Profile ID");
        }
        options.profileId = next;
        index++;
        break;
      case "--account":
        if (!next) {
          throw new Error("--account 需要提供账号 ID");
        }
        options.accountIds.push(
          ...next.split(",").map((item) => item.trim()).filter(Boolean),
        );
        if (!options.accountId) {
          options.accountId = options.accountIds[0];
        }
        index++;
        break;
      case "--matrix":
        options.matrix = true;
        options.dryRun = true;
        break;
      case "--sources-only":
        options.sourcesOnly = true;
        break;
      case "--help":
        printHelp();
        Deno.exit(0);
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`TrendPublish 工作流运行器

用法:
  deno task article
  deno task article --dry-run
  deno run -A scripts/run.workflow.ts --workflow weixin-article-workflow --dry-run --max-articles 5

参数:
  --config <path>       指定配置文件路径，优先级高于 TRENDPUBLISH_CONFIG
  --workflow <type>       兼容旧命令，仅支持 weixin-article-workflow
  --dry-run              跑完整流程但不上传封面/正文图，也不发布
  --dry-run-output <dir> dry-run HTML 输出目录
  --max-articles <n>     限制文章数量
  --source <type>        限制抓取 provider，例如 all、firecrawl、jina、jina-search、hackernews
  --profile <id>        指定 Dashboard 运行时配置 Profile
  --account <id[,id]>   指定公众号账号；单账号取第一个，矩阵可逗号分隔或重复传入
  --matrix              运行账号矩阵 dry-run；不传 --account 时使用全部启用账号
  --sources-only        只测试数据源抓取和截断，不进入 LLM/生成/发布链路
  --force-publish        传递强制发布标记
`);
}

function isArticleSourceFilter(value: unknown): value is ArticleSourceFilter {
  return typeof value === "string" &&
    ARTICLE_SOURCE_FILTERS.has(value as ArticleSourceFilter);
}

const ARTICLE_SOURCE_FILTERS = new Set<ArticleSourceFilter>([
  "all",
  "firecrawl",
  "jina",
  "jina-search",
  "parallel-search",
  "brave-search",
  "tavily-search",
  "exa-search",
  "serper-search",
  "newsapi",
  "gdelt",
  "hackernews",
  "arxiv",
  "twitter",
  "rss",
]);

const parsedConfigArgs = parseConfigArgs(Deno.args);
const options = parseArgs(parsedConfigArgs.args);
try {
  await initializeAppConfig({ configPath: parsedConfigArgs.configPath });
  await validateAppConfig({
    requireLLM: !options.sourcesOnly,
    requireWeixinPublish: !options.dryRun && !options.sourcesOnly,
  });

  if (options.matrix && !options.dryRun) {
    throw new Error("矩阵运行第一版只允许 dry-run");
  }
  if (options.matrix && options.sourcesOnly) {
    throw new Error("--matrix 不能和 --sources-only 同时使用");
  }

  if (options.sourcesOnly) {
    await runSourceTest(options);
  } else if (options.matrix) {
    await runMatrixDryRun(options);
  } else {
    const runtime = new LocalWorkflowRuntime();
    const runId = options.dryRun
      ? `manual-dry-run-${crypto.randomUUID()}`
      : `manual-run-${crypto.randomUUID()}`;
    await runtime.run(createLocalWeixinArticleWorkflowDefinition(), {
      payload: {
        runId,
        trigger: "manual",
        dryRun: options.dryRun,
        dryRunOutputDir: options.dryRunOutputDir,
        maxArticles: options.maxArticles,
        sourceType: options.sourceType,
        forcePublish: options.forcePublish,
        profileId: options.profileId,
        accountId: options.accountId,
      },
      id: runId,
      timestamp: Date.now(),
    });
  }
} finally {
  await shutdownAppResources();
}

async function runMatrixDryRun(options: CliOptions): Promise<void> {
  const baseConfig = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(baseConfig, {
    outputDir: options.dryRunOutputDir,
  });
  const result = await runLocalWeixinArticleMatrixDryRun(baseConfig, stores, {
    accountIds: options.accountIds,
    profileId: options.profileId,
    dryRunOutputDir: options.dryRunOutputDir,
    maxArticles: options.maxArticles,
    sourceType: options.sourceType,
  });
  console.log(`矩阵 dry-run 完成:
  - 批次: ${result.matrixRunId}
  - 账号: ${result.accountIds.join(", ")}
  - 子运行: ${result.childRunIds.join(", ")}
  - 状态: ${result.status ?? "unknown"}
${result.summary ?? ""}`);
}

async function runSourceTest(options: CliOptions): Promise<void> {
  const baseConfig = await getAppConfig();
  const stores = createLocalArticleRuntimeStores(baseConfig);
  const runtimeConfig = await resolveArticleRuntimeConfig(
    stores.runtimeConfigStore,
    baseConfig,
    options.profileId,
  );
  const config = runtimeConfig.config;
  const stats = { success: 0, failed: 0, contents: 0, duplicates: 0 };
  const scrapeService = new WeixinArticleContentScrapeService(
    planArticleSources(config),
    noopNotifier(),
    stats,
    new ArticleFetchRouter(config),
    config.features.article.sourceLimits,
  );
  const sources = await scrapeService.loadSources(options.sourceType);
  const result = await scrapeService.scrapeAllDetailed(sources);
  const outputRoot = options.dryRunOutputDir ??
    config.storage.artifacts.outputDir ??
    "src/temp";
  const outputDir = join(Deno.cwd(), outputRoot, "source-tests");
  const outputPath = join(
    outputDir,
    `source-health-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await Deno.mkdir(outputDir, { recursive: true });
  await Deno.writeTextFile(
    outputPath,
    JSON.stringify(result.health, null, 2),
  );

  console.log(`数据源测试完成:
  - 数据源: ${result.health.totalSources}
  - 成功: ${result.health.succeeded}
  - 失败: ${result.health.failed}
  - 空结果: ${result.health.empty}
  - 保留内容: ${result.health.totalArticles}
  - 结果文件: ${outputPath}`);

  if (result.health.totalArticles === 0) {
    throw new Error("数据源测试未获取到任何可用内容");
  }
}

function noopNotifier(): INotifier {
  return {
    refresh: () => Promise.resolve(),
    info: () => Promise.resolve(true),
    success: () => Promise.resolve(true),
    warning: () => Promise.resolve(true),
    error: () => Promise.resolve(true),
    notify: () => Promise.resolve(true),
  };
}
