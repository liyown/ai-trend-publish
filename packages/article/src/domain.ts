import type {
  ArticleAssetRequestNode,
  ArticleRootNode,
  ContentDiagnostic,
  MaterialReference,
  MaterialSnapshot,
} from "@trendpublish/contracts";

export * from "@trendpublish/contracts/article";

/** Ephemeral AST view used by deterministic compilation and asset production. */
export interface ArticleView {
  sourceHash: string;
  title: string;
  digest: string;
  root: ArticleRootNode<ArticleAssetRequestNode>;
  evidenceIds: string[];
  assetRequestIds: string[];
}

export function materialReference(snapshot: MaterialSnapshot): MaterialReference {
  return {
    id: snapshot.id,
    mediaType: snapshot.mediaType,
    title: snapshot.title,
    sourceUrl: snapshot.sourceUrl,
    publishedAt: snapshot.publishedAt,
    author: snapshot.author,
    sourceName: snapshot.sourceName,
    retrievedAt: snapshot.retrievedAt,
    contentHash: snapshot.contentHash,
    snapshotRef: snapshot.snapshotRef,
  };
}

export function isBlockingDiagnostic(diagnostic: ContentDiagnostic): boolean {
  return diagnostic.severity === "error" || diagnostic.severity === "blocker";
}
