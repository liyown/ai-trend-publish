import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listKnowledgeBases,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from "#platform/api/knowledge-bases.ts";
import type { SaveKnowledgeBasePayload } from "#platform/api/types.ts";

export const knowledgeBasesKey = () => ["knowledge-bases"] as const;

export function useKnowledgeBases() {
  return useQuery({ queryKey: knowledgeBasesKey(), queryFn: listKnowledgeBases });
}

export function useDeleteKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeBase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: knowledgeBasesKey() }),
  });
}

export function useSaveKnowledgeBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveKnowledgeBasePayload }) =>
      id ? updateKnowledgeBase(id, body) : createKnowledgeBase(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: knowledgeBasesKey() }),
  });
}
