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
} from "@trendpublish/core/application";
import {
  ChannelAdapterRegistry,
  FetchPublicationAssetLoader,
  PublicationRunner,
  WeixinChannelAdapter,
} from "@trendpublish/publishing";
import { EventedJobStore, RuntimeEventHub } from "@trendpublish/runtime";
import { connectorEventObserver, type ApplicationRuntime } from "./runtime.ts";
import { InProcessBackgroundTasks } from "./background-tasks.ts";
import { WorkspaceContentPlanResolver } from "./content-plan-resolver.ts";
import {
  D1ConnectionStore,
  D1CredentialStore,
  D1JobStore,
  D1TaskStore,
  D1WorkspaceRepository,
} from "../platform/cloudflare/d1-state-store.ts";
import type { CloudflareD1Database } from "../platform/cloudflare/cloudflare-bindings.ts";

export function createCloudflareApplicationRuntime(db: CloudflareD1Database): ApplicationRuntime {
  const workspace = new D1WorkspaceRepository(db);
  const connections = new D1ConnectionStore(db);
  const credentials = new D1CredentialStore(db);
  const storedJobs = new D1JobStore(db);
  const tasks = new D1TaskStore(db);
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
  });
  const adapters = new ChannelAdapterRegistry([
    new WeixinChannelAdapter({
      resolveClient: (connectionId) => connectors.get(connectionId, WeixinCapability),
      assetLoader: new FetchPublicationAssetLoader(),
    }),
  ]);
  const publishing = new PublishingApplication({
    workspace,
    jobs,
    tasks,
    publishing: new PublicationRunner(adapters),
    events,
  });
  return {
    workspace,
    jobs,
    tasks,
    events,
    connectors,
    connectionManager,
    articles,
    publishing,
    automations: new AutomationApplication({ workspace, jobs, articles, publishing, events }),
    background: new InProcessBackgroundTasks(),
  };
}
