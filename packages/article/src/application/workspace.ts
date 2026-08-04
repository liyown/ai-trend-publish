import {
  WorkspaceKind,
  type ContentIdentity,
  type ContentPlan,
  type KnowledgeBase,
  type SourceCollection,
  type StoredContentPackage,
  type StoredReviewRequest,
  type WorkspaceEntity,
} from "@trendpublish/contracts";
import { stableStringify } from "@trendpublish/runtime";

export type {
  ContentIdentity,
  ContentPlan,
  KnowledgeBase,
  SourceCollection,
  StoredContentPackage,
  StoredReviewRequest,
};

interface ArticleWorkspaceDocumentMap {
  [WorkspaceKind.Identity]: ContentIdentity;
  [WorkspaceKind.KnowledgeBase]: KnowledgeBase;
  [WorkspaceKind.SourceCollection]: SourceCollection;
  [WorkspaceKind.ContentPlan]: ContentPlan;
  [WorkspaceKind.ChannelAccount]: import("@trendpublish/contracts").ChannelAccount;
  [WorkspaceKind.ContentPackage]: StoredContentPackage;
  [WorkspaceKind.ReviewRequest]: StoredReviewRequest;
}

type ArticleWorkspaceKind = keyof ArticleWorkspaceDocumentMap;

/** Narrow workspace port used by the article application boundary. */
export interface WorkspaceRepository {
  list<K extends ArticleWorkspaceKind>(kind: K): Promise<ArticleWorkspaceDocumentMap[K][]>;
  get<K extends ArticleWorkspaceKind>(
    kind: K,
    id: string,
  ): Promise<ArticleWorkspaceDocumentMap[K] | null>;
  save<K extends ArticleWorkspaceKind>(
    kind: K,
    value: ArticleWorkspaceDocumentMap[K],
  ): Promise<ArticleWorkspaceDocumentMap[K]>;
}

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

export async function saveFinalArtifact<K extends ArticleWorkspaceKind>(
  workspace: WorkspaceRepository,
  kind: K,
  candidate: ArticleWorkspaceDocumentMap[K],
): Promise<ArticleWorkspaceDocumentMap[K]> {
  const existing = await workspace.get(kind, candidate.id);
  if (existing) {
    if (sameArtifact(existing, candidate)) return existing;
    throw new Error(
      `对象 ${kind}/${candidate.id} 已更新（当前版本 ${existing.revision}，提交版本 ${candidate.revision}）`,
    );
  }

  try {
    return await workspace.save(kind, candidate);
  } catch (error) {
    const committed = await workspace.get(kind, candidate.id);
    if (committed && sameArtifact(committed, candidate)) return committed;
    throw error;
  }
}

function sameArtifact(left: WorkspaceEntity, right: WorkspaceEntity): boolean {
  return stableStringify(artifactPayload(left)) === stableStringify(artifactPayload(right));
}

function artifactPayload(value: WorkspaceEntity): unknown {
  const { revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = value;
  return payload;
}
