import { useEffect, useMemo, useState } from "react";
import { ChannelId } from "@trendpublish/contracts";
import { Plus } from "lucide-react";
import type {
  ChannelAccount,
  PublishTarget,
  SaveChannelAccountPayload,
  SavePublishTargetPayload,
} from "#platform/api/types.ts";
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
import {
  useChannelAccounts,
  useDeleteChannelAccount,
  useDeletePublishTarget,
  usePublishTargets,
  useSaveChannelAccount,
  useSavePublishTarget,
} from "./use-publishing.ts";

export function PublishingPage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const { data: channelAccounts } = useChannelAccounts();
  const { data: publishTargets } = usePublishTargets();
  const [accountEditor, setAccountEditor] = useState<ChannelAccount | "new" | null>(null);
  const [targetEditor, setTargetEditor] = useState<PublishTarget | "new" | null>(null);
  const saveAccount = useSaveChannelAccount();
  const saveTarget = useSavePublishTarget();
  const deleteAccount = useDeleteChannelAccount();
  const deleteTarget = useDeletePublishTarget();
  const accounts = channelAccounts?.channelAccounts ?? [];
  const targets = publishTargets?.publishTargets ?? [];
  return (
    <PageGrid>
      <EntityList
        title="渠道账号"
        description="凭证保存在连接中；渠道账号只保存渠道语义和公开设置。"
        action={
          <Button onClick={() => setAccountEditor("new")}>
            <Plus className="size-4" />
            新增账号
          </Button>
        }
        empty={!accounts.length}
      >
        {accounts.map((account) => {
          const connection = workspace?.connections.find(
            (item) => item.id === account.connectionId,
          );
          return (
            <EntityRow
              key={account.id}
              title={account.name}
              description={`${workspace?.channelDefinitions.find((item) => item.id === account.channel)?.name ?? account.channel} · 连接：${connection?.name ?? "缺失"}`}
              status={connection?.enabled ? "ready" : "warning"}
              onEdit={() => setAccountEditor(account)}
              onDelete={() =>
                confirm(`删除"${account.name}"？`) && deleteAccount.mutate(account.id)
              }
            />
          );
        })}
      </EntityList>
      <EntityList
        title="发布目标"
        description="发布时每个目标独立准备、上传和创建草稿；单个失败不会抹掉其他目标结果。"
        action={
          <Button onClick={() => setTargetEditor("new")}>
            <Plus className="size-4" />
            新增目标
          </Button>
        }
        empty={!targets.length}
      >
        {targets.map((target) => {
          const account = accounts.find((item) => item.id === target.channelAccountId);
          return (
            <EntityRow
              key={target.id}
              title={target.name}
              description={`渠道账号：${account?.name ?? "账号缺失"}`}
              status={account ? "ready" : "warning"}
              meta={<Badge>输出目标</Badge>}
              onEdit={() => setTargetEditor(target)}
              onDelete={() => confirm(`删除"${target.name}"？`) && deleteTarget.mutate(target.id)}
            />
          );
        })}
      </EntityList>
      <AccountDialog
        value={accountEditor}
        open={Boolean(accountEditor)}
        onOpenChange={(open) => !open && setAccountEditor(null)}
        onSave={(body) =>
          saveAccount.mutate(
            { id: accountEditor === "new" ? undefined : accountEditor!.id, body },
            { onSuccess: () => setAccountEditor(null) },
          )
        }
        saving={saveAccount.isPending}
        error={saveAccount.error}
      />
      <TargetDialog
        value={targetEditor}
        open={Boolean(targetEditor)}
        onOpenChange={(open) => !open && setTargetEditor(null)}
        onSave={(body) =>
          saveTarget.mutate(
            { id: targetEditor === "new" ? undefined : targetEditor!.id, body },
            { onSuccess: () => setTargetEditor(null) },
          )
        }
        saving={saveTarget.isPending}
        error={saveTarget.error}
      />
    </PageGrid>
  );
}

function AccountDialog({
  value,
  open,
  onOpenChange,
  onSave,
  saving,
  error,
}: {
  value: ChannelAccount | "new" | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(body: SaveChannelAccountPayload): void;
  saving: boolean;
  error: unknown;
}) {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const definitions = useMemo(
    () => new Map((workspace?.connectorDefinitions ?? []).map((item) => [item.id, item])),
    [workspace],
  );
  const [form, setForm] = useState<SaveChannelAccountPayload>({
    name: "",
    channel: ChannelId.WeixinOfficialAccount,
    connectionId: "",
    settings: {},
  });
  useEffect(() => {
    if (!value) return;
    setForm(
      value === "new"
        ? {
            name: "",
            channel: workspace?.channelDefinitions[0]?.id ?? ChannelId.WeixinOfficialAccount,
            connectionId: "",
            settings: {},
          }
        : { ...value, revision: value.revision },
    );
  }, [value, workspace]);
  const channel = workspace?.channelDefinitions.find((item) => item.id === form.channel);
  const connections =
    workspace?.connections.filter(
      (connection) =>
        connection.enabled &&
        definitions
          .get(connection.connectorId)
          ?.capabilities.includes(channel?.requiredCapability ?? ""),
    ) ?? [];
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={value === "new" ? "新增渠道账号" : "编辑渠道账号"}
      description="账号引用连接，不复制 API 凭证。"
      size="medium"
    >
      <div className="grid gap-4">
        <FormField label="名称" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="渠道" required>
          <NativeSelect
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value, connectionId: "" })}
          >
            {workspace?.channelDefinitions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="渠道连接" required helper="只显示具备渠道所需能力的连接。">
          <NativeSelect
            value={form.connectionId}
            onChange={(e) => setForm({ ...form, connectionId: e.target.value })}
          >
            <option value="">请选择</option>
            {connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormError error={error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!form.name.trim() || !form.connectionId}
          onClick={() => onSave(form)}
        >
          保存
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

function TargetDialog({
  value,
  open,
  onOpenChange,
  onSave,
  saving,
  error,
}: {
  value: PublishTarget | "new" | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(body: SavePublishTargetPayload): void;
  saving: boolean;
  error: unknown;
}) {
  const { data: channelAccounts } = useChannelAccounts();
  const accounts = channelAccounts?.channelAccounts ?? [];
  const [form, setForm] = useState<SavePublishTargetPayload>({
    name: "",
    channelAccountId: "",
    settings: {},
  });
  useEffect(() => {
    if (!value) return;
    setForm(
      value === "new"
        ? {
            name: "",
            channelAccountId: accounts[0]?.id ?? "",
            settings: {},
          }
        : { ...value, revision: value.revision },
    );
  }, [value, accounts]);
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={value === "new" ? "新增发布目标" : "编辑发布目标"}
      description="发布目标只描述渠道账号及其输出配置，可被任意内容方案复用。"
      size="medium"
    >
      <div className="grid gap-4">
        <FormField label="名称" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="渠道账号" required>
          <NativeSelect
            value={form.channelAccountId}
            onChange={(e) => setForm({ ...form, channelAccountId: e.target.value })}
          >
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormError error={error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!form.name.trim() || !form.channelAccountId}
          onClick={() => onSave(form)}
        >
          保存
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}
