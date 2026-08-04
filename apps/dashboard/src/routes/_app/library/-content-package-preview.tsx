import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RunRecord, StoredContentPackage } from "#platform/api/types.ts";
import { Badge } from "#components/ui/badge.tsx";
import { runInstanceTitle, runStatusLabel, runStatusTone } from "../jobs/-run-presentation.ts";
import { ArticleDocumentView } from "./-article-document-view.tsx";

export function ContentPackagePreview({
  value,
  generationRun,
  generationRunPending = false,
}: {
  value: StoredContentPackage;
  generationRun?: RunRecord;
  generationRunPending?: boolean;
}) {
  return (
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
          label="生成运行"
          value={
            generationRun ? (
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  to="/jobs/$runId"
                  params={{ runId: generationRun.id }}
                  className="font-medium text-[var(--info)] underline decoration-[var(--info-border)] underline-offset-2"
                >
                  {runInstanceTitle(generationRun)}
                </Link>
                <Badge tone={runStatusTone(generationRun.status)}>
                  {runStatusLabel(generationRun.status)}
                </Badge>
              </span>
            ) : generationRunPending ? (
              <span className="text-[var(--muted)]">正在关联生成运行…</span>
            ) : (
              <span className="text-[var(--muted)]">历史内容包，生成运行不可用</span>
            )
          }
        />
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
  );
}

function PackageFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 py-2.5">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-[var(--ink-2)]">{value}</dd>
    </div>
  );
}
