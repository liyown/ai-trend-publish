import { expect, test } from "vite-plus/test";
import { ChannelId, JobType, RunStatus, WorkspaceKind } from "@trendpublish/contracts";
import { createWorkspaceEntity, MemoryWorkspaceRepository } from "@trendpublish/core/workspace";
import {
  MemoryJobStore,
  MemoryRunStore,
  MemoryTaskStore,
  RunManager,
  RuntimeEventHub,
  createJob,
  fingerprint,
  finishJob,
  startJob,
} from "@trendpublish/runtime";
import { migrateRunRecords } from "./run-record-migration.ts";

test("legacy automation jobs become one run with main and publication sessions", async () => {
  const workspace = new MemoryWorkspaceRepository();
  const jobs = new MemoryJobStore();
  const tasks = new MemoryTaskStore();
  const events = new RuntimeEventHub();
  const runs = new RunManager(new MemoryRunStore(), jobs, events);
  await workspace.save(
    WorkspaceKind.ChannelAccount,
    createWorkspaceEntity({
      id: "account-weixin",
      name: "历史公众号",
      enabled: true,
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "connection-weixin",
      settings: {},
    }),
  );

  const article = finishJob(
    startJob(createJob(JobType.GenerateArticle, { planId: "plan-legacy" })),
    "succeeded",
    { output: { packageId: "package-legacy" } },
  );
  const destination = {
    accountId: "account-weixin",
    publicationType: "article",
    options: { author: "作者" },
  };
  const publication = finishJob(
    startJob(
      createJob(JobType.PublishContent, {
        packageId: "package-legacy",
        destinations: [destination],
      }),
    ),
    "failed",
    { error: "draft failed" },
  );
  const automation = finishJob(
    startJob(createJob(JobType.RunAutomation, { automationId: "automation-legacy" })),
    "degraded",
    { error: "publication failed" },
  );
  automation.checkpoint = {
    articleJobId: article.id,
    publicationJobId: publication.id,
  };
  await jobs.create(article);
  await jobs.create(publication);
  await jobs.create(automation);
  tasks.seed({
    jobId: article.id,
    taskId: "legacy/compiler",
    fingerprint: "legacy-main",
    version: "1",
    effect: "pure",
    status: "succeeded",
    attempt: 1,
    output: { title: "历史内容" },
    startedAt: article.createdAt,
    updatedAt: article.updatedAt,
    finishedAt: article.updatedAt,
  });
  const checksum = await fingerprint({
    ...destination,
    channel: ChannelId.WeixinOfficialAccount,
  });
  const destinationId = `destination_${checksum.slice(0, 24)}`;
  tasks.seed({
    jobId: publication.id,
    taskId: `publish/destination:${destinationId}/create-draft`,
    fingerprint: "legacy-publication",
    version: "1",
    effect: "unsafe",
    status: "failed",
    attempt: 1,
    error: "draft failed",
    startedAt: publication.createdAt,
    updatedAt: publication.updatedAt,
    finishedAt: publication.updatedAt,
  });
  const runtime = { workspace, jobs, tasks, events, runs };

  await migrateRunRecords(runtime);
  const runId = `run-legacy-${automation.id}`;
  const detail = await runs.getDetail(runId);

  expect(detail?.run.trigger).toEqual({
    kind: "automation",
    automationId: "automation-legacy",
  });
  expect(detail?.run.status).toBe(RunStatus.Partial);
  expect(detail?.sessions).toHaveLength(2);
  expect(detail?.sessions.find((session) => session.kind === "main")?.status).toBe(
    RunStatus.Succeeded,
  );
  expect(
    detail?.sessions.find((session) => session.destination?.destinationId === destinationId)
      ?.status,
  ).toBe(RunStatus.Failed);
  expect((await runs.store.listActivities(runId)).map((activity) => activity.kind)).toEqual([
    "historical_task",
    "historical_task",
  ]);
  expect((await jobs.get(article.id))?.parentJobId).toBe(automation.id);

  await migrateRunRecords(runtime);
  expect(await runs.store.listRuns()).toHaveLength(1);
  expect(await runs.store.listActivities(runId)).toHaveLength(2);
});
