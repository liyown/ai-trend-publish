import { apiJson, mutation } from "./http.ts";
import type {
  ContentPackageRunContext,
  JobRecord,
  PublicationDestinationSelection,
  RunRecord,
} from "./types.ts";

export const startArticleGeneration = (body: { planId: string; requestedTopic?: string }) =>
  mutation<{ job: JobRecord; run: RunRecord }>("/api/articles", "POST", body);

export const startPublication = (body: {
  packageId: string;
  destinations: PublicationDestinationSelection[];
}) => mutation<{ job: JobRecord; run: RunRecord }>("/api/publications", "POST", body);

export const contentPackageRunContextKey = (packageId: string | undefined) =>
  ["content-packages", packageId, "run-context"] as const;

export const getContentPackageRunContext = (packageId: string) =>
  apiJson<ContentPackageRunContext>(
    `/api/content-packages/${encodeURIComponent(packageId)}/run-context`,
  );
