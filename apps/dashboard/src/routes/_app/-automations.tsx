import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  startAutomationRun,
  updateAutomation,
} from "#platform/api/automations.ts";
import { useEffect, useState } from "react";
import { Play, Plus } from "lucide-react";

import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { Pagination } from "#components/ui/pagination.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { splitLines } from "#lib/utils.ts";
import type { Automation, SaveAutomationPayload } from "#platform/api/types.ts";

const PAGE_SIZE = 20;

export const automationsKey = () => ["automations"] as const;

export function useAutomations(page = 1) {
  return useQuery({
    queryKey: [...automationsKey(), page] as const,
    queryFn: () => listAutomations(page, PAGE_SIZE),
  });
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

const emptyAutomation = (): SaveAutomationPayload => ({
  name: "",
  enabled: true,
  contentPlanId: "",
  instructions: "",
  keywords: [],
  trigger: { type: "manual" },
});

export function AutomationsPage({
  page,
  onPageChange,
}: {
  page: number;
  onPageChange(page: number): void;
}) {
  const { data, error } = useAutomations(page);
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const [running, setRunning] = useState<Automation | null>(null);
  const save = useSaveAutomation();
  const remove = useDeleteAutomation();
  const automations = data?.items ?? [];
  const hasEnabledPlan = workspace?.contentPlans.some((item) => item.enabled) ?? false;

  if (error && !data) return null;

  return (
    <PageGrid>
      <EntityList
        title="任务列表"
        description="任务只负责选择内容方案和触发方式；内容与发布配置由方案自身维护。"
        action={
          <Button variant="primary" disabled={!hasEnabledPlan} onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            新建任务
          </Button>
        }
        empty={!automations.length}
        emptyTitle={hasEnabledPlan ? "还没有自动化任务" : "先创建内容方案"}
        emptyDescription={
          hasEnabledPlan
            ? "创建任务后，可从这里手动运行并查看状态。"
            : "内容方案组合模板、身份、参考输入和模型连接，是创建任务的前置条件。"
        }
        emptyAction={
          !hasEnabledPlan ? (
            <Button onClick={() => (window.location.href = "/dashboard/content-plans")}>
              前往内容方案
            </Button>
          ) : undefined
        }
        pagination={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onChange={onPageChange}
          />
        }
      >
        {automations.map((automation) => {
          const plan = workspace?.contentPlans.find((item) => item.id === automation.contentPlanId);
          const identity = workspace?.identities.find((item) => item.id === plan?.identityId);
          return (
            <EntityRow
              key={automation.id}
              title={automation.name}
              description={`${plan?.name ?? "方案缺失"} · ${identity?.name ?? "身份缺失"}`}
              status={automation.enabled && plan?.enabled ? "ready" : "disabled"}
              meta={<Badge>{triggerLabel(automation.trigger.type)}</Badge>}
              onEdit={() => setEditing(automation)}
              onDelete={() =>
                confirm(`删除任务"${automation.name}"？`) && remove.mutate(automation.id)
              }
            >
              <Button
                disabled={!automation.enabled || !plan?.enabled}
                onClick={() => setRunning(automation)}
              >
                <Play className="size-4" />
                运行
              </Button>
            </EntityRow>
          );
        })}
      </EntityList>
      <AutomationDialog
        value={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(body) =>
          save.mutate(
            { id: editing === "new" ? undefined : (editing as Automation).id, body },
            { onSuccess: () => setEditing(null) },
          )
        }
        saving={save.isPending}
        error={save.error}
      />
      <RunDialog automation={running} onOpenChange={(open) => !open && setRunning(null)} />
    </PageGrid>
  );
}

function AutomationDialog({
  value,
  open,
  onOpenChange,
  onSave,
  saving,
  error,
}: {
  value: Automation | "new" | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(value: SaveAutomationPayload): void;
  saving: boolean;
  error: unknown;
}) {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const [form, setForm] = useState<SaveAutomationPayload>(emptyAutomation());
  const [keywords, setKeywords] = useState("");
  useEffect(() => {
    if (!value) return;
    const next = value === "new" ? emptyAutomation() : { ...value, revision: value.revision };
    if (value === "new") next.contentPlanId = workspace?.contentPlans[0]?.id ?? "";
    setForm(next);
    setKeywords(next.keywords.join("\n"));
  }, [value, workspace]);

  const plan = workspace?.contentPlans.find((item) => item.id === form.contentPlanId);
  const identity = workspace?.identities.find((item) => item.id === plan?.identityId);
  const sourceNames = (plan?.sourceCollectionIds ?? [])
    .map((id) => workspace?.sourceCollections.find((item) => item.id === id)?.name)
    .filter(Boolean);

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={value === "new" ? "新建任务" : "编辑任务"}
      description="选择要运行的内容方案，并配置何时触发。"
      size="wide"
    >
      <div className="grid gap-6">
        <section className="grid gap-4 md:grid-cols-2">
          <FormField label="任务名称" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </FormField>
          <FormField label="状态">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              启用任务
            </label>
          </FormField>
        </section>

        <section className="grid gap-4 border-y border-[var(--border)] py-5">
          <h3 className="text-sm font-semibold">内容与参考</h3>
          <FormField
            label="内容方案"
            required
            helper="内容方案决定 ReAct 策略、身份、知识库、授权工具、模型和发布配置。"
          >
            <NativeSelect
              value={form.contentPlanId}
              onChange={(event) => setForm({ ...form, contentPlanId: event.target.value })}
            >
              <option value="">请选择</option>
              {workspace?.contentPlans
                .filter((item) => item.enabled)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </FormField>
          {plan ? (
            <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
              <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
                <dt className="text-[var(--muted)]">内容身份</dt>
                <dd>{identity?.name ?? "身份缺失"}</dd>
              </div>
              <div className="grid gap-1 py-3 sm:grid-cols-[140px_1fr]">
                <dt className="text-[var(--muted)]">抓取数据源</dt>
                <dd>{sourceNames.join("、") || "未配置"}</dd>
              </div>
            </dl>
          ) : null}
          <FormField label="领域与任务说明" helper="补充本任务关注的领域、判断标准和内容边界。">
            <Textarea
              className="min-h-28"
              value={form.instructions ?? ""}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
            />
          </FormField>
          <FormField label="关注关键词" helper="每行一个，用作运行上下文；热点监控接入后也会复用。">
            <Textarea
              className="min-h-24"
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
            />
          </FormField>
        </section>

        <section className="grid gap-3 border-t border-[var(--border)] pt-5">
          <h3 className="text-sm font-semibold">触发方式</h3>
          <FormField label="当前方式">
            <NativeSelect
              value={form.trigger.type}
              onChange={(event) =>
                setForm({ ...form, trigger: defaultTrigger(event.target.value) })
              }
            >
              <option value="manual">手动触发</option>
              <option value="schedule">定时触发</option>
              <option value="hotspot">热点触发</option>
              <option value="api">API 触发</option>
            </NativeSelect>
          </FormField>
          {form.trigger.type === "schedule" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Cron 表达式" required>
                <Input
                  value={form.trigger.cron}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      trigger: {
                        type: "schedule",
                        cron: event.target.value,
                        timezone:
                          form.trigger.type === "schedule"
                            ? form.trigger.timezone
                            : "Asia/Shanghai",
                      },
                    })
                  }
                  placeholder="0 9 * * *"
                />
              </FormField>
              <FormField label="时区" required>
                <Input
                  value={form.trigger.timezone}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      trigger: {
                        type: "schedule",
                        cron: form.trigger.type === "schedule" ? form.trigger.cron : "0 9 * * *",
                        timezone: event.target.value,
                      },
                    })
                  }
                />
              </FormField>
            </div>
          ) : null}
          {form.trigger.type === "hotspot" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="监控关键词" required>
                <Input
                  value={form.trigger.query}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      trigger: {
                        type: "hotspot",
                        query: event.target.value,
                        intervalMinutes:
                          form.trigger.type === "hotspot" ? form.trigger.intervalMinutes : 30,
                      },
                    })
                  }
                />
              </FormField>
              <FormField label="检查间隔（分钟）" required>
                <Input
                  type="number"
                  min={5}
                  value={form.trigger.intervalMinutes}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      trigger: {
                        type: "hotspot",
                        query: form.trigger.type === "hotspot" ? form.trigger.query : "",
                        intervalMinutes: Number(event.target.value),
                      },
                    })
                  }
                />
              </FormField>
            </div>
          ) : null}
          {form.trigger.type === "api" ? (
            <FormField label="调用标识" helper="用于在日志中区分调用方，可留空。">
              <Input
                value={form.trigger.tokenName ?? ""}
                onChange={(event) =>
                  setForm({ ...form, trigger: { type: "api", tokenName: event.target.value } })
                }
              />
            </FormField>
          ) : null}
        </section>
        <FormError error={error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!form.name.trim() || !form.contentPlanId}
          onClick={() =>
            onSave({
              ...form,
              name: form.name.trim(),
              instructions: form.instructions?.trim() || undefined,
              keywords: splitLines(keywords),
            })
          }
        >
          保存
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

function RunDialog({
  automation,
  onOpenChange,
}: {
  automation: Automation | null;
  onOpenChange(open: boolean): void;
}) {
  const [topic, setTopic] = useState("");
  useEffect(() => setTopic(""), [automation]);
  const run = useStartAutomationRun();
  return (
    <AppDialog
      open={Boolean(automation)}
      onOpenChange={onOpenChange}
      title="运行任务"
      description={automation?.name ?? ""}
    >
      <div className="grid gap-4">
        <FormField label="本次指定主题" helper="可留空，由内容方案根据数据源选题。">
          <Input value={topic} onChange={(event) => setTopic(event.target.value)} />
        </FormField>
        <p className="text-xs leading-5 text-[var(--muted-strong)]">
          本次运行会执行内容方案中保存的生成与发布配置。
        </p>
        <FormError error={run.error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={run.isPending}
          onClick={() =>
            run.mutate(
              { id: automation!.id, body: { requestedTopic: topic.trim() || undefined } },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          <Play className="size-4" />
          开始运行
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

function defaultTrigger(type: string): SaveAutomationPayload["trigger"] {
  if (type === "schedule") return { type, cron: "0 9 * * *", timezone: "Asia/Shanghai" };
  if (type === "hotspot") return { type, query: "", intervalMinutes: 30 };
  if (type === "api") return { type, tokenName: "" };
  return { type: "manual" };
}

function triggerLabel(type: Automation["trigger"]["type"]) {
  return { manual: "手动触发", schedule: "定时触发", hotspot: "热点触发", api: "API 触发" }[type];
}
