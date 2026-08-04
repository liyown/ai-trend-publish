import type {
  ArticleEvidenceSupplementer,
  ArticleEvaluator,
  ArticleTransformer,
  AssetProvider,
  AssetRequestType,
  ConfiguredResearchSeed,
  CoverImageGenerationContext,
  ResearchTool,
} from "../extensions.ts";
import type { ArticleExecutionPlan } from "../pipeline.ts";
import type { LanguageModel } from "../operations/language-model.ts";
import {
  CoverImageProvider,
  CoverRequestTransformer,
} from "../plugins/cover-image.ts";
import { EditorialQualityEvaluator } from "../plugins/editorial-quality.ts";
import { TitleStyleTransformer } from "../plugins/title-style.ts";
import {
  DefaultArticleReviser,
  DefaultArticleResearcher,
  DefaultArticleWriter,
  DefaultEvidenceSupplementer,
} from "../services/default-article-services.ts";
import { ArticlePluginId, ChannelId, WorkspaceKind } from "@trendpublish/contracts";
import {
  ChatCapability,
  ImageCapability,
  type ChatClient,
  type ConnectorManager,
  type ConnectorClientResolver,
} from "@trendpublish/connectors";
import type { ContentPlanResolver } from "./article-application.ts";
import type { ContentPlan, WorkspaceRepository } from "./workspace.ts";
import { ConnectionResearchAdapter, type ResearchCapability } from "./research-adapter.ts";

export interface WorkspaceContentPlanResolverOptions {
  workspace: WorkspaceRepository;
  connectors: ConnectorClientResolver;
  connectionManager: ConnectorManager;
}

export class WorkspaceContentPlanResolver implements ContentPlanResolver {
  constructor(private readonly options: WorkspaceContentPlanResolverOptions) {}

  async resolve(plan: ContentPlan): Promise<ArticleExecutionPlan> {
    const chatConnectionId = plan.connections.chat;
    if (!chatConnectionId) throw new Error("内容方案没有绑定对话模型连接");
    const chat = await this.options.connectors.get(chatConnectionId, ChatCapability);
    const languageModel = new ConnectorLanguageModel(chat);
    const research = await this.resolveResearch(plan);
    const requiredAssetTypes = await this.resolveRequiredAssetTypes(plan);
    const extensions = await this.resolveExtensions(plan, languageModel, research.tools);
    validateRequiredAssetSupport(plan, requiredAssetTypes, extensions.assetProviders);
    return {
      id: plan.id,
      revision: plan.revision,
      requiredAssetTypes,
      researcher: new DefaultArticleResearcher({
        languageModel,
        seeds: research.seeds,
        tools: research.tools,
      }),
      writer: new DefaultArticleWriter({ languageModel }),
      evidenceSupplementer: extensions.evidenceSupplementer,
      reviser: new DefaultArticleReviser({ languageModel }),
      transformers: extensions.transformers,
      evaluators: extensions.evaluators,
      assetProviders: extensions.assetProviders,
      quality: {
        policyVersion: `content-plan:${plan.id}@${plan.revision}`,
        maxQualityRounds: extensions.maxQualityRounds ?? 2,
      },
    };
  }

  private async resolveRequiredAssetTypes(plan: ContentPlan): Promise<AssetRequestType[]> {
    if (plan.publishing.mode !== "publish") return [];
    const targets = await Promise.all(
      plan.publishing.targetIds.map((id) =>
        this.options.workspace.get(WorkspaceKind.PublishTarget, id),
      ),
    );
    const missingTarget = plan.publishing.targetIds.find((_, index) => !targets[index]);
    if (missingTarget) throw new Error(`内容方案绑定的发布目标不存在：${missingTarget}`);
    const accountIds = [...new Set(targets.map((target) => target!.channelAccountId))];
    const accounts = await Promise.all(
      accountIds.map((id) => this.options.workspace.get(WorkspaceKind.ChannelAccount, id)),
    );
    const missingAccount = accountIds.find((_, index) => !accounts[index]);
    if (missingAccount) throw new Error(`发布目标绑定的渠道账号不存在：${missingAccount}`);
    return accounts.some((account) => account!.channel === ChannelId.WeixinOfficialAccount)
      ? ["cover"]
      : [];
  }

  private async resolveResearch(plan: ContentPlan): Promise<{
    seeds: ConfiguredResearchSeed[];
    tools: ResearchTool[];
  }> {
    const collections = await Promise.all(
      plan.sourceCollectionIds.map((id) =>
        this.options.workspace.get(WorkspaceKind.SourceCollection, id),
      ),
    );
    const missingCollection = plan.sourceCollectionIds.find((_, index) => !collections[index]);
    if (missingCollection) throw new Error(`内容方案绑定的来源配置不存在：${missingCollection}`);
    const sources = collections
      .filter((collection) => collection?.enabled)
      .flatMap((collection) => collection!.sources)
      .filter((source) => source.enabled);
    const connections = await this.options.connectionManager.list();
    const definitions = new Map(
      this.options.connectionManager.definitions().map((definition) => [definition.id, definition]),
    );
    const byId = new Map(connections.map((connection) => [connection.id, connection]));
    const selected = plan.researchConnections ?? { search: [], fetch: [] };
    const resolveConnections = (capability: ResearchCapability, ids: string[]) => {
      const compatible = connections.filter(
        (connection) =>
          connection.enabled &&
          definitions.get(connection.connectorId)?.capabilities.includes(capability),
      );
      if (!ids.length) return compatible.slice(0, 1);
      return ids.map((id) => {
        const connection = byId.get(id);
        if (
          !connection?.enabled ||
          !definitions.get(connection.connectorId)?.capabilities.includes(capability)
        ) {
          throw new Error(`研究连接不存在、已停用或不支持 ${capability}：${id}`);
        }
        return connection;
      });
    };
    const searchConnections = resolveConnections("source-search", selected.search);
    const fetchConnections = resolveConnections("source-fetch", selected.fetch);
    const tools = [
      ...searchConnections.map((connection) =>
        ConnectionResearchAdapter.create({
          connection,
          capability: "source-search",
          connectors: this.options.connectors,
        }),
      ),
      ...fetchConnections.map((connection) =>
        ConnectionResearchAdapter.create({
          connection,
          capability: "source-fetch",
          connectors: this.options.connectors,
        }),
      ),
    ];
    if (
      sources.some((source) => source.kind === "query") &&
      !tools.some((tool) => tool.capability === "fetch")
    ) {
      throw new Error("查询来源必须同时配置可用的网页抓取连接，搜索摘要不能直接作为证据");
    }
    const seeds: ConfiguredResearchSeed[] = sources.map((source) => ({
      id: source.id,
      label: source.title || (source.kind === "url" ? source.url : source.query),
      source:
        source.kind === "url"
          ? { type: "url", url: source.url }
          : { type: "query", query: source.query },
    }));
    return { seeds, tools };
  }

  private async resolveExtensions(
    plan: ContentPlan,
    languageModel: LanguageModel,
    researchTools: ResearchTool[],
  ): Promise<{
    transformers: ArticleTransformer[];
    evaluators: ArticleEvaluator[];
    evidenceSupplementer?: ArticleEvidenceSupplementer;
    assetProviders: Partial<Record<AssetRequestType, AssetProvider>>;
    maxQualityRounds?: number;
  }> {
    const transformers: ArticleTransformer[] = [];
    const evaluators: ArticleEvaluator[] = [];
    const assetProviders: Partial<Record<AssetRequestType, AssetProvider>> = {};
    let evidenceSupplementer: ArticleEvidenceSupplementer | undefined;
    let maxQualityRounds: number | undefined;
    for (const selection of plan.plugins.filter((item) => item.enabled)) {
      if (selection.pluginId === ArticlePluginId.TitleStyle) {
        transformers.push(
          new TitleStyleTransformer({
            languageModel,
            rules: stringArrayValue(selection.config, "rules"),
            minLength: numberValue(selection.config, "minLength"),
            maxLength: numberValue(selection.config, "maxLength"),
          }),
        );
        continue;
      }
      if (selection.pluginId === ArticlePluginId.EditorialQuality) {
        evaluators.push(
          new EditorialQualityEvaluator({
            languageModel,
            severity: diagnosticSeverityValue(selection.config),
            standards: stringArrayValue(selection.config, "standards"),
          }),
        );
        maxQualityRounds = qualityRoundsValue(selection.config);
        continue;
      }
      if (selection.pluginId === ArticlePluginId.EvidenceSupplement) {
        evidenceSupplementer = new DefaultEvidenceSupplementer({
          languageModel,
          tools: researchTools,
        });
        continue;
      }
      if (selection.pluginId === ArticlePluginId.CoverImage) {
        const imageConnectionId = plan.connections.image;
        const style = stringValue(selection.config, "style");
        const necessity = assetNecessityValue(selection.config);
        transformers.push(new CoverRequestTransformer({ style, necessity }));
        if (imageConnectionId) {
          assetProviders.cover = new CoverImageProvider({
            generator: new ConnectorCoverImageGenerator(this.options.connectors, imageConnectionId),
            style,
          });
        }
        continue;
      }
      throw new Error(`未注册文章插件：${selection.pluginId}`);
    }
    return { transformers, evaluators, evidenceSupplementer, assetProviders, maxQualityRounds };
  }
}

class ConnectorLanguageModel implements LanguageModel {
  constructor(private readonly client: ChatClient) {}

  async generate(request: Parameters<LanguageModel["generate"]>[0]): Promise<string> {
    const output = await this.client.complete(
      {
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: request.temperature,
        responseFormat: request.json ? "json" : "text",
      },
      {
        signal: request.signal,
        traceId: request.events?.jobId,
        taskId: request.events?.taskId,
        onEvent: (event) => {
          if (event.type === "response.started") {
            request.events?.emit("model.response.started", { model: event.model });
          } else if (event.type === "response.delta") {
            request.events?.emit("model.response.delta", {
              delta: event.delta,
              accumulatedCharacters: event.accumulatedCharacters,
            });
          } else {
            request.events?.emit("model.response.completed", {
              model: event.model,
              usage: event.usage,
              accumulatedCharacters: event.accumulatedCharacters,
            });
          }
        },
      },
    );
    return output.content;
  }
}

class ConnectorCoverImageGenerator {
  constructor(
    private readonly connectors: ConnectorClientResolver,
    private readonly connectionId: string,
  ) {}

  async generate(input: { title: string; prompt: string }, context: CoverImageGenerationContext) {
    const client = await this.connectors.get(this.connectionId, ImageCapability);
    const output = await client.generate(
      { prompt: input.prompt, aspect_ratio: "16:9" },
      {
        signal: context.signal,
        traceId: context.jobId,
        taskId: context.taskId,
      },
    );
    const first = output.images[0];
    if (!first) throw new Error("图片连接没有返回封面");
    if (first.url) return { uri: first.url, mimeType: first.mimeType };
    if (first.base64) {
      const mimeType = first.mimeType ?? "image/png";
      return { uri: `data:${mimeType};base64,${first.base64}`, mimeType };
    }
    throw new Error("图片连接返回的封面没有 URL 或 Base64 内容");
  }
}

// ── config value helpers ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined;
}

function stringArrayValue(value: unknown, key: string): string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value[key])) return undefined;
  const values = value[key].filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
  return values.length ? values.map((item) => item.trim()) : undefined;
}

function numberValue(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}

function assetNecessityValue(value: unknown): "enhancement" | "essential" {
  const necessity = stringValue(value, "necessity");
  if (!necessity || necessity === "essential") return "essential";
  if (necessity === "enhancement") return "enhancement";
  throw new Error(`不支持的封面必要性：${necessity}`);
}

function diagnosticSeverityValue(value: unknown): "warning" | "error" | "blocker" | undefined {
  const severity = stringValue(value, "severity");
  if (!severity) return undefined;
  if (severity === "warning" || severity === "error" || severity === "blocker") return severity;
  throw new Error(`不支持的质量问题级别：${severity}`);
}

function qualityRoundsValue(value: unknown): number | undefined {
  const rounds = numberValue(value, "maxQualityRounds");
  if (rounds === undefined) return undefined;
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 5) {
    throw new Error("maxQualityRounds 必须是 0 到 5 之间的整数");
  }
  return rounds;
}

function validateRequiredAssetSupport(
  plan: ContentPlan,
  requiredAssetTypes: AssetRequestType[],
  assetProviders: Partial<Record<AssetRequestType, AssetProvider>>,
): void {
  if (!requiredAssetTypes.includes("cover")) return;
  const cover = plan.plugins.find((item) => item.pluginId === ArticlePluginId.CoverImage);
  if (!cover?.enabled) throw new Error("微信公众号发布必须启用封面图片插件");
  if (assetNecessityValue(cover.config) !== "essential") {
    throw new Error("微信公众号发布必须将封面设为必要资源");
  }
  if (!plan.connections.image || !assetProviders.cover) {
    throw new Error("微信公众号发布必须绑定可用的图片连接");
  }
}
