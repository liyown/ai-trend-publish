import {
  ConnectorManager,
  ConnectorClientResolver,
  WeixinCapability,
  createBuiltInConnectorRegistry,
} from "@trendpublish/connectors";
import {
  ArticleApplication,
  AutomationApplication,
  PublishingApplication,
  InProcessBackgroundTasks,
  recoverBackgroundJobs,
  WorkspaceContentPlanResolver,
  type BackgroundTasks,
} from "@trendpublish/core/application";
import type { WorkspaceRepository } from "@trendpublish/core/workspace";
import { JobType } from "@trendpublish/contracts";
import {
  ChannelAdapterRegistry,
  FetchPublicationAssetLoader,
  PublicationRunner,
  WeixinChannelAdapter,
} from "@trendpublish/publishing";
import {
  EventedJobStore,
  RuntimeEventHub,
  type JobStore,
  type RuntimeEventSource,
  type TaskStore,
} from "@trendpublish/runtime";
import {
  SQLiteStateStore,
  asConnectionStore,
  asCredentialStore,
  asJobStore,
  asTaskStore,
} from "../platform/local/sqlite-state-store.ts";

export interface ApplicationRuntime {
  workspace: WorkspaceRepository;
  jobs: JobStore;
  tasks: TaskStore;
  events: RuntimeEventSource;
  connectors: ConnectorClientResolver;
  connectionManager: ConnectorManager;
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
  const tasks = asTaskStore(state);
  const registry = createBuiltInConnectorRegistry();
  const events = new RuntimeEventHub();
  const jobs = new EventedJobStore(storedJobs, events);
  const connectors = new ConnectorClientResolver({
    registry,
    connections,
    credentials,
    observer: connectorEventObserver(events),
  });
  const connectionManager = new ConnectorManager(connectors, registry, connections, credentials);
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
  });
  const adapters = new ChannelAdapterRegistry([
    new WeixinChannelAdapter({
      resolveClient: (connectionId) => connectors.get(connectionId, WeixinCapability),
      assetLoader: new FetchPublicationAssetLoader(),
    }),
  ]);
  const publishing = new PublishingApplication({
    workspace: state,
    jobs,
    tasks,
    publishing: new PublicationRunner(adapters),
    events,
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
    connectors,
    connectionManager,
    articles,
    publishing,
    automations,
    background,
  };
  await recoverBackgroundJobs({
    jobs,
    background,
    resumers: {
      [JobType.GenerateArticle]: (jobId) => articles.resume(jobId),
      [JobType.CompleteArticle]: (jobId) => articles.resumeCompletion(jobId),
      [JobType.PublishContent]: (jobId) => publishing.resume(jobId),
      [JobType.RunAutomation]: (jobId) => automations.resume(jobId),
    },
  });
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
