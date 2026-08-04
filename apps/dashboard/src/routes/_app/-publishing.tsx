import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FlaskConical, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  createChannelAccount,
  deleteChannelAccount,
  listChannelAccounts,
  testChannelAccount,
  updateChannelAccount,
} from "#platform/api/channel-accounts.ts";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { AssociationList } from "./content-plans/editor/-association-list.tsx";
import type {
  ChannelAccount,
  ConnectorDefinition,
  JsonValue,
  SaveChannelAccountPayload,
  WorkspaceSnapshot,
} from "#platform/api/types.ts";

export const channelAccountsKey = () => ["channel-accounts"] as const;

export function useChannelAccounts() {
  return useQuery({ queryKey: channelAccountsKey(), queryFn: listChannelAccounts });
}

function useDeleteChannelAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteChannelAccount(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: channelAccountsKey() });
      await qc.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
}

function useSaveChannelAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveChannelAccountPayload }) =>
      id ? updateChannelAccount(id, body) : createChannelAccount(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: channelAccountsKey() });
      await qc.invalidateQueries({ queryKey: ["workspace"] });
    },
  });
}

export function PublishingPage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const { data } = useChannelAccounts();
  const [editor, setEditor] = useState<ChannelAccount | "new" | null>(null);
  const save = useSaveChannelAccount();
  const remove = useDeleteChannelAccount();
  const accounts = data?.channelAccounts ?? [];
  return (
    <PageGrid>
      <EntityList
        title="发布账号"
        description="账号统一维护渠道接入和发布器工具；系统会自动匹配对应的独立渠道 ReAct 会话。"
        action={
          <Button variant="primary" onClick={() => setEditor("new")}>
            <Plus className="size-4" />
            新增账号
          </Button>
        }
        empty={!accounts.length}
      >
        {accounts.map((account) => {
          const channel = workspace?.channelDefinitions.find((item) => item.id === account.channel);
          const connector = workspace?.connectorDefinitions.find(
            (item) => item.id === account.connectorId,
          );
          const profiles = workspace?.publicationTypeProfiles.filter(
            (item) => item.channel === account.channel,
          );
          return (
            <EntityRow
              key={account.id}
              title={account.name}
              description={`${channel?.name ?? account.channel} · ${connector?.displayName ?? account.connectorId ?? "接入缺失"}`}
              status={account.enabled ? "ready" : "disabled"}
              meta={
                <span className="flex flex-wrap gap-1">
                  {profiles?.map((profile) => (
                    <Badge key={profile.type}>{profile.name}</Badge>
                  ))}
                </span>
              }
              onEdit={() => setEditor(account)}
              onDelete={() =>
                confirm(`删除发布账号“${account.name}”？`) && remove.mutate(account.id)
              }
            />
          );
        })}
      </EntityList>
      <AccountDialog
        value={editor}
        workspace={workspace}
        open={Boolean(editor)}
        onOpenChange={(open) => !open && setEditor(null)}
        onSave={(body) =>
          save.mutate(
            { id: editor === "new" ? undefined : editor!.id, body },
            { onSuccess: () => setEditor(null) },
          )
        }
        saving={save.isPending}
        error={save.error}
      />
    </PageGrid>
  );
}

function AccountDialog({
  value,
  workspace,
  open,
  onOpenChange,
  onSave,
  saving,
  error,
}: {
  value: ChannelAccount | "new" | null;
  workspace: WorkspaceSnapshot | undefined;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(body: SaveChannelAccountPayload): void;
  saving: boolean;
  error: unknown;
}) {
  const [step, setStep] = useState(0);
  const [stepDirection, setStepDirection] = useState(1);
  const [stepContentHeight, setStepContentHeight] = useState<number>();
  const [stepContentElement, setStepContentElement] = useState<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const [form, setForm] = useState<SaveChannelAccountPayload>({
    name: "",
    enabled: true,
    channel: "",
    connectorId: "",
    settings: {},
    credentials: {},
    publisher: { toolConnectionIds: [] },
  });
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs: number;
  }>();
  const test = useMutation({
    mutationFn: (body: SaveChannelAccountPayload) =>
      testChannelAccount(body, value === "new" ? undefined : value?.id),
  });
  const updateForm = (next: SaveChannelAccountPayload) => {
    test.reset();
    setTestResult(undefined);
    setForm(next);
  };
  const initializedEditorKey = useRef<string | null>(null);
  useEffect(() => {
    if (!value) {
      initializedEditorKey.current = null;
      return;
    }
    const editorKey = value === "new" ? value : value.id;
    if (!workspace || initializedEditorKey.current === editorKey) return;
    initializedEditorKey.current = editorKey;
    setStep(0);
    setStepDirection(1);
    test.reset();
    setTestResult(undefined);
    const channel = workspace.channelDefinitions[0];
    const connectorId = channel?.connectorIds[0] ?? "";
    const definition = workspace.connectorDefinitions.find((item) => item.id === connectorId);
    setForm(
      value === "new"
        ? {
            name: "",
            enabled: true,
            channel: channel?.id ?? "",
            connectorId,
            settings: fieldDefaults(definition),
            credentials: {},
            publisher: { toolConnectionIds: [] },
          }
        : {
            name: value.name,
            enabled: value.enabled !== false,
            channel: value.channel,
            connectorId: value.connectorId ?? "",
            settings: value.settings,
            credentials: {},
            revision: value.revision,
            publisher: { toolConnectionIds: value.publisher?.toolConnectionIds ?? [] },
          },
    );
  }, [value, workspace]);
  const channel = workspace?.channelDefinitions.find((item) => item.id === form.channel);
  const connectorChoices = useMemo(
    () =>
      (workspace?.connectorDefinitions ?? []).filter((item) =>
        channel?.connectorIds.includes(item.id),
      ),
    [workspace, channel],
  );
  const connector = connectorChoices.find((item) => item.id === form.connectorId);
  const publisherToolRequirements = useMemo(() => {
    const requirements = (workspace?.publicationTypeProfiles ?? [])
      .filter((profile) => profile.channel === form.channel)
      .flatMap((profile) => profile.publisherTools ?? []);
    return [...new Map(requirements.map((tool) => [tool.id, tool])).values()];
  }, [workspace, form.channel]);
  const publisherCapabilities = useMemo(
    () => new Set(publisherToolRequirements.map((tool) => tool.capability)),
    [publisherToolRequirements],
  );
  const publisherToolConnectionIds = form.publisher?.toolConnectionIds ?? [];
  const publisherConnections = useMemo(
    () =>
      (workspace?.connections ?? []).filter((connection) => {
        const definition = workspace?.connectorDefinitions.find(
          (item) => item.id === connection.connectorId,
        );
        return Boolean(
          connection.enabled &&
          definition?.capabilities.some((capability) => publisherCapabilities.has(capability)),
        );
      }),
    [workspace, publisherCapabilities],
  );
  const requiredPublisherTools = publisherToolRequirements.filter((tool) => tool.required);
  const selectedPublisherCapabilities = new Set(
    publisherConnections
      .filter((connection) => publisherToolConnectionIds.includes(connection.id))
      .flatMap(
        (connection) =>
          workspace?.connectorDefinitions.find((item) => item.id === connection.connectorId)
            ?.capabilities ?? [],
      ),
  );
  const missingPublisherTool = requiredPublisherTools.find(
    (tool) => !selectedPublisherCapabilities.has(tool.capability),
  );
  const publisherItems = publisherToolConnectionIds.flatMap((id) => {
    const connection = publisherConnections.find((item) => item.id === id);
    if (!connection) return [];
    const definition = workspace?.connectorDefinitions.find(
      (item) => item.id === connection.connectorId,
    );
    return [
      {
        id: connection.id,
        name: connection.name,
        detail: definition?.displayName ?? connection.connectorId,
      },
    ];
  });
  const availablePublisherItems = publisherConnections
    .filter((connection) => !publisherToolConnectionIds.includes(connection.id))
    .map((connection) => {
      const definition = workspace?.connectorDefinitions.find(
        (item) => item.id === connection.connectorId,
      );
      return {
        id: connection.id,
        name: connection.name,
        detail: definition?.displayName ?? connection.connectorId,
      };
    });
  const fields = [...(connector?.fields ?? [])].sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0),
  );
  const canReuseStoredCredentials = value !== "new" && value?.connectorId === form.connectorId;
  const missingRequired = fields.some((field) => {
    if (!field.required) return false;
    const source = field.location === "settings" ? form.settings : (form.credentials ?? {});
    const current = source[field.key];
    return (
      (current === undefined || current === "") &&
      !(
        field.location === "credentials" &&
        canReuseStoredCredentials &&
        value?.credentialState?.[field.key]
      )
    );
  });
  const updateField = (field: ConnectorDefinition["fields"][number], fieldValue: JsonValue) => {
    if (field.location === "settings") {
      updateForm({ ...form, settings: { ...form.settings, [field.key]: fieldValue } });
    } else {
      updateForm({
        ...form,
        credentials: { ...form.credentials, [field.key]: fieldValue },
      });
    }
  };
  const goToStep = (nextStep: number) => {
    setStepDirection(nextStep > step ? 1 : -1);
    setStep(nextStep);
  };
  const bindStepContent = useCallback((element: HTMLDivElement | null) => {
    setStepContentElement(element);
  }, []);
  useLayoutEffect(() => {
    if (!open) {
      setStepContentHeight(undefined);
      return;
    }
    if (!stepContentElement) return;
    const updateHeight = () =>
      setStepContentHeight(stepContentElement.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(stepContentElement);
    return () => observer.disconnect();
  }, [open, step, stepContentElement]);
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={value === "new" ? "新增发布账号" : "编辑发布账号"}
      description="分步完成账号、渠道接入和发布器工具配置。凭证不会在保存后回传。"
      size="medium"
    >
      <ol
        aria-label="发布账号配置进度"
        className="mb-5 grid grid-cols-3 border-b border-[var(--border)]"
      >
        {["账号信息", "接入配置", "发布器工具"].map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={`border-b-2 px-2 pb-3 text-center text-sm font-medium transition-colors duration-200 ${
              step === index
                ? "border-[var(--accent)] text-[var(--ink)]"
                : "border-transparent text-[var(--muted)]"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>
      <motion.div
        data-slot="account-step-viewport"
        animate={{ height: stepContentHeight ?? "auto" }}
        className="relative overflow-hidden"
        transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <AnimatePresence initial={false} mode="popLayout" custom={stepDirection}>
          <motion.div
            data-slot="account-step-content"
            ref={bindStepContent}
            key={step}
            custom={stepDirection}
            variants={{
              enter: (direction: number) => ({
                x: reduceMotion ? 0 : direction * 28,
                opacity: reduceMotion ? 1 : 0,
              }),
              center: { x: 0, opacity: 1 },
              exit: (direction: number) => ({
                x: reduceMotion ? 0 : direction * -20,
                opacity: reduceMotion ? 1 : 0,
              }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="grid gap-4"
          >
            {step === 0 ? (
              <>
                <FormField label="账号名称" required>
                  <Input
                    value={form.name}
                    onChange={(event) => updateForm({ ...form, name: event.target.value })}
                  />
                </FormField>
                <FormField label="渠道" required>
                  <NativeSelect
                    value={form.channel}
                    onChange={(event) => {
                      const nextChannel = workspace?.channelDefinitions.find(
                        (item) => item.id === event.target.value,
                      );
                      const connectorId = nextChannel?.connectorIds[0] ?? "";
                      updateForm({
                        ...form,
                        channel: event.target.value,
                        connectorId,
                        settings: fieldDefaults(
                          workspace?.connectorDefinitions.find((item) => item.id === connectorId),
                        ),
                        credentials: {},
                        publisher: { toolConnectionIds: [] },
                      });
                    }}
                  >
                    {workspace?.channelDefinitions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="状态">
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => updateForm({ ...form, enabled: event.target.checked })}
                    />
                    启用此账号
                  </label>
                </FormField>
              </>
            ) : null}
            {step === 1 ? (
              <>
                <FormField label="接入方式" required>
                  <NativeSelect
                    value={form.connectorId}
                    onChange={(event) => {
                      const definition = connectorChoices.find(
                        (item) => item.id === event.target.value,
                      );
                      updateForm({
                        ...form,
                        connectorId: event.target.value,
                        settings: fieldDefaults(definition),
                        credentials: {},
                      });
                    }}
                  >
                    {connectorChoices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {connector?.description ? (
                  <p className="text-xs leading-5 text-[var(--muted-strong)]">
                    {connector.description}
                  </p>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {fields.map((field) => {
                    const source =
                      field.location === "settings" ? form.settings : (form.credentials ?? {});
                    return (
                      <AccountConnectionField
                        key={`${field.location}:${field.key}`}
                        field={field}
                        value={source[field.key]}
                        stored={Boolean(
                          canReuseStoredCredentials && value?.credentialState?.[field.key],
                        )}
                        onChange={(next) => updateField(field, next)}
                      />
                    );
                  })}
                </div>
                {testResult ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`rounded border px-3 py-2 text-xs ${testResult.success ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"}`}
                  >
                    {testResult.message} · {testResult.latencyMs} ms
                  </div>
                ) : null}
              </>
            ) : null}
            {step === 2 ? (
              <FormField
                label="发布器工具"
                required={requiredPublisherTools.length > 0}
                helper={publisherToolRequirements.map((tool) => tool.description).join(" ")}
              >
                <AssociationList
                  items={publisherItems}
                  available={availablePublisherItems}
                  empty={
                    publisherConnections.length
                      ? "尚未关联发布器工具"
                      : "没有可用连接，请先在连接页面创建并启用所需连接器。"
                  }
                  addLabel="关联连接"
                  onAdd={(connectionId) =>
                    updateForm({
                      ...form,
                      publisher: {
                        toolConnectionIds: [...publisherToolConnectionIds, connectionId],
                      },
                    })
                  }
                  onRemove={(connectionId) =>
                    updateForm({
                      ...form,
                      publisher: {
                        toolConnectionIds: publisherToolConnectionIds.filter(
                          (id) => id !== connectionId,
                        ),
                      },
                    })
                  }
                />
                {missingPublisherTool ? (
                  <p className="mt-2 text-xs text-[var(--danger)]">
                    必须配置：{missingPublisherTool.name}
                  </p>
                ) : null}
              </FormField>
            ) : null}
            <FormError error={error ?? test.error} />
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <AppDialogFooter className="flex justify-between gap-2">
        <div className="flex gap-2">
          {step > 0 ? (
            <Button onClick={() => goToStep(step - 1)}>
              <ArrowLeft className="size-4" />
              上一步
            </Button>
          ) : null}
          {step === 1 ? (
            <Button
              loading={test.isPending}
              disabled={!form.channel || !form.connectorId || missingRequired}
              onClick={() => {
                setTestResult(undefined);
                test.mutate(
                  {
                    ...form,
                    name: form.name.trim() || connector?.displayName || "未保存发布账号",
                  },
                  { onSuccess: (response) => setTestResult(response.test) },
                );
              }}
            >
              <FlaskConical className="size-4" />
              测试连接
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          {step < 2 ? (
            <Button
              variant="primary"
              disabled={
                step === 0
                  ? !form.name.trim() || !form.channel
                  : !form.connectorId || missingRequired
              }
              onClick={() => goToStep(step + 1)}
            >
              下一步
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={saving}
              disabled={Boolean(missingPublisherTool)}
              onClick={() => onSave(form)}
            >
              保存账号
            </Button>
          )}
        </div>
      </AppDialogFooter>
    </AppDialog>
  );
}

function AccountConnectionField({
  field,
  value,
  stored,
  onChange,
}: {
  field: ConnectorDefinition["fields"][number];
  value: JsonValue | undefined;
  stored: boolean;
  onChange(value: JsonValue): void;
}) {
  return (
    <FormField label={field.label} required={field.required} helper={field.description}>
      {field.input === "boolean" ? (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          启用
        </label>
      ) : field.input === "select" ? (
        <NativeSelect value={scalarValue(value)} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          type={
            field.input === "password"
              ? "password"
              : field.input === "number"
                ? "number"
                : field.input === "url"
                  ? "url"
                  : "text"
          }
          value={scalarValue(value)}
          placeholder={stored ? "留空保留已有凭证" : field.placeholder}
          onChange={(event) =>
            onChange(field.input === "number" ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </FormField>
  );
}

function fieldDefaults(definition: ConnectorDefinition | undefined): Record<string, JsonValue> {
  return Object.fromEntries(
    (definition?.fields ?? [])
      .filter((field) => field.location === "settings" && field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue!]),
  );
}

function scalarValue(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
