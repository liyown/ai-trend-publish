import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  startAutomationRun,
} from "#platform/api/automations.ts";
import type { SaveAutomationPayload } from "#platform/api/types.ts";

export const automationsKey = () => ["automations"] as const;

export function useAutomations() {
  return useQuery({ queryKey: automationsKey(), queryFn: listAutomations });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: automationsKey() }),
  });
}

export function useSaveAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveAutomationPayload }) =>
      id ? updateAutomation(id, body) : createAutomation(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: automationsKey() }),
  });
}

export function useStartAutomationRun() {
  return useMutation({
    mutationFn: ({ id, body = {} }: { id: string; body?: { requestedTopic?: string } }) =>
      startAutomationRun(id, body),
  });
}
