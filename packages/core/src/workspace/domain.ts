import type { WorkspaceEntity } from "@trendpublish/contracts";

export type {
  ArticlePluginSelection,
  Automation,
  AutomationTrigger,
  ChannelAccount,
  ContentIdentity,
  ContentPlan,
  KnowledgeBase,
  KnowledgeDocument,
  PublicationDestinationSelection,
  SourceCollection,
  SourceItem,
  StoredContentPackage,
  StoredPublication,
  StoredReviewRequest,
  WorkspaceDataSnapshot,
  WorkspaceEntity,
  WorkspaceJson,
  WorkspaceSnapshot,
} from "@trendpublish/contracts/workspace";

export function createWorkspaceEntity<
  T extends Omit<WorkspaceEntity, "revision" | "createdAt" | "updatedAt">,
>(value: T, now = new Date()): T & WorkspaceEntity {
  const timestamp = now.toISOString();
  return { ...structuredClone(value), revision: 1, createdAt: timestamp, updatedAt: timestamp };
}

export function reviseWorkspaceEntity<T extends WorkspaceEntity>(
  current: T,
  patch: Omit<T, keyof WorkspaceEntity>,
  now = new Date(),
): T {
  return {
    ...structuredClone(current),
    ...structuredClone(patch),
    id: current.id,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: now.toISOString(),
  };
}
