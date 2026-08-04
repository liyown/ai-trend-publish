import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContentPlan,
  deleteContentPlan,
  listContentPlans,
  updateContentPlan,
} from "#platform/api/content-plans.ts";
import type { ContentPlan, SaveContentPlanPayload } from "#platform/api/types.ts";
import { DefaultContentPlanTemplateId } from "#platform/api/types.ts";
import { Copy, Eye, Plus } from "lucide-react";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { Pagination } from "#components/ui/pagination.tsx";

const PAGE_SIZE = 20;

export const contentPlansKey = () => ["content-plans"] as const;

export function useContentPlans(page = 1) {
  return useQuery({
    queryKey: [...contentPlansKey(), page] as const,
    queryFn: () => listContentPlans(page, PAGE_SIZE),
  });
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

function useDuplicateContentPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: ContentPlan) =>
      createContentPlan({
        name: `${plan.name} (副本)`,
        enabled: false,
        templateId: plan.templateId ?? DefaultContentPlanTemplateId,
        identityId: plan.identityId,
        knowledgeBaseIds: plan.knowledgeBaseIds ?? [],
        sourceCollectionIds: plan.sourceCollectionIds,
        connections: { ...plan.connections },
        researchConnections: plan.researchConnections ?? { search: [], fetch: [] },
        agent: plan.agent
          ? {
              ...plan.agent,
              toolConnectionIds: [...plan.agent.toolConnectionIds],
              enhancementToolIds: [...plan.agent.enhancementToolIds],
              budget: plan.agent.budget ? { ...plan.agent.budget } : undefined,
            }
          : undefined,
        publishing: { ...plan.publishing },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: contentPlansKey() }),
  });
}

export const Route = createFileRoute("/_app/content-plans")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Number(search["page"] ?? 1) || 1,
  }),
  component: ContentPlansPage,
});

function ContentPlansPage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useContentPlans(page);
  const remove = useDeleteContentPlan();
  const duplicate = useDuplicateContentPlan();
  const plans = data?.items ?? [];
  return (
    <PageGrid>
      <EntityList
        title="内容方案"
        description="一个方案完整描述一次内容生产：使用谁的身份、参考什么、如何生成，以及生成后去哪里。"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate({ to: "/content-plans/new" })}
          >
            <Plus className="size-4" />
            新建方案
          </Button>
        }
        empty={!plans.length}
        emptyTitle="还没有内容方案"
        emptyDescription="创建方案后，任务只需要选择方案和触发方式。"
        pagination={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onChange={(p) => navigate({ search: (previous) => ({ ...previous, page: p }) })}
          />
        }
      >
        {plans.map((plan) => {
          const identity = workspace?.identities.find((item) => item.id === plan.identityId);
          const template = workspace?.contentPlanTemplates.find(
            (item) => item.id === (plan.templateId ?? DefaultContentPlanTemplateId),
          );
          const destinations = plan.publishing?.destinations ?? [];
          return (
            <EntityRow
              key={plan.id}
              title={plan.name}
              description={`${identity?.name ?? "身份缺失"} · ${template?.name ?? "每日资讯解读"} · ${plan.knowledgeBaseIds?.length ?? 0} 个知识库 · ${plan.sourceCollectionIds.length} 个输入来源 · ${destinations.length ? `${destinations.length} 个发布目的地` : "仅生成内容包"}`}
              status={plan.enabled ? "ready" : "disabled"}
              onDelete={() => confirm(`删除"${plan.name}"？`) && remove.mutate(plan.id)}
            >
              <Button
                variant="ghost"
                onClick={() =>
                  navigate({ to: "/content-plans/$planId/edit", params: { planId: plan.id } })
                }
              >
                <Eye className="size-3.5" />
                查看
              </Button>
              <Button
                variant="ghost"
                loading={duplicate.isPending && duplicate.variables?.id === plan.id}
                onClick={() => duplicate.mutate(plan)}
              >
                <Copy className="size-3.5" />
                复制
              </Button>
            </EntityRow>
          );
        })}
      </EntityList>
    </PageGrid>
  );
}
