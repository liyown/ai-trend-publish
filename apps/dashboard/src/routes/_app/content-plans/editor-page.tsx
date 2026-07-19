import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Bug, ScrollText, Settings2 } from "lucide-react";
import type { SaveContentPlanPayload } from "#platform/api/types.ts";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContentPlan, updateContentPlan } from "#platform/api/content-plans.ts";
import { Button } from "#components/ui/button.tsx";
import { Tabs } from "#components/ui/tabs.tsx";
import { capabilityConnections, ConfigView, type SectionId } from "./editor/config-view.tsx";
import { ContentPlanDebugView, PlanRunHistoryView } from "./editor/plan-runtime-views.tsx";
import { applyChannelRequirements, requiresWeixinCover } from "./editor/requirements.ts";

type EditorView = "config" | "debug" | "runs";

function emptyPlan(): SaveContentPlanPayload {
  return {
    name: "",
    enabled: true,
    identityId: "",
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    plugins: [],
    connections: {},
    researchConnections: { search: [], fetch: [] },
    publishing: { mode: "content_only", targetIds: [] },
  };
}

function useSaveContentPlan(planId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveContentPlanPayload) =>
      planId ? updateContentPlan(planId, body) : createContentPlan(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-plans"] }),
  });
}

export function ContentPlanEditorPage() {
  const params = useParams({ strict: false }) as { planId?: string };
  const planId = params.planId;
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const save = useSaveContentPlan(planId);
  const navigate = useNavigate();
  const [view, setView] = useState<EditorView>("config");
  const [section, setSection] = useState<SectionId>("basic");
  const [form, setForm] = useState<SaveContentPlanPayload>(emptyPlan);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState<Error | null>(null);
  const hydratedEditorKey = useRef<string | null>(null);
  const plan = workspace?.contentPlans.find((item) => item.id === planId);

  useEffect(() => {
    if (!workspace) return;
    const editorKey = planId ?? "__new__";
    if (hydratedEditorKey.current === editorKey) return;
    if (planId && !plan) return;
    if (planId && plan) {
      setForm(
        applyChannelRequirements(
          {
            ...plan,
            revision: plan.revision,
            knowledgeBaseIds: plan.knowledgeBaseIds ?? [],
            researchConnections: plan.researchConnections ?? { search: [], fetch: [] },
            publishing: plan.publishing ?? { mode: "content_only", targetIds: [] },
            plugins: structuredClone(plan.plugins),
          },
          workspace,
        ),
      );
    } else if (!planId) {
      const next = emptyPlan();
      next.identityId = workspace.identities.find((item) => item.enabled)?.id ?? "";
      next.connections.chat = capabilityConnections(workspace, "chat")[0]?.id ?? "";
      setForm(next);
    }
    hydratedEditorKey.current = editorKey;
    setDirty(false);
  }, [workspace, plan, planId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (next: SaveContentPlanPayload) => {
    setForm(workspace ? applyChannelRequirements(next, workspace) : next);
    setDirty(true);
    setValidationError(null);
  };
  const cancel = () => {
    if (!dirty || confirm("放弃尚未保存的修改？")) void navigate({ to: "/content-plans" });
  };
  const requestSave = () => {
    setView("config");
    if (!form.name.trim()) {
      setSection("basic");
      setValidationError(new Error("请填写方案名称"));
      return;
    }
    if (!form.connections.chat) {
      setSection("basic");
      setValidationError(new Error("请选择生成模型连接"));
      return;
    }
    if (!form.identityId) {
      setSection("identity");
      setValidationError(new Error("请添加内容身份"));
      return;
    }
    if (form.publishing.mode === "publish" && !form.publishing.targetIds.length) {
      setSection("publishing");
      setValidationError(new Error("发布模式至少需要添加一个发布目标"));
      return;
    }
    if (workspace && requiresWeixinCover(form, workspace) && !form.connections.image) {
      setSection("plugins");
      setValidationError(new Error("微信公众号发布需要先选择封面图片连接"));
      return;
    }
    setValidationError(null);
    save.mutate(form, {
      onSuccess: () => {
        setDirty(false);
        void navigate({ to: "/content-plans" });
      },
    });
  };

  if (planId && workspace && !plan)
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-8 text-sm">
        内容方案不存在或已被删除。
      </div>
    );

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onChange={setView}
          className="w-fit"
          items={[
            { value: "config", label: "配置", icon: <Settings2 className="size-3.5" /> },
            { value: "debug", label: "调试", icon: <Bug className="size-3.5" /> },
            { value: "runs", label: "运行记录", icon: <ScrollText className="size-3.5" /> },
          ]}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={cancel}>
            取消
          </Button>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={requestSave}>
            保存方案
          </Button>
        </div>
      </div>

      {view === "config" ? (
        <ConfigView
          section={section}
          onSectionChange={setSection}
          form={form}
          update={update}
          workspace={workspace}
          error={validationError ?? save.error}
        />
      ) : view === "debug" ? (
        <ContentPlanDebugView planId={planId} dirty={dirty} />
      ) : (
        <PlanRunHistoryView planId={planId} jobs={workspace?.jobs ?? []} />
      )}
    </section>
  );
}
