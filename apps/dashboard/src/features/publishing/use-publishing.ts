import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listChannelAccounts,
  createChannelAccount,
  updateChannelAccount,
  deleteChannelAccount,
} from "#platform/api/channel-accounts.ts";
import {
  listPublishTargets,
  createPublishTarget,
  updatePublishTarget,
  deletePublishTarget,
} from "#platform/api/publish-targets.ts";
import type { SaveChannelAccountPayload, SavePublishTargetPayload } from "#platform/api/types.ts";

export const channelAccountsKey = () => ["channel-accounts"] as const;
export const publishTargetsKey = () => ["publish-targets"] as const;

export function useChannelAccounts() {
  return useQuery({ queryKey: channelAccountsKey(), queryFn: listChannelAccounts });
}

export function useDeleteChannelAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChannelAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelAccountsKey() }),
  });
}

export function useSaveChannelAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveChannelAccountPayload }) =>
      id ? updateChannelAccount(id, body) : createChannelAccount(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelAccountsKey() }),
  });
}

export function usePublishTargets() {
  return useQuery({ queryKey: publishTargetsKey(), queryFn: listPublishTargets });
}

export function useDeletePublishTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePublishTarget(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: publishTargetsKey() }),
  });
}

export function useSavePublishTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SavePublishTargetPayload }) =>
      id ? updatePublishTarget(id, body) : createPublishTarget(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: publishTargetsKey() }),
  });
}
