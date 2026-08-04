import { apiJson, mutation } from "./http.ts";
import type { ChannelAccount, ConnectorCheckResult, SaveChannelAccountPayload } from "./types.ts";

export const listChannelAccounts = () =>
  apiJson<{ channelAccounts: ChannelAccount[] }>("/api/channel-accounts");

export const getChannelAccount = (id: string) =>
  apiJson<{ channelAccount: ChannelAccount }>(`/api/channel-accounts/${encodeURIComponent(id)}`);

export const createChannelAccount = (body: SaveChannelAccountPayload) =>
  mutation<{ channelAccount: ChannelAccount }>("/api/channel-accounts", "POST", body);

export const updateChannelAccount = (id: string, body: SaveChannelAccountPayload) =>
  mutation<{ channelAccount: ChannelAccount }>(
    `/api/channel-accounts/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );

export const deleteChannelAccount = (id: string) =>
  mutation<{ success: boolean }>(`/api/channel-accounts/${encodeURIComponent(id)}`, "DELETE");

export const testChannelAccount = (body: SaveChannelAccountPayload, accountId?: string) =>
  mutation<{ test: ConnectorCheckResult }>("/api/channel-accounts/test", "POST", {
    ...body,
    accountId,
  });
