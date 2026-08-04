import { JobStatus, JobType } from "@trendpublish/contracts";
import type { JobRecord } from "#platform/api/types.ts";

export function jobTypeLabel(type: string): string {
  if (type === JobType.GenerateArticle) return "文章生成";
  if (type === JobType.CompleteArticle) return "人工修订完成";
  if (type === JobType.PublishContent) return "内容发布";
  if (type === JobType.RunAutomation) return "自动化任务运行";
  return type;
}

export function jobStatusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === JobStatus.Succeeded) return "success";
  if (status === JobStatus.Failed || status === JobStatus.NeedsAttention) return "danger";
  if (
    status === JobStatus.Running ||
    status === JobStatus.Queued ||
    status === JobStatus.Degraded
  ) {
    return "warning";
  }
  return "neutral";
}

export function isResumableJob(job: Pick<JobRecord, "type">): boolean {
  return (
    job.type === JobType.GenerateArticle ||
    job.type === JobType.CompleteArticle ||
    job.type === JobType.PublishContent ||
    job.type === JobType.RunAutomation
  );
}
