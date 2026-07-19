import { WorkspaceKind, type WorkspaceKind as WorkspaceKindValue } from "@trendpublish/contracts";
import type {
  Automation,
  ContentPlan,
  ChannelAccount,
  ContentIdentity,
  KnowledgeBase,
  PublishTarget,
  SourceCollection,
  StoredContentPackage,
  StoredReviewRequest,
  StoredPublication,
  WorkspaceDataSnapshot,
} from "./domain.ts";

export type WorkspaceDocumentKind = WorkspaceKindValue;

export interface WorkspaceDocumentMap {
  [WorkspaceKind.Automation]: Automation;
  [WorkspaceKind.Identity]: ContentIdentity;
  [WorkspaceKind.KnowledgeBase]: KnowledgeBase;
  [WorkspaceKind.SourceCollection]: SourceCollection;
  [WorkspaceKind.ContentPlan]: ContentPlan;
  [WorkspaceKind.ChannelAccount]: ChannelAccount;
  [WorkspaceKind.PublishTarget]: PublishTarget;
  [WorkspaceKind.ContentPackage]: StoredContentPackage;
  [WorkspaceKind.ReviewRequest]: StoredReviewRequest;
  [WorkspaceKind.Publication]: StoredPublication;
}

export interface WorkspaceRepository {
  ensureSchema(): Promise<void>;
  list<K extends WorkspaceDocumentKind>(kind: K): Promise<WorkspaceDocumentMap[K][]>;
  get<K extends WorkspaceDocumentKind>(
    kind: K,
    id: string,
  ): Promise<WorkspaceDocumentMap[K] | null>;
  save<K extends WorkspaceDocumentKind>(
    kind: K,
    value: WorkspaceDocumentMap[K],
  ): Promise<WorkspaceDocumentMap[K]>;
  remove(kind: WorkspaceDocumentKind, id: string): Promise<boolean>;
}

export async function loadWorkspaceSnapshot(
  repository: WorkspaceRepository,
): Promise<WorkspaceDataSnapshot> {
  const [
    automations,
    identities,
    knowledgeBases,
    sourceCollections,
    contentPlans,
    channelAccounts,
    publishTargets,
    contentPackages,
    reviewRequests,
    publications,
  ] = await Promise.all([
    repository.list(WorkspaceKind.Automation),
    repository.list(WorkspaceKind.Identity),
    repository.list(WorkspaceKind.KnowledgeBase),
    repository.list(WorkspaceKind.SourceCollection),
    repository.list(WorkspaceKind.ContentPlan),
    repository.list(WorkspaceKind.ChannelAccount),
    repository.list(WorkspaceKind.PublishTarget),
    repository.list(WorkspaceKind.ContentPackage),
    repository.list(WorkspaceKind.ReviewRequest),
    repository.list(WorkspaceKind.Publication),
  ]);
  return {
    automations,
    identities,
    knowledgeBases,
    sourceCollections,
    contentPlans,
    channelAccounts,
    publishTargets,
    contentPackages,
    reviewRequests,
    publications,
  };
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly documents = new Map<string, WorkspaceDocumentMap[WorkspaceDocumentKind]>();

  constructor(initial: Partial<WorkspaceDataSnapshot> = {}) {
    for (const [kind, values] of [
      [WorkspaceKind.Automation, initial.automations],
      [WorkspaceKind.Identity, initial.identities],
      [WorkspaceKind.KnowledgeBase, initial.knowledgeBases],
      [WorkspaceKind.SourceCollection, initial.sourceCollections],
      [WorkspaceKind.ContentPlan, initial.contentPlans],
      [WorkspaceKind.ChannelAccount, initial.channelAccounts],
      [WorkspaceKind.PublishTarget, initial.publishTargets],
      [WorkspaceKind.ContentPackage, initial.contentPackages],
      [WorkspaceKind.ReviewRequest, initial.reviewRequests],
      [WorkspaceKind.Publication, initial.publications],
    ] as const) {
      for (const value of values ?? [])
        this.documents.set(key(kind, value.id), structuredClone(value));
    }
  }

  ensureSchema(): Promise<void> {
    return Promise.resolve();
  }

  list<K extends WorkspaceDocumentKind>(kind: K): Promise<WorkspaceDocumentMap[K][]> {
    return Promise.resolve(
      [...this.documents.entries()]
        .filter(([documentKey]) => documentKey.startsWith(`${kind}:`))
        .map(([, value]) => structuredClone(value) as WorkspaceDocumentMap[K])
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  get<K extends WorkspaceDocumentKind>(
    kind: K,
    id: string,
  ): Promise<WorkspaceDocumentMap[K] | null> {
    const value = this.documents.get(key(kind, id));
    return Promise.resolve(value ? (structuredClone(value) as WorkspaceDocumentMap[K]) : null);
  }

  save<K extends WorkspaceDocumentKind>(
    kind: K,
    value: WorkspaceDocumentMap[K],
  ): Promise<WorkspaceDocumentMap[K]> {
    const current = this.documents.get(key(kind, value.id));
    if (current && value.revision <= current.revision) {
      throw new WorkspaceRevisionConflictError(kind, value.id, current.revision, value.revision);
    }
    this.documents.set(key(kind, value.id), structuredClone(value));
    return Promise.resolve(structuredClone(value));
  }

  remove(kind: WorkspaceDocumentKind, id: string): Promise<boolean> {
    return Promise.resolve(this.documents.delete(key(kind, id)));
  }
}

export class WorkspaceRevisionConflictError extends Error {
  constructor(
    readonly kind: WorkspaceDocumentKind,
    readonly id: string,
    readonly storedRevision: number,
    readonly attemptedRevision: number,
  ) {
    super(`对象 ${kind}/${id} 已更新（当前版本 ${storedRevision}，提交版本 ${attemptedRevision}）`);
    this.name = "WorkspaceRevisionConflictError";
  }
}

function key(kind: WorkspaceDocumentKind, id: string): string {
  return `${kind}:${id}`;
}
