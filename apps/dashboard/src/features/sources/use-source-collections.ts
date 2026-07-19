import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSourceCollections,
  createSourceCollection,
  updateSourceCollection,
  deleteSourceCollection,
} from "#platform/api/source-collections.ts";
import type { SaveSourceCollectionPayload } from "#platform/api/types.ts";

export const sourceCollectionsKey = () => ["source-collections"] as const;

export function useSourceCollections() {
  return useQuery({ queryKey: sourceCollectionsKey(), queryFn: listSourceCollections });
}

export function useDeleteSourceCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSourceCollection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceCollectionsKey() }),
  });
}

export function useSaveSourceCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveSourceCollectionPayload }) =>
      id ? updateSourceCollection(id, body) : createSourceCollection(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceCollectionsKey() }),
  });
}
