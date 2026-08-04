import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send } from "lucide-react";
import type { PublicationDestinationSelection, StoredContentPackage } from "#platform/api/types.ts";
import {
  contentPackageRunContextKey,
  getContentPackageRunContext,
  startPublication,
} from "#platform/api/articles.ts";
import { useWorkspaceRefresh, useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { PublicationDestinationPicker } from "#components/product/publication-destination-picker.tsx";
import { ContentPackagePreview } from "./library/-content-package-preview.tsx";

export function LibraryPage() {
  const { data: workspace } = useWorkspaceSnapshot();
  const [viewing, setViewing] = useState<StoredContentPackage | null>(null);
  const [publishing, setPublishing] = useState<StoredContentPackage | null>(null);
  const packages = workspace?.contentPackages ?? [];
  return (
    <PageGrid>
      <EntityList
        title="成品列表"
        description="发布适配器只消费版本化内容包，不读取生成目录或猜测文件名。"
        empty={!packages.length}
      >
        {packages.map((item) => (
          <EntityRow
            key={item.id}
            title={item.contentPackage.document.title}
            description={`${item.contentPackage.document.digest} · ${new Date(item.createdAt).toLocaleString()}`}
            status="ready"
            meta={<Badge>{item.contentPackage.schemaVersion}</Badge>}
          >
            <Button onClick={() => setViewing(item)}>查看</Button>
            <Button variant="primary" onClick={() => setPublishing(item)}>
              <Send className="size-4" />
              发布
            </Button>
          </EntityRow>
        ))}
      </EntityList>
      <PackageDialog value={viewing} onOpenChange={(open) => !open && setViewing(null)} />
      <PublishDialog value={publishing} onOpenChange={(open) => !open && setPublishing(null)} />
    </PageGrid>
  );
}

function PackageDialog({
  value,
  onOpenChange,
}: {
  value: StoredContentPackage | null;
  onOpenChange(open: boolean): void;
}) {
  const context = useQuery({
    queryKey: contentPackageRunContextKey(value?.id),
    queryFn: () => getContentPackageRunContext(value!.id),
    enabled: Boolean(value),
  });
  if (!value) return null;
  const contentPackage = context.data?.contentPackage ?? value;
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title={contentPackage.contentPackage.document.title}
      description={`${contentPackage.contentPackage.schemaVersion} · ${contentPackage.contentPackage.checksum.slice(0, 16)}`}
      size="wide"
    >
      <ContentPackagePreview
        value={contentPackage}
        generationRun={context.data?.generationRun}
        generationRunPending={context.isPending}
      />
    </AppDialog>
  );
}

function PublishDialog({
  value,
  onOpenChange,
}: {
  value: StoredContentPackage | null;
  onOpenChange(open: boolean): void;
}) {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  const refresh = useWorkspaceRefresh();
  const [destinations, setDestinations] = useState<PublicationDestinationSelection[]>([]);
  useEffect(() => setDestinations([]), [value?.id]);
  const publish = useMutation({
    mutationFn: () => startPublication({ packageId: value!.id, destinations }),
    onSuccess: () => {
      onOpenChange(false);
      refresh();
    },
  });
  if (!value) return null;
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="发布内容包"
      description="每个账号独立执行渠道 ReAct、上传和发布，失败会留下可恢复记录。"
      size="medium"
    >
      <div className="grid gap-3">
        <PublicationDestinationPicker
          accounts={workspace?.channelAccounts ?? []}
          channels={workspace?.channelDefinitions ?? []}
          profiles={workspace?.publicationTypeProfiles ?? []}
          value={destinations}
          onChange={setDestinations}
        />
        <FormError error={publish.error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={publish.isPending}
          disabled={!destinations.length}
          onClick={() => publish.mutate()}
        >
          确认发布
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}
