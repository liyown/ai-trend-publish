import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConnection,
  deleteConnection,
  listConnections,
  testConnection,
  updateConnection,
} from "#platform/api/connections.ts";
import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Plus } from "lucide-react";

import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { describeError, FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { suggestConnectionName } from "./connection-naming.ts";
export { suggestConnectionName } from "./connection-naming.ts";
import type {
  Connection,
  ConnectorDefinition,
  JsonValue,
  SaveConnectionPayload,
} from "#platform/api/types.ts";

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

type Editor = { definition: ConnectorDefinition; connection?: Connection; suggestedName?: string };

export function ConnectionsPage() {
  const { data } = useConnections();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [choose, setChoose] = useState(false);
  const remove = useDeleteConnection();
  const definitions = data?.definitions ?? [];
  const connections = data?.connections ?? [];
  const byId = useMemo(() => new Map(definitions.map((item) => [item.id, item])), [definitions]);
  return (
    <PageGrid>
      <EntityList
        title="连接列表"
        description="超时、重试与恢复不属于连接配置；调用失败会由运行记录和检查点安全处理。"
        action={
          <Button variant="primary" onClick={() => setChoose(true)}>
            <Plus className="size-4" />
            新建连接
          </Button>
        }
        empty={!connections.length}
      >
        {connections.map((connection) => {
          const definition = byId.get(connection.connectorId);
          return (
            <EntityRow
              key={connection.id}
              title={connection.name}
              description={`${definition?.displayName ?? connection.connectorId} · ${definition?.description ?? ""}`}
              status={connection.enabled ? "ready" : "disabled"}
              meta={
                <span className="flex gap-1">
                  {definition?.capabilities.map((capability) => (
                    <Badge key={capability}>{capability}</Badge>
                  ))}
                </span>
              }
              onEdit={() => definition && setEditor({ definition, connection })}
              onDelete={() =>
                confirm(`删除连接"${connection.name}"？`) && remove.mutate(connection.id)
              }
            />
          );
        })}
      </EntityList>
      <AppDialog
        open={choose}
        onOpenChange={setChoose}
        title="选择 Connector"
        description="每个 Connector 定义一组稳定能力和所需基础字段。"
        size="medium"
      >
        <div className="divide-y divide-[var(--border)]">
          {definitions.map((definition) => (
            <button
              key={definition.id}
              className="grid w-full gap-1 py-4 text-left hover:text-[var(--accent)]"
              onClick={() => {
                setChoose(false);
                setEditor({
                  definition,
                  suggestedName: suggestConnectionName(
                    definition.displayName,
                    connections.map((connection) => connection.name),
                  ),
                });
              }}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {definition.displayName}
                <span className="flex gap-1">
                  {definition.capabilities.map((item) => (
                    <Badge key={item}>{item}</Badge>
                  ))}
                </span>
              </span>
              <span className="text-xs leading-5 text-[var(--muted-strong)]">
                {definition.description}
              </span>
            </button>
          ))}
        </div>
      </AppDialog>
      <ConnectionDialog editor={editor} onOpenChange={(open) => !open && setEditor(null)} />
    </PageGrid>
  );
}

function ConnectionDialog({
  editor,
  onOpenChange,
}: {
  editor: Editor | null;
  onOpenChange(open: boolean): void;
}) {
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [headers, setHeaders] = useState("{}");
  const [query, setQuery] = useState("{}");
  const [body, setBody] = useState("{}");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; latencyMs: number }>();
  useEffect(() => {
    if (!editor) return;
    setName(editor.connection?.name ?? editor.suggestedName ?? editor.definition.displayName);
    setEnabled(editor.connection?.enabled ?? true);
    const defaults = Object.fromEntries(
      editor.definition.fields
        .filter((field) => field.defaultValue !== undefined)
        .map((field) => [field.key, field.defaultValue!]),
    );
    setValues({ ...defaults, ...editor.connection?.settings });
    setHeaders(JSON.stringify(editor.connection?.overrides?.headers ?? {}, null, 2));
    setQuery(JSON.stringify(editor.connection?.overrides?.query ?? {}, null, 2));
    setBody(JSON.stringify(editor.connection?.overrides?.body ?? {}, null, 2));
    setAdvancedOpen(false);
    setResult(undefined);
  }, [editor]);
  const payload = (): SaveConnectionPayload => ({
    id: editor?.connection?.id,
    revision: editor?.connection?.revision,
    connectorId: editor!.definition.id,
    name: name.trim(),
    enabled,
    settings: Object.fromEntries(
      editor!.definition.fields
        .filter((field) => field.location === "settings")
        .map((field) => [field.key, values[field.key]])
        .filter(([, value]) => value !== undefined && value !== ""),
    ),
    credentials: Object.fromEntries(
      editor!.definition.fields
        .filter((field) => field.location === "credentials")
        .map((field) => [field.key, values[field.key]])
        .filter(([, value]) => value !== undefined && value !== ""),
    ),
    overrides: editor!.definition.requestOverrides
      ? {
          headers: parseJsonObject(headers, "Headers") as Record<string, string>,
          query: parseJsonObject(query, "Query") as Record<string, string>,
          body: parseJsonObject(body, "Body"),
        }
      : undefined,
  });
  const save = useSaveConnection();
  const test = useTestConnection();
  if (!editor) return null;
  const fields = [...editor.definition.fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const primaryFields = fields.filter((field) => field.defaultValue === undefined);
  const defaultFields = fields.filter((field) => field.defaultValue !== undefined);
  const missingRequiredField = fields.some((field) => {
    if (!field.required) return false;
    const value = values[field.key];
    if (value !== undefined && value !== "") return false;
    return !(field.location === "credentials" && editor.connection?.credentialState[field.key]);
  });
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title={editor.connection ? "编辑连接" : "新建连接"}
      description={`${editor.definition.displayName} · ${editor.definition.capabilities.join(" / ")}`}
      size="medium"
    >
      <div className="grid gap-4">
        <div className="grid gap-4">
          {primaryFields.map((field) => (
            <ConnectionField
              key={`${field.location}:${field.key}`}
              field={field}
              value={values[field.key]}
              hasStoredCredential={Boolean(editor.connection?.credentialState[field.key])}
              onChange={(value) => setValues({ ...values, [field.key]: value })}
            />
          ))}
        </div>
        <details
          className="group border-t border-[var(--border)] pt-4"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--muted-strong)] hover:text-[var(--ink)]">
            高级设置
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              名称、状态与接口参数
            </span>
          </summary>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <FormField label="连接名称" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="状态">
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  启用
                </label>
              </FormField>
            </div>
            {defaultFields.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {defaultFields.map((field) => (
                  <ConnectionField
                    key={`${field.location}:${field.key}`}
                    field={field}
                    value={values[field.key]}
                    hasStoredCredential={Boolean(editor.connection?.credentialState[field.key])}
                    onChange={(value) => setValues({ ...values, [field.key]: value })}
                  />
                ))}
              </div>
            ) : null}
            {editor.definition.requestOverrides ? (
              <details className="border-t border-[var(--border)] pt-4">
                <summary className="cursor-pointer list-none text-sm font-medium">
                  请求覆盖
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    Headers · Query · Body
                  </span>
                </summary>
                <p className="mt-2 text-xs leading-5 text-[var(--muted-strong)]">
                  仅用于特殊接入；认证保留字段不能覆盖。
                </p>
                <div className="mt-4 grid gap-4">
                  <FormField label="Headers">
                    <Textarea
                      className="min-h-32 font-mono text-xs"
                      value={headers}
                      onChange={(e) => setHeaders(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Query">
                    <Textarea
                      className="min-h-32 font-mono text-xs"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Body">
                    <Textarea
                      className="min-h-32 font-mono text-xs"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </FormField>
                </div>
              </details>
            ) : null}
          </div>
        </details>
        {result ? (
          <div
            className={`rounded border px-3 py-2 text-xs ${result.success ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"}`}
          >
            {result.message} · {result.latencyMs} ms
          </div>
        ) : null}
        <FormError error={save.error ?? test.error} />
      </div>
      <AppDialogFooter className="flex justify-between gap-2">
        <Button
          loading={test.isPending}
          disabled={missingRequiredField}
          onClick={() => {
            try {
              test.mutate(payload());
            } catch (error) {
              setResult({ success: false, message: describeError(error), latencyMs: 0 });
            }
          }}
        >
          <FlaskConical className="size-4" />
          测试连接
        </Button>
        <div className="flex gap-2">
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!name.trim() || missingRequiredField}
            onClick={() =>
              save.mutate(
                { id: editor.connection?.id, body: payload() },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            保存连接
          </Button>
        </div>
      </AppDialogFooter>
    </AppDialog>
  );
}

function ConnectionField({
  field,
  value,
  hasStoredCredential,
  onChange,
}: {
  field: ConnectorDefinition["fields"][number];
  value: JsonValue | undefined;
  hasStoredCredential: boolean;
  onChange(value: JsonValue): void;
}) {
  return (
    <FormField label={field.label} required={field.required} helper={field.description}>
      {field.input === "boolean" ? (
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          启用
        </label>
      ) : field.input === "select" ? (
        <NativeSelect
          value={connectionFieldValue(value)}
          onChange={(event) => onChange(event.target.value)}
        >
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
          value={connectionFieldValue(value)}
          placeholder={hasStoredCredential ? "留空保留已有值" : field.placeholder}
          onChange={(event) =>
            onChange(field.input === "number" ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </FormField>
  );
}

function parseJsonObject(value: string, label: string): Record<string, JsonValue> {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} 必须是 JSON 对象`);
  return parsed as Record<string, JsonValue>;
}

function connectionFieldValue(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
