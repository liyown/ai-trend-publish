import { apiJson, mutation } from "./http.ts";
import type { ContentIdentity, SaveIdentityPayload } from "./types.ts";

export const listIdentities = () => apiJson<{ identities: ContentIdentity[] }>("/api/identities");

export const getIdentity = (id: string) =>
  apiJson<{ identity: ContentIdentity }>(`/api/identities/${encodeURIComponent(id)}`);

export const createIdentity = (body: SaveIdentityPayload) =>
  mutation<{ identity: ContentIdentity }>("/api/identities", "POST", body);

export const updateIdentity = (id: string, body: SaveIdentityPayload) =>
  mutation<{ identity: ContentIdentity }>(
    `/api/identities/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );

export const deleteIdentity = (id: string) =>
  mutation<{ success: boolean }>(`/api/identities/${encodeURIComponent(id)}`, "DELETE");
