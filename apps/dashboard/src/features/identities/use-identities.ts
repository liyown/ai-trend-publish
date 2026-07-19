import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listIdentities,
  createIdentity,
  updateIdentity,
  deleteIdentity,
} from "#platform/api/identities.ts";
import type { SaveIdentityPayload } from "#platform/api/types.ts";

export const identitiesKey = () => ["identities"] as const;

export function useIdentities() {
  return useQuery({ queryKey: identitiesKey(), queryFn: listIdentities });
}

export function useDeleteIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteIdentity(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: identitiesKey() }),
  });
}

export function useSaveIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveIdentityPayload }) =>
      id ? updateIdentity(id, body) : createIdentity(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: identitiesKey() }),
  });
}
