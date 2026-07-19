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
  getWorkspace(): Promise<WorkspaceSnapshot>;
  getHealth(): Promise<HealthResponse>;
  getJob(jobId: string): Promise<{ job: JobRecord; tasks: TaskRecord[] }>;
  streamJobEvents(
    jobId: string,
    options: {
      signal: AbortSignal;
      lastEventId?: string;
      onOpen(): void;
      onEvent(event: RuntimeEvent): void;
    },
  ): Promise<void>;
  listConnections(): Promise<{ definitions: ConnectorDefinition[]; connections: Connection[] }>;
  createConnection(body: SaveConnectionPayload): Promise<{ connection: Connection }>;
  updateConnection(id: string, body: SaveConnectionPayload): Promise<{ connection: Connection }>;
  deleteConnection(id: string): Promise<{ success: boolean }>;
  testConnection(
    body: SaveConnectionPayload,
  ): Promise<{ test: { success: boolean; message: string; latencyMs: number; checkedAt: string } }>;
  createIdentity(body: SaveIdentityPayload): Promise<{ identity: ContentIdentity }>;
  updateIdentity(id: string, body: SaveIdentityPayload): Promise<{ identity: ContentIdentity }>;
  deleteIdentity(id: string): Promise<{ success: boolean }>;
  createKnowledgeBase(body: SaveKnowledgeBasePayload): Promise<{ knowledgeBase: KnowledgeBase }>;
  updateKnowledgeBase(
    id: string,
    body: SaveKnowledgeBasePayload,
  ): Promise<{ knowledgeBase: KnowledgeBase }>;
  deleteKnowledgeBase(id: string): Promise<{ success: boolean }>;
  createSourceCollection(
    body: SaveSourceCollectionPayload,
  ): Promise<{ sourceCollection: SourceCollection }>;
  updateSourceCollection(
    id: string,
    body: SaveSourceCollectionPayload,
  ): Promise<{ sourceCollection: SourceCollection }>;
  deleteSourceCollection(id: string): Promise<{ success: boolean }>;
  createContentPlan(body: SaveContentPlanPayload): Promise<{ contentPlan: ContentPlan }>;
  updateContentPlan(
    id: string,
    body: SaveContentPlanPayload,
  ): Promise<{ contentPlan: ContentPlan }>;
  deleteContentPlan(id: string): Promise<{ success: boolean }>;
  createChannelAccount(
    body: SaveChannelAccountPayload,
  ): Promise<{ channelAccount: ChannelAccount }>;
  updateChannelAccount(
    id: string,
    body: SaveChannelAccountPayload,
  ): Promise<{ channelAccount: ChannelAccount }>;
  deleteChannelAccount(id: string): Promise<{ success: boolean }>;
  createPublishTarget(body: SavePublishTargetPayload): Promise<{ publishTarget: PublishTarget }>;
  updatePublishTarget(
    id: string,
    body: SavePublishTargetPayload,
  ): Promise<{ publishTarget: PublishTarget }>;
  deletePublishTarget(id: string): Promise<{ success: boolean }>;
  createAutomation(body: SaveAutomationPayload): Promise<{ automation: Automation }>;
  updateAutomation(id: string, body: SaveAutomationPayload): Promise<{ automation: Automation }>;
  deleteAutomation(id: string): Promise<{ success: boolean }>;
  startAutomationRun(id: string, body: { requestedTopic?: string }): Promise<{ job: JobRecord }>;
  startArticleGeneration(body: {
    planId: string;
    requestedTopic?: string;
  }): Promise<{ job: JobRecord }>;
  submitEditedArticle(body: {
    planId: string;
    source: ArticleSource;
    assetRequests: AssetRequest[];
    reviewRequestId: string;
  }): Promise<{ job: JobRecord }>;
  startPublication(body: { packageId: string; targetIds: string[] }): Promise<{ job: JobRecord }>;
  resumeJob(job: Pick<JobRecord, "id" | "type">): Promise<{ job: JobRecord }>;
}

export type * from "./types.ts";
