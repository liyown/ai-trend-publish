import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Plus, Upload } from "lucide-react";
import type { KnowledgeBase, SaveKnowledgeBasePayload } from "#platform/api/types.ts";
import { useDashboardApi } from "../../app/providers.tsx";
import { useWorkspaceRefresh, useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";

const blank: SaveKnowledgeBasePayload = { name: "", enabled: true, documents: [] };

export function KnowledgePage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const api = useDashboardApi();
  const refresh = useWorkspaceRefresh();
  const [editing, setEditing] = useState<KnowledgeBase | "new" | null>(null);
  const save = useMutation({
    mutationFn: (body: SaveKnowledgeBasePayload) =>
      editing === "new"
        ? api.createKnowledgeBase(body)
        : api.updateKnowledgeBase(editing!.id, body),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteKnowledgeBase(id),
    onSuccess: refresh,
  });
  const items = workspace?.knowledgeBases ?? [];
  return (
    <PageGrid>
      <EntityList
        title="知识库"
        description="维护可重复使用的参考材料；抓取数据源只负责运行时获取动态内容。"
        action={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            新建知识库
          </Button>
        }
        empty={!items.length}
      >
        {items.map((item) => (
          <EntityRow
            key={item.id}
            title={item.name}
            description={`${item.documents.length} 份参考文档`}
            status={item.enabled ? "ready" : "disabled"}
            onEdit={() => setEditing(item)}
            onDelete={() => confirm(`删除"${item.name}"？`) && remove.mutate(item.id)}
          />
        ))}
      </EntityList>
      <KnowledgeDialog
        value={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(body) => save.mutate(body)}
        saving={save.isPending}
        error={save.error}
      />
    </PageGrid>
  );
}

function KnowledgeDialog({
  value,
  open,
  onOpenChange,
  onSave,
  saving,
  error,
}: {
  value: KnowledgeBase | "new" | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(body: SaveKnowledgeBasePayload): void;
  saving: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState<SaveKnowledgeBasePayload>(blank);
  useEffect(() => {
    if (!value) return;
    setForm(value === "new" ? blank : { ...value, revision: value.revision });
  }, [value]);
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const documents = await Promise.all(
      Array.from(files).map(async (file) => ({
        title: file.name.replace(/\.(md|markdown|txt)$/i, ""),
        fileName: file.name,
        mediaType: file.type || "text/plain",
        content: await file.text(),
      })),
    );
    setForm((current) => ({ ...current, documents: [...current.documents, ...documents] }));
  };
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={value === "new" ? "新建知识库" : "编辑知识库"}
      description="上传长期参考材料，供多个内容方案复用。"
      size="wide"
    >
      <div className="grid gap-5">
        <FormField label="名称" required>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：AI 基础设施研究资料"
          />
        </FormField>
        <section className="grid gap-3 border-t border-[var(--border)] pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">参考文档</h3>
              <p className="mt-1 text-xs text-[var(--muted-strong)]">
                当前支持 TXT 和 Markdown，单份文档最大 2 MB。
              </p>
            </div>
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-2.5 text-xs font-medium">
              <Upload className="size-3.5" />
              上传文档
              <input
                className="sr-only"
                type="file"
                multiple
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                onChange={(event) => void addFiles(event.target.files)}
              />
            </label>
          </div>
          <div className="divide-y divide-[var(--border)] rounded-[var(--radius-sm)] border border-[var(--border)]">
            {form.documents.length ? (
              form.documents.map((document, index) => (
                <div
                  key={document.id ?? `${document.fileName}-${index}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <FileText className="size-4 shrink-0 text-[var(--muted)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{document.title}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {document.fileName ?? `${document.content.length} 字符`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setForm({
                        ...form,
                        documents: form.documents.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                  >
                    移除
                  </Button>
                </div>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">尚未上传参考文档</p>
            )}
          </div>
        </section>
        <FormError error={error} />
      </div>
      <AppDialogFooter>
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!form.name.trim()}
          onClick={() => onSave(form)}
        >
          保存
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}
