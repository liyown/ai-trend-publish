import {
  ConnectorManager,
  ConnectorClientResolver,
  ChatCapability,
  ImageCapability,
  WeixinCapability,
  createBuiltInConnectorRegistry,
  describeConnectorError,
} from "@trendpublish/connectors";
import {
  AutomationApplication,
  PublishingApplication,
  InProcessBackgroundTasks,
} from "@trendpublish/core/application";
import {
  ArticleApplication,
  WorkspaceContentPlanResolver,
} from "@trendpublish/article/application";
import {
  ChannelRegistry,
  FetchPublicationAssetLoader,
  PublicationRunner,
  WeixinChannelAdapter,
  WEIXIN_ARTICLE_PROFILE,
  WEIXIN_CHANNEL_DEFINITION,
} from "@trendpublish/publishing";
import { WorkspaceKind } from "@trendpublish/contracts";
import { EventedJobStore, RunManager, RuntimeEventHub } from "@trendpublish/runtime";
import { connectorEventObserver, type ApplicationRuntime } from "./runtime.ts";
import {
  D1ConnectionStore,
  D1CredentialStore,
  D1JobStore,
  D1RunStore,
  D1TaskStore,
  D1WorkspaceRepository,
} from "../platform/cloudflare/d1-state-store.ts";
import type { CloudflareD1Database } from "../platform/cloudflare/cloudflare-bindings.ts";
import { migratePublishingModel } from "./publishing-model-migration.ts";
import { migrateRunRecords } from "./run-record-migration.ts";

export async function createCloudflareApplicationRuntime(
  db: CloudflareD1Database,
): Promise<ApplicationRuntime> {
  const workspace = new D1WorkspaceRepository(db);
  const connections = new D1ConnectionStore(db);
  const credentials = new D1CredentialStore(db);
  const storedJobs = new D1JobStore(db);
  const runStore = new D1RunStore(db);
  const tasks = new D1TaskStore(db);
  const registry = createBuiltInConnectorRegistry();
  const events = new RuntimeEventHub();
  const runs = new RunManager(runStore, storedJobs, events);
  const jobs = new EventedJobStore(storedJobs, events, runs);
  const connectors = new ConnectorClientResolver({
    registry,
    connections,
    credentials,
    observer: connectorEventObserver(events),
  });
  const connectionManager = new ConnectorManager(connectors, registry, connections, credentials);
  const channels = new ChannelRegistry([
    {
      definition: WEIXIN_CHANNEL_DEFINITION,
      profiles: [WEIXIN_ARTICLE_PROFILE],
      adapters: [
        new WeixinChannelAdapter({
          resolveClient: (connectionId) => connectors.get(connectionId, WeixinCapability),
          assetLoader: new FetchPublicationAssetLoader(),
        }),
      ],
    },
  ]);
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks,
    planResolver: new WorkspaceContentPlanResolver({
      workspace,
      connectors,
      connectionManager,
    }),
    events,
    runs,
  });
  const publishing = new PublishingApplication({
    workspace,
    jobs,
    tasks,
    publishing: new PublicationRunner(channels, {
      resolveModel: async (contentPackage) => {
        const plan = await workspace.get(WorkspaceKind.ContentPlan, contentPackage.origin.planId);
        const connectionId = plan?.agent?.modelConnectionId ?? plan?.connections.chat;
        if (!connectionId) throw new Error("内容包对应的内容方案没有生成模型连接");
        return await connectors.get(connectionId, ChatCapability);
      },
      resolveImage: async (_contentPackage, _destination, account) => {
        const available = await connectionManager.list();
        const definitions = new Map(
          connectionManager.definitions().map((definition) => [definition.id, definition]),
        );
        const connectionId = account.publisher?.toolConnectionIds.find((id) => {
          const connection = available.find((candidate) => candidate.id === id);
          return Boolean(
            connection?.enabled &&
            definitions.get(connection.connectorId)?.capabilities.includes("image"),
          );
        });
        if (!connectionId) throw new Error("发布账号未配置可用的图片生成连接");
        try {
          return await connectors.get(connectionId, ImageCapability);
        } catch (error) {
          throw new Error(`图片生成连接初始化失败：${describeConnectorError(error)}`, {
            cause: error,
          });
        }
      },
    }),
    events,
    runs,
  });
  const runtime: ApplicationRuntime = {
    workspace,
    jobs,
    tasks,
    events,
    runs,
    connectors,
    connectionManager,
    channels,
    articles,
    publishing,
    automations: new AutomationApplication({ workspace, jobs, articles, publishing, events }),
    background: new InProcessBackgroundTasks(),
  };
  await migratePublishingModel(runtime);
  await migrateRunRecords(runtime);
  return runtime;
}
