import type { ArticlePluginCapability, ContentPackage, ReviewRequest } from "./article.ts";
import type { PublicConnection, PublicConnectorDefinition } from "./connectors.ts";
import type { JobRecord } from "./execution.ts";
import type { JsonValue } from "./json.ts";
import type { PublicationBatchResult } from "./publishing.ts";

type ValueOf<T> = T[keyof T];

export const WorkspaceKind = {
  Automation: "automation",
  Identity: "identity",
  KnowledgeBase: "knowledge-base",
  SourceCollection: "source-collection",
  ContentPlan: "content-plan",
  ChannelAccount: "channel-account",
  PublishTarget: "publish-target",
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

export interface ArticlePluginSelection {
  pluginId: string;
  enabled: boolean;
  config?: WorkspaceJson;
}

export interface ContentPlan extends WorkspaceEntity {
  name: string;
  enabled: boolean;
  identityId: string;
  knowledgeBaseIds: string[];
  sourceCollectionIds: string[];
  plugins: ArticlePluginSelection[];
  connections: Record<string, string>;
  researchConnections?: { search: string[]; fetch: string[] };
  publishing: { mode: "content_only" | "publish"; targetIds: string[] };
}

export interface ChannelAccount extends WorkspaceEntity {
  name: string;
  channel: string;
  connectionId: string;
  settings: Record<string, WorkspaceJson>;
}

export interface PublishTarget extends WorkspaceEntity {
  name: string;
  channelAccountId: string;
  settings: Record<string, WorkspaceJson>;
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
  publishTargets: PublishTarget[];
  contentPackages: StoredContentPackage[];
  reviewRequests: StoredReviewRequest[];
  publications: StoredPublication[];
}

export interface ArticlePluginDefinition {
  id: string;
  name: string;
  description: string;
  capabilities: ArticlePluginCapability[];
  optional: boolean;
}

export interface ChannelDefinition {
  id: string;
  name: string;
  requiredCapability: string;
}

/** Complete JSON response body nested under `workspace` in GET /api/workspace. */
export interface WorkspaceSnapshot extends WorkspaceDataSnapshot {
  generatedAt: string;
  mode: "local" | "cloudflare";
  jobs: JobRecord[];
  connections: PublicConnection[];
  connectorDefinitions: PublicConnectorDefinition[];
  articleExtensions: { plugins: ArticlePluginDefinition[] };
  channelDefinitions: ChannelDefinition[];
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

export type SaveChannelAccountPayload = Omit<ChannelAccount, keyof WorkspaceEntity> & {
  revision?: number;
};

export type SavePublishTargetPayload = Omit<PublishTarget, keyof WorkspaceEntity> & {
  revision?: number;
};

export type SaveAutomationPayload = Omit<Automation, keyof WorkspaceEntity> & {
  revision?: number;
};
