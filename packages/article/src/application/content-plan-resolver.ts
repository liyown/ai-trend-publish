import type { ConfiguredResearchSeed, ResearchTool } from "../extensions.ts";
import type { ArticleExecutionPlan } from "../pipeline.ts";
import { WorkspaceKind } from "@trendpublish/contracts";
import {
  ChatCapability,
  type ConnectorManager,
  type ConnectorClientResolver,
} from "@trendpublish/connectors";
import type { ContentPlanResolver } from "./article-application.ts";
import type { ContentPlan, WorkspaceRepository } from "./workspace.ts";
import { ConnectionResearchAdapter, type ResearchCapability } from "./research-adapter.ts";
import { resolveContentPlanTemplate } from "../presets.ts";
import { ContentReactAgent } from "../react-content-agent.ts";

export interface WorkspaceContentPlanResolverOptions {
  workspace: WorkspaceRepository;
  connectors: ConnectorClientResolver;
  connectionManager: ConnectorManager;
}

export class WorkspaceContentPlanResolver implements ContentPlanResolver {
  constructor(private readonly options: WorkspaceContentPlanResolverOptions) {}

  async resolve(plan: ContentPlan): Promise<ArticleExecutionPlan> {
    const chatConnectionId = plan.agent?.modelConnectionId ?? plan.connections.chat;
    if (!chatConnectionId) throw new Error("内容方案没有绑定对话模型连接");
    const chat = await this.options.connectors.get(chatConnectionId, ChatCapability);
    const research = await this.resolveResearch(plan);
    const strategy = resolveContentPlanTemplate(plan.agent?.strategyId ?? plan.templateId);
    return {
      id: plan.id,
      revision: plan.revision,
      agent: new ContentReactAgent({
        model: chat,
        modelConnectionId: chatConnectionId,
        strategyId: strategy.definition.id,
        strategyInstructions: [
          strategy.definition.description,
          ...strategy.title.rules,
          ...strategy.quality.standards,
        ].join("；"),
        seeds: research.seeds,
        tools: research.tools,
        enhancementToolIds: plan.agent?.enhancementToolIds ?? [],
        budget: plan.agent?.budget,
      }),
    };
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
    const selected = plan.agent
      ? {
          search: plan.agent.toolConnectionIds,
          fetch: plan.agent.toolConnectionIds,
          explicit: true,
        }
      : { ...(plan.researchConnections ?? { search: [], fetch: [] }), explicit: false };
    const resolveConnections = (capability: ResearchCapability, ids: string[]) => {
      const compatible = connections.filter(
        (connection) =>
          connection.enabled &&
          definitions.get(connection.connectorId)?.capabilities.includes(capability),
      );
      if (!ids.length) return selected.explicit ? [] : compatible.slice(0, 1);
      return ids
        .filter((id) => compatible.some((connection) => connection.id === id))
        .map((id) => {
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
      !plan.agent &&
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
}
