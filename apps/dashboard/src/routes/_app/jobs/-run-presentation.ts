import { RunStatus, type RunRecord, type RunSession } from "#platform/api/types.ts";

export function runStatusLabel(status: RunRecord["status"]): string {
  if (status === RunStatus.Queued) return "等待运行";
  if (status === RunStatus.Running) return "运行中";
  if (status === RunStatus.Succeeded) return "已完成";
  if (status === RunStatus.Partial) return "部分完成";
  if (status === RunStatus.NeedsAttention) return "需要处理";
  return "失败";
}

export function runStatusTone(
  status: RunRecord["status"],
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === RunStatus.Running) return "info";
  if (status === RunStatus.Succeeded) return "success";
  if (status === RunStatus.Partial || status === RunStatus.NeedsAttention) return "warning";
  if (status === RunStatus.Failed) return "danger";
  return "neutral";
}

export function runTitle(run: RunRecord): string {
  return (
    run.title ||
    run.requestedTopic ||
    run.planName ||
    (run.kind === "publication" ? "内容发布" : "内容生成")
  );
}

/** A plan-scoped label that distinguishes one run from other runs of the same plan. */
export function runInstanceTitle(run: RunRecord): string {
  const specificTitle = [run.title, run.requestedTopic].find(
    (value) => value?.trim() && value.trim() !== run.planName?.trim(),
  );
  if (specificTitle) return specificTitle.trim();
  const createdAt = new Date(run.createdAt);
  if (Number.isNaN(createdAt.getTime())) return "本次运行";
  return createdAt.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function runSummary(run: RunRecord): string {
  if (run.kind === "publication") {
    return publicationSummary(run);
  }
  if (!run.publicationSummary.total) return "主流程 · 仅生成内容包";
  return `主流程 · ${publicationSummary(run)}`;
}

export function sessionLabel(session: RunSession): string {
  if (session.kind === "main") return "主流程";
  return `${session.destination?.accountName ?? "发布账号"} · ${publicationTypeLabel(session.destination?.publicationType)}`;
}

export function publicationTypeLabel(type?: string): string {
  if (type === "article") return "图文";
  if (type === "video") return "视频";
  if (type === "audio") return "音频";
  return type || "发布";
}

function publicationSummary(run: RunRecord): string {
  const summary = run.publicationSummary;
  if (!summary.total) return "尚未开始发布";
  return `发布 ${summary.succeeded}/${summary.total}`;
}
