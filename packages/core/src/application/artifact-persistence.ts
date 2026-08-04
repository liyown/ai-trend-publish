import { stableStringify } from "@trendpublish/runtime";
import {
  WorkspaceRevisionConflictError,
  type WorkspaceDocumentKind,
  type WorkspaceDocumentMap,
  type WorkspaceRepository,
} from "../workspace/repository.ts";

/**
 * Final artifacts are immutable checkpoints. A process may commit one and crash
 * before it marks the owning job as finished, so replay must accept the exact
 * same payload without turning normal workspace updates into last-write-wins.
 */
export async function saveFinalArtifact<K extends WorkspaceDocumentKind>(
  workspace: WorkspaceRepository,
  kind: K,
  candidate: WorkspaceDocumentMap[K],
): Promise<WorkspaceDocumentMap[K]> {
  const existing = await workspace.get(kind, candidate.id);
  if (existing)
    return sameArtifact(existing, candidate) ? existing : conflict(kind, existing, candidate);

  try {
    return await workspace.save(kind, candidate);
  } catch (error) {
    // Also cover transports that committed the write but lost the response.
    const committed = await workspace.get(kind, candidate.id);
    if (committed && sameArtifact(committed, candidate)) return committed;
    throw error;
  }
}

function sameArtifact<K extends WorkspaceDocumentKind>(
  left: WorkspaceDocumentMap[K],
  right: WorkspaceDocumentMap[K],
): boolean {
  return stableStringify(artifactPayload(left)) === stableStringify(artifactPayload(right));
}

function artifactPayload(value: WorkspaceDocumentMap[WorkspaceDocumentKind]): unknown {
  const { revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = value;
  return payload;
}

function conflict<K extends WorkspaceDocumentKind>(
  kind: K,
  existing: WorkspaceDocumentMap[K],
  candidate: WorkspaceDocumentMap[K],
): never {
  throw new WorkspaceRevisionConflictError(
    kind,
    candidate.id,
    existing.revision,
    candidate.revision,
  );
}
