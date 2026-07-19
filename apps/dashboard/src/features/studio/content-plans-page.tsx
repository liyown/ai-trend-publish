import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useAuth } from "../../app/auth.tsx";
import { useDashboardApi } from "../../app/providers.tsx";
import { useWorkspaceRefresh, useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { EntityList, EntityRow, StudioPage } from "./common.tsx";

export function ContentPlansPage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const { apiKey } = useAuth();
  const api = useDashboardApi();
  const refresh = useWorkspaceRefresh();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteContentPlan(apiKey, id),
    onSuccess: refresh,
  });
  const plans = workspace?.contentPlans ?? [];
  return (
    <StudioPage>
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
      >
        {plans.map((plan) => {
          const identity = workspace?.identities.find((item) => item.id === plan.identityId);
          const publishing = plan.publishing ?? { mode: "content_only" as const, targetIds: [] };
          return (
            <EntityRow
              key={plan.id}
              title={plan.name}
              description={`${identity?.name ?? "身份缺失"} · ${plan.knowledgeBaseIds?.length ?? 0} 个知识库 · ${plan.sourceCollectionIds.length} 个抓取源 · ${plan.plugins.filter((item) => item.enabled).length} 个插件 · ${publishing.mode === "publish" ? `${publishing.targetIds.length} 个发布目标` : "仅生成内容"}`}
              status={plan.enabled ? "ready" : "disabled"}
              onEdit={() =>
                navigate({ to: "/content-plans/$planId/edit", params: { planId: plan.id } })
              }
              onDelete={() => confirm(`删除“${plan.name}”？`) && remove.mutate(plan.id)}
            />
          );
        })}
      </EntityList>
    </StudioPage>
  );
}
