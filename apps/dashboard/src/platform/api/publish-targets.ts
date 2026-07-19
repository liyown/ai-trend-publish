import { apiJson, mutation } from "./http.ts";
import type { PublishTarget, SavePublishTargetPayload } from "./types.ts";

export const listPublishTargets = () =>
  apiJson<{ publishTargets: PublishTarget[] }>("/api/publish-targets");

export const getPublishTarget = (id: string) =>
  apiJson<{ publishTarget: PublishTarget }>(`/api/publish-targets/${encodeURIComponent(id)}`);

export const createPublishTarget = (body: SavePublishTargetPayload) =>
  mutation<{ publishTarget: PublishTarget }>("/api/publish-targets", "POST", body);

export const updatePublishTarget = (id: string, body: SavePublishTargetPayload) =>
  mutation<{ publishTarget: PublishTarget }>(
    `/api/publish-targets/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );

export const deletePublishTarget = (id: string) =>
  mutation<{ success: boolean }>(`/api/publish-targets/${encodeURIComponent(id)}`, "DELETE");
