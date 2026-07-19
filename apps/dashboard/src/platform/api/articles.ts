import { mutation } from "./http.ts";
import type { ArticleSource, AssetRequest, JobRecord } from "./types.ts";

export const startArticleGeneration = (body: { planId: string; requestedTopic?: string }) =>
  mutation<{ job: JobRecord }>("/api/articles", "POST", body);

export const submitEditedArticle = (body: {
  planId: string;
  source: ArticleSource;
  assetRequests: AssetRequest[];
  reviewRequestId: string;
}) => mutation<{ job: JobRecord }>("/api/articles/complete", "POST", body);

export const startPublication = (body: { packageId: string; targetIds: string[] }) =>
  mutation<{ job: JobRecord }>("/api/publications", "POST", body);
