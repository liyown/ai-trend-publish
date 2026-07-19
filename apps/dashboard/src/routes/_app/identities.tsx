import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listIdentities,
  createIdentity,
  updateIdentity,
  deleteIdentity,
} from "#platform/api/identities.ts";

import { useEffect, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { splitLines } from "#lib/utils.ts";
import type { ContentIdentity, SaveIdentityPayload } from "#platform/api/types.ts";

export const identitiesKey = () => ["identities"] as const;

export function useIdentities() {
  return useQuery({ queryKey: identitiesKey(), queryFn: listIdentities });
}

export function useDeleteIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteIdentity(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: identitiesKey() }),
  });
}

export function useSaveIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveIdentityPayload }) =>
      id ? updateIdentity(id, body) : createIdentity(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: identitiesKey() }),
  });
}

export const Route = createFileRoute("/_app/identities")({ component: IdentitiesPage });

const blank: SaveIdentityPayload = {
  name: "",
  enabled: true,
  positioning: "",
  audience: "",
  tone: "",
  forbiddenTopics: [],
};

function IdentitiesPage() {
  const { data } = useIdentities();
  const [editing, setEditing] = useState<ContentIdentity | "new" | null>(null);
  const save = useSaveIdentity();
  const remove = useDeleteIdentity();
  const identities = data?.identities ?? [];
  return (
    <PageGrid>
      <EntityList
        title="身份列表"
        description="一个内容身份可以通过不同发布目标连接到多个渠道账号。"
        action={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            新建身份
          </Button>
        }
        empty={!identities.length}
      >
        {identities.map((identity) => (
          <EntityRow
            key={identity.id}
            title={identity.name}
            description={`${identity.positioning} · 面向 ${identity.audience} · ${identity.tone}`}
            status={identity.enabled ? "ready" : "disabled"}
            onEdit={() => setEditing(identity)}
            onDelete={() => confirm(`删除"${identity.name}"？`) && remove.mutate(identity.id)}
          />
        ))}
      </EntityList>
      <IdentityDialog
        identity={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(payload) =>
          save.mutate(
            { id: editing === "new" ? undefined : editing!.id, body: payload },
            { onSuccess: () => setEditing(null) },
          )
        }
        saving={save.isPending}
        error={save.error}
      />
    </PageGrid>
  );
}

function IdentityDialog({
  identity,
  open,
  onOpenChange,
  onSave,
  saving,
  error,
}: {
  identity: ContentIdentity | "new" | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(payload: SaveIdentityPayload): void;
  saving: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState(blank);
  const [forbidden, setForbidden] = useState("");
  useEffect(() => {
    if (!identity) return;
    const value = identity === "new" ? blank : { ...identity, revision: identity.revision };
    setForm(value);
    setForbidden(value.forbiddenTopics.join("\n"));
  }, [identity]);
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={identity === "new" ? "新建内容身份" : "编辑内容身份"}
      description="只维护内容表达，不在这里绑定发布账号。"
      size="wide"
    >
      <div className="grid gap-5">
        <IdentityFormSection title="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="名称" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：工程观察"
              />
            </FormField>
            <FormField label="语气" required>
              <Input
                value={form.tone}
                onChange={(e) => setForm({ ...form, tone: e.target.value })}
                placeholder="克制、直接、重证据"
              />
            </FormField>
            <FormField label="定位" required>
              <Textarea
                className="min-h-24"
                value={form.positioning}
                onChange={(e) => setForm({ ...form, positioning: e.target.value })}
                placeholder="长期输出什么内容，以及坚持什么判断标准"
              />
            </FormField>
            <FormField label="受众" required>
              <Textarea
                className="min-h-24"
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                placeholder="读者是谁，以及他们为什么会持续关注"
              />
            </FormField>
          </div>
        </IdentityFormSection>

        <IdentityFormSection title="内容边界">
          <div className="max-w-2xl">
            <FormField
              label="禁止主题"
              helper="每行一条；标题规则和质量标准在内容方案的插件步骤配置。"
            >
              <Textarea
                className="min-h-28"
                value={forbidden}
                onChange={(e) => setForbidden(e.target.value)}
                placeholder={"泛泛融资新闻\n无技术细节的营销稿"}
              />
            </FormField>
          </div>
        </IdentityFormSection>

        <FormError error={error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={
            !form.name.trim() ||
            !form.positioning.trim() ||
            !form.audience.trim() ||
            !form.tone.trim()
          }
          onClick={() =>
            onSave({
              ...form,
              forbiddenTopics: splitLines(forbidden),
            })
          }
        >
          保存
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

function IdentityFormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      {children}
    </section>
  );
}
