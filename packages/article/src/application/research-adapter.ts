import type {
  ArticleOperationContext,
  MaterialSnapshot,
  ResearchCandidate,
  ResearchFetchTool,
  ResearchSearchTool,
  ResearchTool,
} from "../extensions.ts";
import {
  SourceFetchCapability,
  SourceSearchCapability,
  type ConnectorClientResolver,
  type PublicConnection,
} from "@trendpublish/connectors";
import { fingerprint } from "@trendpublish/runtime";

export type ResearchCapability = "source-search" | "source-fetch";

export interface ConnectionResearchAdapterOptions {
  connection: Pick<PublicConnection, "id" | "revision" | "connectorId">;
  capability: ResearchCapability;
  connectors: ConnectorClientResolver;
}

/** Adapts one configured connection to one explicit research capability. */
export class ConnectionResearchAdapter {
  static create(options: ConnectionResearchAdapterOptions): ResearchTool {
    const id = `${options.capability}:${options.connection.id}`;
    const version = String(options.connection.revision);
    if (options.capability === "source-search") {
      return {
        capability: "search",
        id,
        version,
        search: (query, context) => search(options, query, context),
      } satisfies ResearchSearchTool;
    }
    return {
      capability: "fetch",
      id,
      version,
      fetch: (url, context) => fetch(options, url, context),
    } satisfies ResearchFetchTool;
  }
}

async function search(
  options: ConnectionResearchAdapterOptions,
  query: string,
  context: ArticleOperationContext,
): Promise<ResearchCandidate[]> {
  const client = await options.connectors.get(options.connection.id, SourceSearchCapability);
  return await client.search(
    { query },
    { signal: context.signal, traceId: context.task.jobId, taskId: context.task.taskId },
  );
}

async function fetch(
  options: ConnectionResearchAdapterOptions,
  url: string,
  context: ArticleOperationContext,
): Promise<MaterialSnapshot[]> {
  const connection = options.connection;
  const client = await options.connectors.get(connection.id, SourceFetchCapability);
  const documents = await client.fetch(url, {
    signal: context.signal,
    traceId: context.task.jobId,
    taskId: context.task.taskId,
  });
  return await Promise.all(
    documents.map(async (document, index): Promise<MaterialSnapshot> => {
      const retrievedAt = context.now().toISOString();
      const contentHash = await fingerprint({
        content: document.content,
        transcript: document.transcript,
        url: document.url,
        title: document.title,
      });
      return {
        id: `material:${connection.id}:${document.id || index}`,
        mediaType: document.mediaType ?? "webpage",
        title: document.title,
        sourceUrl: document.url,
        content: document.content,
        transcript: document.transcript,
        durationMs: document.durationMs,
        publishedAt: document.publishedAt,
        author: document.author,
        sourceName: document.sourceName,
        retrievedAt,
        contentHash,
        snapshotRef: `connector:${connection.id}:${document.id || index}`,
        metadata: {
          connectionId: connection.id,
          connectorId: connection.connectorId,
        },
      };
    }),
  );
}
