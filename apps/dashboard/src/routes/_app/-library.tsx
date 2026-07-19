import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Trash2 } from "lucide-react";
import type {
  ArticleSource,
  AssetRequest,
  StoredContentPackage,
  StoredReviewRequest,
} from "#platform/api/types.ts";
import { startPublication, submitEditedArticle } from "#platform/api/articles.ts";
import { useWorkspaceRefresh, useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { AppDialog, AppDialogFooter } from "#components/product/app-dialog.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { ArticleDocumentView } from "./library/article-document-view.tsx";

export function LibraryPage() {
  const { data: workspace } = useWorkspaceSnapshot();
  const [viewing, setViewing] = useState<StoredContentPackage | null>(null);
  const [publishing, setPublishing] = useState<StoredContentPackage | null>(null);
  const [reviewing, setReviewing] = useState<StoredReviewRequest | null>(null);
  const packages = workspace?.contentPackages ?? [];
  const reviewRequests = (workspace?.reviewRequests ?? []).filter((item) => item.status === "open");
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
      <EntityList
        title="待审内容"
        description="质量检查未通过的内容会保留在这里，可继续审阅和修订。"
        empty={!reviewRequests.length}
      >
        {reviewRequests.map((item) => (
          <ReviewRequestRow key={item.id} value={item} onReview={() => setReviewing(item)} />
        ))}
      </EntityList>
      <ReviewDialog
        key={reviewing?.id ?? "closed-review"}
        value={reviewing}
        onOpenChange={(open) => !open && setReviewing(null)}
      />
      <PackageDialog value={viewing} onOpenChange={(open) => !open && setViewing(null)} />
      <PublishDialog value={publishing} onOpenChange={(open) => !open && setPublishing(null)} />
    </PageGrid>
  );
}

function ReviewRequestRow({ value, onReview }: { value: StoredReviewRequest; onReview(): void }) {
  return (
    <EntityRow
      title={value.request.article.source.title}
      description={`${value.request.quality.diagnostics.length} 个待处理问题 · ${new Date(value.createdAt).toLocaleString()}`}
      status="warning"
      meta={<Badge>待审</Badge>}
    >
      <Button onClick={onReview}>审阅并修订</Button>
    </EntityRow>
  );
}

function ReviewDialog({
  value,
  onOpenChange,
}: {
  value: StoredReviewRequest | null;
  onOpenChange(open: boolean): void;
}) {
  const refresh = useWorkspaceRefresh();
  const [source, setSource] = useState<ArticleSource | null>(null);
  const [assetRequests, setAssetRequests] = useState<AssetRequest[]>([]);

  useEffect(() => {
    if (!value) return;
    setSource(structuredClone(value.request.article.source));
    setAssetRequests(structuredClone(value.request.article.assetRequests));
  }, [value]);

  const complete = useMutation({
    mutationFn: () => {
      if (!value || !source) throw new Error("待审内容尚未载入");
      return submitEditedArticle({
        planId: value.planId,
        reviewRequestId: value.id,
        source: {
          ...source,
          title: source.title.trim(),
          digest: source.digest.trim(),
          bodyMarkdown: source.bodyMarkdown.trim(),
        },
        assetRequests: assetRequests.map(normalizeAssetRequest),
      });
    },
    onSuccess: () => {
      onOpenChange(false);
      refresh();
    },
  });

  if (!value || !source) return null;
  const canComplete =
    source.title.trim().length > 0 &&
    source.digest.trim().length > 0 &&
    source.bodyMarkdown.trim().length > 0 &&
    assetRequests.every(
      (request) => request.id.trim().length > 0 && request.brief.trim().length > 0,
    );

  const updateAssetRequest = (index: number, patch: Partial<AssetRequest>) => {
    setAssetRequests((current) =>
      current.map((request, requestIndex) =>
        requestIndex === index ? { ...request, ...patch } : request,
      ),
    );
  };

  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="审阅并修订"
      description="提交后会重新编译、检查和处理资源；不会直接修改 AST。"
      size="wide"
    >
      <div className="grid gap-6">
        <section className="grid gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">待处理问题</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              以下是本次审核的触发原因。修订提交后会以新内容重新检查。
            </p>
          </div>
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {value.request.quality.diagnostics.map((diagnostic) => (
              <div
                key={`${diagnostic.code}:${diagnostic.scope}:${diagnostic.message}`}
                className="grid gap-1 py-2.5 text-sm md:grid-cols-[110px_minmax(0,1fr)] md:gap-3"
              >
                <div className="flex items-start gap-2">
                  <Badge tone={diagnostic.severity === "blocker" ? "danger" : "warning"}>
                    {diagnostic.severity === "blocker" ? "必须处理" : "建议处理"}
                  </Badge>
                </div>
                <div>
                  <p className="text-[var(--ink-2)]">{diagnostic.message}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {diagnostic.code} · {diagnostic.scope}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">文章源稿</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              正文使用带注解的 Markdown；证据链接和资源占位符会在提交后重新解析。
            </p>
          </div>
          <FormField label="标题" required>
            <Input
              value={source.title}
              onChange={(event) => setSource({ ...source, title: event.target.value })}
            />
          </FormField>
          <FormField label="摘要" required>
            <Textarea
              value={source.digest}
              onChange={(event) => setSource({ ...source, digest: event.target.value })}
            />
          </FormField>
          <FormField
            label="正文 Markdown"
            required
            helper="删除资源请求时，也要删除正文中对应的 asset-request://<ID> 占位符。"
          >
            <Textarea
              className="min-h-72 font-mono text-xs leading-6"
              value={source.bodyMarkdown}
              onChange={(event) => setSource({ ...source, bodyMarkdown: event.target.value })}
            />
          </FormField>
        </section>

        <section className="grid gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">资源请求</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              可以修改描述和类型、降级为增强项，或删除不再需要的请求。
            </p>
          </div>
          {!assetRequests.length ? (
            <p className="border-y border-[var(--border)] py-3 text-sm text-[var(--muted-strong)]">
              当前文章没有资源请求。
            </p>
          ) : (
            <div className="grid gap-3">
              {assetRequests.map((request, index) => (
                <div
                  key={request.id}
                  className="grid gap-4 rounded-[var(--radius-sm)] border border-[var(--border)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="min-w-0 truncate text-xs text-[var(--muted-strong)]">
                      {request.id}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setAssetRequests((current) =>
                          current.filter((_, requestIndex) => requestIndex !== index),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                      删除请求
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="资源类型" required>
                      <NativeSelect
                        value={request.type}
                        onChange={(event) =>
                          updateAssetRequest(index, {
                            type: event.target.value as AssetRequest["type"],
                          })
                        }
                      >
                        <option value="cover">封面</option>
                        <option value="illustration">插图</option>
                        <option value="diagram">示意图</option>
                        <option value="chart">图表</option>
                      </NativeSelect>
                    </FormField>
                    <FormField
                      label="必要程度"
                      required
                      helper="增强项失败时会省略并告警；必要项失败会再次进入待审。"
                    >
                      <NativeSelect
                        value={request.necessity}
                        onChange={(event) =>
                          updateAssetRequest(index, {
                            necessity: event.target.value as AssetRequest["necessity"],
                          })
                        }
                      >
                        <option value="enhancement">增强项</option>
                        <option value="essential">必要项</option>
                      </NativeSelect>
                    </FormField>
                  </div>
                  <FormField label="制作说明" required>
                    <Textarea
                      value={request.brief}
                      onChange={(event) => updateAssetRequest(index, { brief: event.target.value })}
                    />
                  </FormField>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="替代文本">
                      <Input
                        value={request.alt ?? ""}
                        onChange={(event) => updateAssetRequest(index, { alt: event.target.value })}
                      />
                    </FormField>
                    <FormField label="说明文字">
                      <Input
                        value={request.caption ?? ""}
                        onChange={(event) =>
                          updateAssetRequest(index, { caption: event.target.value })
                        }
                      />
                    </FormField>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <FormError error={complete.error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={complete.isPending}
          disabled={!canComplete}
          onClick={() => complete.mutate()}
        >
          提交并重新处理
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}

function normalizeAssetRequest(request: AssetRequest): AssetRequest {
  const alt = request.alt?.trim();
  const caption = request.caption?.trim();
  return {
    id: request.id.trim(),
    type: request.type,
    necessity: request.necessity,
    brief: request.brief.trim(),
    ...(alt ? { alt } : {}),
    ...(caption ? { caption } : {}),
  };
}

function PackageDialog({
  value,
  onOpenChange,
}: {
  value: StoredContentPackage | null;
  onOpenChange(open: boolean): void;
}) {
  if (!value) return null;
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title={value.contentPackage.document.title}
      description={`${value.contentPackage.schemaVersion} · ${value.contentPackage.checksum.slice(0, 16)}`}
      size="wide"
    >
      <div className="grid gap-5">
        <p className="text-sm leading-6 text-[var(--muted-strong)]">
          {value.contentPackage.document.digest}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">可发布内容包</Badge>
          <Badge>{value.contentPackage.evidence.length} 条证据</Badge>
          <Badge>{value.contentPackage.assets.length} 个资源</Badge>
          <Badge>{value.contentPackage.materials.length} 个来源</Badge>
        </div>
        <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
          <PackageFact
            label="内容方案"
            value={`${value.contentPackage.origin.planId} · v${value.contentPackage.origin.planRevision}`}
          />
          <PackageFact label="编译器" value={`v${value.contentPackage.build.compilerVersion}`} />
          <PackageFact label="质量策略" value={value.contentPackage.quality.policyVersion} />
        </dl>
        {value.contentPackage.quality.warnings.length ? (
          <div className="grid gap-2 border-l-2 border-[var(--warning-border)] pl-4 text-sm text-[var(--warning)]">
            {value.contentPackage.quality.warnings.map((warning) => (
              <p key={`${warning.code}:${warning.message}`}>{warning.message}</p>
            ))}
          </div>
        ) : null}
        <ArticleDocumentView
          document={value.contentPackage.document}
          assets={value.contentPackage.assets}
          evidence={value.contentPackage.evidence}
          materials={value.contentPackage.materials}
        />
      </div>
    </AppDialog>
  );
}

function PackageFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 py-2.5">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="m-0 break-all text-[var(--ink-2)]">{value}</dd>
    </div>
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
  const candidates = useMemo(
    () => (value ? (workspace?.publishTargets ?? []) : []),
    [value, workspace],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const publish = useMutation({
    mutationFn: () => startPublication({ packageId: value!.id, targetIds: selected }),
    onSuccess: () => {
      onOpenChange(false);
      refresh();
    },
  });
  if (!value) return null;
  const active = selected.filter((id) => candidates.some((target) => target.id === id));
  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="发布内容包"
      description="每个目标独立执行，失败和结果未知都会留下可恢复记录。"
      size="medium"
    >
      <div className="grid gap-3">
        {!candidates.length ? (
          <p className="text-sm text-[var(--muted-strong)]">还没有可用发布目标。</p>
        ) : (
          candidates.map((target) => {
            const account = workspace?.channelAccounts.find(
              (item) => item.id === target.channelAccountId,
            );
            return (
              <label
                key={target.id}
                className="flex items-center gap-3 rounded border border-[var(--border)] px-3 py-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={active.includes(target.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(target.id)
                        ? current.filter((id) => id !== target.id)
                        : [...current, target.id],
                    )
                  }
                />
                <span>
                  <strong>{target.name}</strong>
                  <span className="ml-2 text-xs text-[var(--muted)]">{account?.name}</span>
                </span>
              </label>
            );
          })
        )}
        <FormError error={publish.error} />
      </div>
      <AppDialogFooter className="flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>取消</Button>
        <Button
          variant="primary"
          loading={publish.isPending}
          disabled={!active.length}
          onClick={() => publish.mutate()}
        >
          确认发布
        </Button>
      </AppDialogFooter>
    </AppDialog>
  );
}
