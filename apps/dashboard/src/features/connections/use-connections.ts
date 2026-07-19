import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
} from "#platform/api/connections.ts";
import type { SaveConnectionPayload } from "#platform/api/types.ts";

export const connectionsKey = () => ["connections"] as const;

export function useConnections() {
  return useQuery({ queryKey: connectionsKey(), queryFn: listConnections });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionsKey() }),
  });
}

export function useSaveConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveConnectionPayload }) =>
      id ? updateConnection(id, body) : createConnection(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectionsKey() }),
  });
}

export function useTestConnection() {
  return useMutation({ mutationFn: (body: SaveConnectionPayload) => testConnection(body) });
}
