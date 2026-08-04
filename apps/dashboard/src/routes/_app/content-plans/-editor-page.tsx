import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Play, ScrollText, Settings2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DefaultContentPlanTemplateId, type SaveContentPlanPayload } from "#platform/api/types.ts";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContentPlan, updateContentPlan } from "#platform/api/content-plans.ts";
import { startArticleGeneration } from "#platform/api/articles.ts";
import { Button } from "#components/ui/button.tsx";
import { Tabs } from "#components/ui/tabs.tsx";
import { capabilityConnections, ConfigView, type SectionId } from "./editor/-config-view.tsx";
import { PlanRunHistoryView } from "./editor/-plan-runtime-views.tsx";
import { Route as AppRoute } from "../../_app.tsx";

type EditorView = "config" | "runs";

function emptyPlan(): SaveContentPlanPayload {
  return {
    name: "",
    enabled: true,
    templateId: DefaultContentPlanTemplateId,
    identityId: "",
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    connections: {},
    researchConnections: { search: [], fetch: [] },
    agent: {
      modelConnectionId: "",
      strategyId: DefaultContentPlanTemplateId,
      toolConnectionIds: [],
      enhancementToolIds: [],
    },
    publishing: { destinations: [] },
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
  const routePlanId = params.planId;
  const [createdPlanId, setCreatedPlanId] = useState<string | undefined>();
  const planId = routePlanId ?? createdPlanId;
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const save = useSaveContentPlan(planId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = AppRoute.useSearch();
  const view: EditorView = search.tab === "runs" ? "runs" : "config";
  const section = contentPlanSection(search.panel);
  const [viewDirection, setViewDirection] = useState(1);
  const [form, setForm] = useState<SaveContentPlanPayload>(emptyPlan);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState<Error | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const hydratedEditorKey = useRef<string | null>(null);
  const plan = workspace?.contentPlans.find((item) => item.id === planId);
  const run = useMutation({
    mutationFn: (id: string) => startArticleGeneration({ planId: id }),
    onSuccess: (data) => {
      setStartedRunId(data.run.id);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  useEffect(() => {
    if (!workspace) return;
    const editorKey = planId ?? "__new__";
    if (hydratedEditorKey.current === editorKey) return;
    if (planId && !plan) return;
    if (planId && plan) {
      setForm({
        ...plan,
        revision: plan.revision,
        templateId: plan.templateId ?? DefaultContentPlanTemplateId,
        knowledgeBaseIds: plan.knowledgeBaseIds ?? [],
        researchConnections: plan.researchConnections ?? { search: [], fetch: [] },
        publishing: plan.publishing ?? { destinations: [] },
        agent: plan.agent ?? {
          modelConnectionId: plan.connections.chat ?? "",
          strategyId: plan.templateId ?? DefaultContentPlanTemplateId,
          toolConnectionIds: [
            ...(plan.researchConnections?.search ?? []),
            ...(plan.researchConnections?.fetch ?? []),
            ...(plan.connections.image ? [plan.connections.image] : []),
          ].filter((id, index, values) => values.indexOf(id) === index),
          enhancementToolIds: [],
        },
      });
    } else if (!planId) {
      const next = emptyPlan();
      next.identityId = workspace.identities.find((item) => item.enabled)?.id ?? "";
      next.connections.chat = capabilityConnections(workspace, "chat")[0]?.id ?? "";
      next.agent!.modelConnectionId = next.connections.chat;
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
    setForm(next);
    setDirty(true);
    setValidationError(null);
  };
  const changeView = (next: EditorView) => {
    if (next === view) return;
    setViewDirection(next === "runs" ? 1 : -1);
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, tab: next }),
      resetScroll: false,
    });
  };
  const showConfigSection = (next: SectionId) => {
    if (view !== "config") setViewDirection(-1);
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, tab: "config", panel: next }),
      resetScroll: false,
    });
  };
  const cancel = () => {
    if (!dirty || confirm("放弃尚未保存的修改？"))
      void navigate({ to: "/content-plans", search: { page: 1 } });
  };
  const validateForm = () => {
    if (!form.name.trim()) {
      showConfigSection("basic");
      setValidationError(new Error("请填写方案名称"));
      return false;
    }
    if (!form.agent?.modelConnectionId) {
      showConfigSection("basic");
      setValidationError(new Error("请选择生成模型连接"));
      return false;
    }
    if (!form.identityId) {
      showConfigSection("identity");
      setValidationError(new Error("请添加内容身份"));
      return false;
    }
    setValidationError(null);
    return true;
  };
  const requestSave = () => {
    showConfigSection(section);
    if (!validateForm()) return;
    save.mutate(form, {
      onSuccess: () => {
        setDirty(false);
        void navigate({ to: "/content-plans", search: { page: 1 } });
      },
    });
  };
  const requestRun = async () => {
    if (!validateForm()) return;
    let effectivePlanId = planId;
    if (!effectivePlanId || dirty) {
      try {
        const saved = await save.mutateAsync(form);
        effectivePlanId = saved.contentPlan.id;
        setCreatedPlanId((current) => current ?? saved.contentPlan.id);
        setForm((current) => ({ ...current, revision: saved.contentPlan.revision }));
        setDirty(false);
      } catch {
        return;
      }
    }
    run.mutate(effectivePlanId);
  };

  if (routePlanId && workspace && !plan)
    return (
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-8 text-sm">
        内容方案不存在或已被删除。
      </div>
    );

  return (
    <section className="grid gap-4 lg:h-[calc(100dvh-6rem)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onChange={changeView}
          className="w-fit"
          items={[
            { value: "config", label: "配置", icon: <Settings2 className="size-3.5" /> },
            { value: "runs", label: "运行记录", icon: <ScrollText className="size-3.5" /> },
          ]}
        />
        <AnimatePresence initial={false} mode="popLayout">
          {view === "config" ? (
            <motion.div
              key="config-actions"
              initial={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex gap-2"
            >
              <Button size="sm" variant="ghost" onClick={cancel}>
                取消
              </Button>
              <Button size="sm" variant="primary" loading={save.isPending} onClick={requestSave}>
                保存方案
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="run-action"
              initial={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <Button
                size="sm"
                variant="primary"
                loading={save.isPending || run.isPending}
                title={dirty || !planId ? "保存当前配置并运行" : "运行内容方案"}
                onClick={() => void requestRun()}
              >
                <Play className="size-3.5" />
                运行
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative min-h-0 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={viewDirection}>
          <motion.div
            key={view}
            custom={viewDirection}
            initial={{
              opacity: 0,
              x: reduceMotion ? 0 : viewDirection * 22,
              filter: reduceMotion ? "none" : "blur(3px)",
            }}
            animate={{ opacity: 1, x: 0, filter: "none" }}
            exit={{
              opacity: 0,
              x: reduceMotion ? 0 : viewDirection * -14,
              filter: reduceMotion ? "none" : "blur(2px)",
            }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="h-full min-h-0"
          >
            {view === "config" ? (
              <ConfigView
                section={section}
                onSectionChange={showConfigSection}
                form={form}
                update={update}
                workspace={workspace}
                error={validationError ?? save.error}
              />
            ) : (
              <PlanRunHistoryView
                planId={planId}
                startedRunId={startedRunId}
                runError={run.error ?? save.error}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function contentPlanSection(value: unknown): SectionId {
  return value === "identity" ||
    value === "knowledge" ||
    value === "sources" ||
    value === "publishing"
    ? value
    : "basic";
}
