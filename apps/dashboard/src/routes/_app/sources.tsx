import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSourceCollections,
  createSourceCollection,
  updateSourceCollection,
  deleteSourceCollection,
} from "#platform/api/source-collections.ts";
import type { SaveSourceCollectionPayload } from "#platform/api/types.ts";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SourceCollection, SourceItem } from "#platform/api/types.ts";
import { Button, IconButton } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";

export const sourceCollectionsKey = () => ["source-collections"] as const;

export function useSourceCollections() {
  return useQuery({ queryKey: sourceCollectionsKey(), queryFn: listSourceCollections });
}

export function useDeleteSourceCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSourceCollection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceCollectionsKey() }),
  });
}

export function useSaveSourceCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveSourceCollectionPayload }) =>
      id ? updateSourceCollection(id, body) : createSourceCollection(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: sourceCollectionsKey() }),
  });
}

export const Route = createFileRoute("/_app/sources")({ component: SourcesPage });

const newItem = (kind: SourceItem["kind"] = "url"): SourceItem =>
  kind === "url"
    ? { id: `local-${crypto.randomUUID()}`, kind, enabled: true, url: "" }
    : { id: `local-${crypto.randomUUID()}`, kind, enabled: true, query: "" };

function SourcesPage() {
  const { data } = useSourceCollections();
  const [editing, setEditing] = useState<SourceCollection | "new" | null>(null);
  const remove = useDeleteSourceCollection();
  const collections = data?.sourceCollections ?? [];

  return (
    <PageGrid>
      <EntityList
        title="内容来源"
        description="只维护要直接抓取的网址和用于发现内容的搜索词；使用哪些连接由内容方案决定。"
        action={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" />
            新建来源
          </Button>
        }
        empty={!collections.length}
        emptyTitle="还没有内容来源"
        emptyDescription="添加网址或搜索词，之后可在多个内容方案中复用。"
      >
        {collections.map((collection) => (
          <EntityRow
            key={collection.id}
            title={collection.name}
            description={sourceCollectionSummary(collection)}
            status={collection.enabled ? "ready" : "disabled"}
            onEdit={() => setEditing(collection)}
            onDelete={() => confirm(`删除"${collection.name}"？`) && remove.mutate(collection.id)}
          />
        ))}
      </EntityList>
      <SourceDialog
        source={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </PageGrid>
  );
}

function SourceDialog({
  source,
  open,
  onOpenChange,
}: {
  source: SourceCollection | "new" | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [name, setName] = useState("");
  const [revision, setRevision] = useState<number>();
  const [items, setItems] = useState<SourceItem[]>([]);
  useEffect(() => {
    if (!source) return;
    setName(source === "new" ? "" : source.name);
    setRevision(source === "new" ? undefined : source.revision);
    setItems(source === "new" ? [newItem()] : structuredClone(source.sources));
  }, [source]);
  const save = useSaveSourceCollection();
  const setItemKind = (id: string, kind: SourceItem["kind"]) =>
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id || item.kind === kind) return item;
        const base = { id: item.id, title: item.title, enabled: item.enabled };
        return kind === "url" ? { ...base, kind, url: "" } : { ...base, kind, query: "" };
      }),
    );
  const setItemText = (id: string, text: string) =>
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        return item.kind === "url" ? { ...item, url: text } : { ...item, query: text };
      }),
    );
  const valid =
    name.trim() &&
    items.length > 0 &&
    items.every((item) => (item.kind === "url" ? item.url.trim() : item.query.trim()));

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={source === "new" ? "新建内容来源" : "编辑内容来源"}
      description="网址用于直接抓取，搜索词用于发现候选网页。连接策略在内容方案中统一配置。"
      size="wide"
    >
      <div className="grid gap-5">
        <FormField label="名称" required helper="用于在内容方案中识别这组来源">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：AI 工程资讯"
          />
        </FormField>
        <section>
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-[var(--ink)]">来源条目</h3>
            <p className="mt-1 text-xs text-[var(--muted-strong)]">
              搜索只负责发现网址，最终证据仍会通过网页抓取连接获取正文。
            </p>
          </div>
          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
            <div className="hidden grid-cols-[28px_112px_minmax(0,1fr)_36px] gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-medium text-[var(--muted-strong)] md:grid">
              <span />
              <span>类型</span>
              <span>网址或搜索词</span>
              <span />
            </div>
            <div className="divide-y divide-[var(--border)]">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="grid gap-3 bg-[var(--surface)] px-3 py-3 md:grid-cols-[28px_112px_minmax(0,1fr)_36px] md:items-center"
                >
                  <span className="text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
                  <NativeSelect
                    value={item.kind}
                    aria-label={`来源 ${index + 1} 的类型`}
                    onChange={(event) =>
                      setItemKind(item.id, event.target.value as SourceItem["kind"])
                    }
                  >
                    <option value="url">网址</option>
                    <option value="query">搜索词</option>
                  </NativeSelect>
                  <Input
                    type={item.kind === "url" ? "url" : "text"}
                    value={item.kind === "url" ? item.url : item.query}
                    onChange={(event) => setItemText(item.id, event.target.value)}
                    placeholder={
                      item.kind === "url" ? "https://example.com/article" : "例如：AI Agent 发布"
                    }
                  />
                  <IconButton
                    label="删除来源"
                    variant="ghost"
                    disabled={items.length === 1}
                    onClick={() =>
                      setItems((current) => current.filter((value) => value.id !== item.id))
                    }
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
          <Button className="mt-3" onClick={() => setItems((current) => [...current, newItem()])}>
            <Plus className="size-4" />
            添加来源
          </Button>
        </section>
        <FormError error={save.error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!valid}
          onClick={() =>
            save.mutate(
              {
                id: source !== "new" ? source?.id : undefined,
                body: {
                  name: name.trim(),
                  enabled: true,
                  revision,
                  sources: items.map((item) => {
                    const common = {
                      id: item.id.startsWith("local-") ? undefined : item.id,
                      title: item.title?.trim() || undefined,
                      enabled: true,
                    };
                    return item.kind === "url"
                      ? { ...common, kind: item.kind, url: item.url.trim() }
                      : { ...common, kind: item.kind, query: item.query.trim() };
                  }),
                },
              },
              { onSuccess: () => onOpenChange(false) },
            )
          }
        >
          保存来源
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

function sourceCollectionSummary(collection: SourceCollection): string {
  const urls = collection.sources.filter((item) => item.kind === "url").length;
  const queries = collection.sources.filter((item) => item.kind === "query").length;
  return `${urls} 个网址 · ${queries} 个搜索词`;
}
