import type { ContentPackage, ReviewRequest } from "./article.ts";
import type { PublicConnection, PublicConnectorDefinition } from "./connectors.ts";
import type { JobRecord, RunRecord } from "./execution.ts";
import type { JsonValue } from "./json.ts";
import type { PublicationBatchResult, PublicationTypeProfileDefinition } from "./publishing.ts";

type ValueOf<T> = T[keyof T];

export const WorkspaceKind = {
  Automation: "automation",
  Identity: "identity",
  KnowledgeBase: "knowledge-base",
  SourceCollection: "source-collection",
  ContentPlan: "content-plan",
  ChannelAccount: "channel-account",
  ContentPackage: "content-package",
  ReviewRequest: "review-request",
  Publication: "publication",
} as const;
export type WorkspaceKind = ValueOf<typeof WorkspaceKind>;

export type WorkspaceJson = JsonValue;

export interface WorkspaceEntity {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentIdentity extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  positioning: string;
  audience: string;
  tone: string;
  forbiddenTopics: string[];
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  fileName?: string;
  mediaType?: string;
}

export interface KnowledgeBase extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  documents: KnowledgeDocument[];
}

export interface SourceItemBase {
  id: string;
  title?: string;
  enabled: boolean;
}

export type SourceItem =
  | (SourceItemBase & { kind: "url"; url: string })
  | (SourceItemBase & { kind: "query"; query: string });

export interface SourceCollection extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  sources: SourceItem[];
}

export const ContentPlanTemplateId = {
  DailyBrief: "daily-brief",
  DeepAnalysis: "deep-analysis",
  PracticalGuide: "practical-guide",
} as const;
export type ContentPlanTemplateId = ValueOf<typeof ContentPlanTemplateId>;

export const DefaultContentPlanTemplateId = ContentPlanTemplateId.DailyBrief;

/** @deprecated Persisted only for reading older plans; template pipelines ignore this field. */
export interface ArticlePluginSelection {
  pluginId: string;
  enabled: boolean;
  config?: WorkspaceJson;
}

export interface ContentPlan extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  /** Selects a built-in, versioned article pipeline. Internal plugins are not user configuration. */
  templateId?: ContentPlanTemplateId;
  identityId: string;
  knowledgeBaseIds: string[];
  sourceCollectionIds: string[];
  /** @deprecated Internal orchestration is owned by templateId. */
  plugins?: ArticlePluginSelection[];
  connections: Record<string, string>;
  researchConnections?: { search: string[]; fetch: string[] };
  agent?: {
    modelConnectionId: string;
    strategyId: ContentPlanTemplateId;
    toolConnectionIds: string[];
    enhancementToolIds: string[];
    budget?: { maxTurns?: number };
  };
  publishing: { destinations: PublicationDestinationSelection[] };
}

export interface ChannelAccount extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  channel: string;
  /** Internal managed connection. Dashboard account flows do not ask users to manage it. */
  connectionId: string;
  settings: Record<string, WorkspaceJson>;
  connectorId?: string;
  credentialState?: Record<string, boolean>;
  /** Generic connector references used only by this account's channel publication ReAct. */
  publisher?: {
    toolConnectionIds: string[];
  };
}

export interface PublicationDestinationSelection {
  accountId: string;
  publicationType: string;
  options?: Record<string, WorkspaceJson>;
}

export type AutomationTrigger =
  | { type: "manual" }
  | { type: "schedule"; cron: string; timezone: string }
  | { type: "hotspot"; query: string; intervalMinutes: number }
  | { type: "api"; tokenName?: string };

export interface Automation extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  contentPlanId: string;
  instructions?: string;
  keywords: string[];
  trigger: AutomationTrigger;
}

export interface StoredContentPackage extends WorkspaceEntity {
  jobId: string;
  planId: string;
  contentPackage: ContentPackage;
}

/** HTTP view that resolves a content package back to its generation and publication runs. */
export interface ContentPackageRunContext {
  contentPackage: StoredContentPackage;
  generationRun?: RunRecord;
  publicationRuns: RunRecord[];
}

export interface StoredReviewRequest extends WorkspaceEntity {
  jobId: string;
  planId: string;
  status: "open" | "resolved" | "dismissed";
  request: ReviewRequest;
  resolvedPackageId?: string;
}

export interface StoredPublication extends WorkspaceEntity {
  jobId: string;
  packageId: string;
  batch: PublicationBatchResult;
}

/** Persisted workspace documents before HTTP-only runtime catalogs are attached. */
export interface WorkspaceDataSnapshot {
  automations: Automation[];
  identities: ContentIdentity[];
  knowledgeBases: KnowledgeBase[];
  sourceCollections: SourceCollection[];
  contentPlans: ContentPlan[];
  channelAccounts: ChannelAccount[];
  contentPackages: StoredContentPackage[];
  reviewRequests: StoredReviewRequest[];
  publications: StoredPublication[];
}

export interface ContentPlanTemplateDefinition {
  id: string;
  name: string;
  description: string;
  stages: string[];
}

export interface ChannelDefinition {
  id: string;
  name: string;
  description: string;
  connectorIds: string[];
  defaultPublicationType: string;
}

/** Complete JSON response body nested under `workspace` in GET /api/workspace. */
export interface WorkspaceSnapshot extends WorkspaceDataSnapshot {
  generatedAt: string;
  mode: "local" | "cloudflare";
  jobs: JobRecord[];
  connections: PublicConnection[];
  connectorDefinitions: PublicConnectorDefinition[];
  contentPlanTemplates: ContentPlanTemplateDefinition[];
  channelDefinitions: ChannelDefinition[];
  publicationTypeProfiles: PublicationTypeProfileDefinition[];
}

export type SaveIdentityPayload = Omit<ContentIdentity, keyof WorkspaceEntity> & {
  revision?: number;
};

export type SaveSourceCollectionPayload = Omit<
  SourceCollection,
  keyof WorkspaceEntity | "sources"
> & {
  revision?: number;
  sources: Array<
    | (Omit<Extract<SourceItem, { kind: "url" }>, "id"> & { id?: string })
    | (Omit<Extract<SourceItem, { kind: "query" }>, "id"> & { id?: string })
  >;
};

export type SaveKnowledgeBasePayload = Omit<KnowledgeBase, keyof WorkspaceEntity | "documents"> & {
  revision?: number;
  documents: Array<Omit<KnowledgeDocument, "id"> & { id?: string }>;
};

export type SaveContentPlanPayload = Omit<ContentPlan, keyof WorkspaceEntity> & {
  revision?: number;
};

export type SaveChannelAccountPayload = Pick<ChannelAccount, "name" | "enabled" | "channel"> & {
  revision?: number;
  connectorId: string;
  settings: Record<string, WorkspaceJson>;
  credentials?: Record<string, WorkspaceJson>;
  clearCredentials?: string[];
  publisher?: {
    toolConnectionIds: string[];
  };
};

export type SaveAutomationPayload = Omit<Automation, keyof WorkspaceEntity> & {
  revision?: number;
};
