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
  recoverBackgroundJobs,
  type BackgroundTasks,
} from "@trendpublish/core/application";
import {
  ArticleApplication,
  WorkspaceContentPlanResolver,
} from "@trendpublish/article/application";
import type { WorkspaceRepository } from "@trendpublish/core/workspace";
import { JobType, WorkspaceKind } from "@trendpublish/contracts";
import {
  ChannelRegistry,
  FetchPublicationAssetLoader,
  PublicationRunner,
  WeixinChannelAdapter,
  WEIXIN_ARTICLE_PROFILE,
  WEIXIN_CHANNEL_DEFINITION,
} from "@trendpublish/publishing";
import {
  EventedJobStore,
  RuntimeEventHub,
  type JobStore,
  type RuntimeEventSource,
  RunManager,
  type TaskStore,
} from "@trendpublish/runtime";
import {
  SQLiteStateStore,
  asConnectionStore,
  asCredentialStore,
  asJobStore,
  asTaskStore,
  asRunStore,
} from "../platform/local/sqlite-state-store.ts";
import { migratePublishingModel } from "./publishing-model-migration.ts";
import { migrateRunRecords } from "./run-record-migration.ts";

export interface ApplicationRuntime {
  workspace: WorkspaceRepository;
  jobs: JobStore;
  tasks: TaskStore;
  events: RuntimeEventSource;
  runs: RunManager;
  connectors: ConnectorClientResolver;
  connectionManager: ConnectorManager;
  channels: ChannelRegistry;
  articles: ArticleApplication;
  publishing: PublishingApplication;
  automations: AutomationApplication;
  background: BackgroundTasks;
}

export async function createLocalApplicationRuntime(
  databasePath: string,
): Promise<ApplicationRuntime> {
  const state = new SQLiteStateStore(databasePath);
  await state.ensureSchema();
  const connections = asConnectionStore(state);
  const credentials = asCredentialStore(state);
  const storedJobs = asJobStore(state);
  const runStore = asRunStore(state);
  const tasks = asTaskStore(state);
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
  const planResolver = new WorkspaceContentPlanResolver({
    workspace: state,
    connectors,
    connectionManager,
  });
  const articles = new ArticleApplication({
    workspace: state,
    jobs,
    tasks,
    planResolver,
    events,
    runs,
  });
  const publishing = new PublishingApplication({
    workspace: state,
    jobs,
    tasks,
    publishing: new PublicationRunner(channels, {
      resolveModel: async (contentPackage) => {
        const plan = await state.get(WorkspaceKind.ContentPlan, contentPackage.origin.planId);
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
  const automations = new AutomationApplication({
    workspace: state,
    jobs,
    articles,
    publishing,
    events,
  });
  const background = new InProcessBackgroundTasks();
  const runtime: ApplicationRuntime = {
    workspace: state,
    jobs,
    tasks,
    events,
    runs,
    connectors,
    connectionManager,
    channels,
    articles,
    publishing,
    automations,
    background,
  };
  await migratePublishingModel(runtime);
  await migrateRunRecords(runtime);
  await recoverBackgroundJobs({
    jobs,
    background,
    resumers: {
      [JobType.GenerateArticle]: (jobId) => articles.resume(jobId),
      [JobType.PublishContent]: (jobId) => publishing.resume(jobId),
      [JobType.RunAutomation]: (jobId) => automations.resume(jobId),
    },
  });
  await runs.reconcileInterruptedActivities();
  return runtime;
}

export function connectorEventObserver(events: RuntimeEventSource) {
  return {
    onOperationStart(
      event: Parameters<
        NonNullable<import("@trendpublish/connectors").ConnectorObserver["onOperationStart"]>
      >[0],
    ) {
      events.publish({
        type: "connector.operation.started",
        jobId: event.traceId,
        taskId: event.taskId,
        data: event,
      });
    },
    onOperationEnd(
      event: Parameters<
        NonNullable<import("@trendpublish/connectors").ConnectorObserver["onOperationEnd"]>
      >[0],
    ) {
      events.publish({
        type: "connector.operation.completed",
        jobId: event.traceId,
        taskId: event.taskId,
        data: event,
      });
    },
  };
}
