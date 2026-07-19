import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listContentPlans,
  createContentPlan,
  updateContentPlan,
  deleteContentPlan,
} from "#platform/api/content-plans.ts";
import type { SaveContentPlanPayload } from "#platform/api/types.ts";

export const contentPlansKey = () => ["content-plans"] as const;

export function useContentPlans() {
  return useQuery({ queryKey: contentPlansKey(), queryFn: listContentPlans });
}

export function useDeleteContentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContentPlan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentPlansKey() }),
  });
}

export function useSaveContentPlan(planId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveContentPlanPayload) =>
      planId ? updateContentPlan(planId, body) : createContentPlan(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentPlansKey() }),
  });
}
