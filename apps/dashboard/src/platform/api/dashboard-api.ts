import type {
  ArticleSource,
  AssetRequest,
  Automation,
  ContentPlan,
  ChannelAccount,
  Connection,
  ConnectorDefinition,
  ContentIdentity,
  KnowledgeBase,
  HealthResponse,
  JobRecord,
  PublishTarget,
  SaveContentPlanPayload,
  SaveAutomationPayload,
  SaveChannelAccountPayload,
  SaveConnectionPayload,
  SaveIdentityPayload,
  SaveKnowledgeBasePayload,
  SavePublishTargetPayload,
  SaveSourceCollectionPayload,
  SourceCollection,
  TaskRecord,
  RuntimeEvent,
  WorkspaceSnapshot,
} from "./types.ts";

export interface DashboardApi {
  getWorkspace(apiKey: string): Promise<WorkspaceSnapshot>;
  getHealth(apiKey: string): Promise<HealthResponse>;
  getJob(apiKey: string, jobId: string): Promise<{ job: JobRecord; tasks: TaskRecord[] }>;
  streamJobEvents(
    apiKey: string,
    jobId: string,
    options: {
      signal: AbortSignal;
      lastEventId?: string;
      onOpen(): void;
      onEvent(event: RuntimeEvent): void;
    },
  ): Promise<void>;
  listConnections(
    apiKey: string,
  ): Promise<{ definitions: ConnectorDefinition[]; connections: Connection[] }>;
  createConnection(
    apiKey: string,
    body: SaveConnectionPayload,
  ): Promise<{ connection: Connection }>;
  updateConnection(
    apiKey: string,
    id: string,
    body: SaveConnectionPayload,
  ): Promise<{ connection: Connection }>;
  deleteConnection(apiKey: string, id: string): Promise<{ success: boolean }>;
  testConnection(
    apiKey: string,
    body: SaveConnectionPayload,
  ): Promise<{ test: { success: boolean; message: string; latencyMs: number; checkedAt: string } }>;
  createIdentity(apiKey: string, body: SaveIdentityPayload): Promise<{ identity: ContentIdentity }>;
  updateIdentity(
    apiKey: string,
    id: string,
    body: SaveIdentityPayload,
  ): Promise<{ identity: ContentIdentity }>;
  deleteIdentity(apiKey: string, id: string): Promise<{ success: boolean }>;
  createKnowledgeBase(
    apiKey: string,
    body: SaveKnowledgeBasePayload,
  ): Promise<{ knowledgeBase: KnowledgeBase }>;
  updateKnowledgeBase(
    apiKey: string,
    id: string,
    body: SaveKnowledgeBasePayload,
  ): Promise<{ knowledgeBase: KnowledgeBase }>;
  deleteKnowledgeBase(apiKey: string, id: string): Promise<{ success: boolean }>;
  createSourceCollection(
    apiKey: string,
    body: SaveSourceCollectionPayload,
  ): Promise<{ sourceCollection: SourceCollection }>;
  updateSourceCollection(
    apiKey: string,
    id: string,
    body: SaveSourceCollectionPayload,
  ): Promise<{ sourceCollection: SourceCollection }>;
  deleteSourceCollection(apiKey: string, id: string): Promise<{ success: boolean }>;
  createContentPlan(
    apiKey: string,
    body: SaveContentPlanPayload,
  ): Promise<{ contentPlan: ContentPlan }>;
  updateContentPlan(
    apiKey: string,
    id: string,
    body: SaveContentPlanPayload,
  ): Promise<{ contentPlan: ContentPlan }>;
  deleteContentPlan(apiKey: string, id: string): Promise<{ success: boolean }>;
  createChannelAccount(
    apiKey: string,
    body: SaveChannelAccountPayload,
  ): Promise<{ channelAccount: ChannelAccount }>;
  updateChannelAccount(
    apiKey: string,
    id: string,
    body: SaveChannelAccountPayload,
  ): Promise<{ channelAccount: ChannelAccount }>;
  deleteChannelAccount(apiKey: string, id: string): Promise<{ success: boolean }>;
  createPublishTarget(
    apiKey: string,
    body: SavePublishTargetPayload,
  ): Promise<{ publishTarget: PublishTarget }>;
  updatePublishTarget(
    apiKey: string,
    id: string,
    body: SavePublishTargetPayload,
  ): Promise<{ publishTarget: PublishTarget }>;
  deletePublishTarget(apiKey: string, id: string): Promise<{ success: boolean }>;
  createAutomation(
    apiKey: string,
    body: SaveAutomationPayload,
  ): Promise<{ automation: Automation }>;
  updateAutomation(
    apiKey: string,
    id: string,
    body: SaveAutomationPayload,
  ): Promise<{ automation: Automation }>;
  deleteAutomation(apiKey: string, id: string): Promise<{ success: boolean }>;
  startAutomationRun(
    apiKey: string,
    id: string,
    body: { requestedTopic?: string },
  ): Promise<{ job: JobRecord }>;
  startArticleGeneration(
    apiKey: string,
    body: { planId: string; requestedTopic?: string },
  ): Promise<{ job: JobRecord }>;
  submitEditedArticle(
    apiKey: string,
    body: {
      planId: string;
      source: ArticleSource;
      assetRequests: AssetRequest[];
      reviewRequestId: string;
    },
  ): Promise<{ job: JobRecord }>;
  startPublication(
    apiKey: string,
    body: { packageId: string; targetIds: string[] },
  ): Promise<{ job: JobRecord }>;
  resumeJob(apiKey: string, job: Pick<JobRecord, "id" | "type">): Promise<{ job: JobRecord }>;
}

export type * from "./types.ts";
