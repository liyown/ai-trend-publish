import type { TaskContext } from "@trendpublish/runtime";
import type {
  ArticleInput,
  ArticleView,
  AssetRequest,
  ContentAsset,
  ContentIdentitySnapshot,
  EditorialBrief,
  MaterialSnapshot,
  NoContent,
  WorkingArticle,
} from "./domain.ts";
import type { ContentReactAgentResult } from "./react-content-agent.ts";

export interface ArticleOperationContext {
  task: TaskContext;
  signal: AbortSignal;
  now(): Date;
}

export interface ArticleReactAgent {
  produce(input: ArticleInput, task: TaskContext): Promise<ContentReactAgentResult>;
}

export type ResearchSource = { type: "query"; query: string } | { type: "url"; url: string };

export interface ConfiguredResearchSeed {
  id: string;
  label?: string;
  source: ResearchSource;
}

interface ResearchToolBase {
  id: string;
  version: string;
}

/** Connector-neutral URL discovery capability supplied by the application layer. */
export interface ResearchSearchTool extends ResearchToolBase {
  capability: "search";
  search(query: string, context: ArticleOperationContext): Promise<ResearchCandidate[]>;
}

/** Connector-neutral source retrieval capability supplied by the application layer. */
export interface ResearchFetchTool extends ResearchToolBase {
  capability: "fetch";
  fetch(url: string, context: ArticleOperationContext): Promise<MaterialSnapshot[]>;
}

/** One research plugin product may expose any number of explicit search/fetch capabilities. */
export type ResearchTool = ResearchSearchTool | ResearchFetchTool;

/** Search output used only to discover URLs; never valid as evidence by itself. */
export interface ResearchCandidate {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  author?: string;
  sourceName?: string;
}

export type ResearchOutcome =
  | { kind: "brief"; brief: EditorialBrief }
  | { kind: "no-content"; noContent: NoContent };

export interface ArticleResearcher {
  id: string;
  version: string;
  research(input: ArticleInput, context: ArticleOperationContext): Promise<ResearchOutcome>;
}

export interface ArticleWriter {
  id: string;
  version: string;
  compose(
    input: {
      brief: Readonly<EditorialBrief>;
      identity: Readonly<ContentIdentitySnapshot>;
      request: Readonly<ArticleInput>;
    },
    context: ArticleOperationContext,
  ): Promise<WorkingArticle>;
}

/** Content-changing plugin. It returns source, never document AST. */
export interface ArticleTransformer {
  id: string;
  version: string;
  transform(
    input: {
      article: Readonly<WorkingArticle>;
      view: Readonly<ArticleView>;
      brief: Readonly<EditorialBrief>;
      identity: Readonly<ContentIdentitySnapshot>;
    },
    context: ArticleOperationContext,
  ): Promise<WorkingArticle>;
}

/** Resolves one production intent into one completed resource. */
export interface AssetProvider {
  id: string;
  version: string;
  provide(
    input: {
      request: Readonly<AssetRequest>;
      article: Readonly<WorkingArticle>;
      view: Readonly<ArticleView>;
      brief: Readonly<EditorialBrief>;
      identity: Readonly<ContentIdentitySnapshot>;
    },
    context: ArticleOperationContext,
  ): Promise<ContentAsset>;
}
