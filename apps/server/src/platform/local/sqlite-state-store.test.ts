import { equal, ok } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { RunKind, RunTriggerKind } from "@trendpublish/contracts";
import { createWorkspaceEntity } from "@trendpublish/core/workspace";
import { createJob, RunManager, RuntimeEventHub } from "@trendpublish/runtime";
import { asJobStore, asRunStore, asTaskStore, SQLiteStateStore } from "./sqlite-state-store.ts";

test("SQLite state survives restart and persists unknown unsafe outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trendpublish-state-"));
  const databasePath = join(directory, "state.sqlite3");
  try {
    const first = new SQLiteStateStore(databasePath);
    await first.ensureSchema();
    const identity = createWorkspaceEntity({
      id: "identity-1",
      name: "Test",
      enabled: true,
      positioning: "Positioning",
      audience: "Audience",
      tone: "Tone",
      forbiddenTopics: [],
    });
    await first.save("identity", identity);
    const tasks = asTaskStore(first);
    const initial = await tasks.claim({
      jobId: "job-1",
      taskId: "external-publish",
      fingerprint: "same-input",
      version: "1",
      effect: "unsafe",
      leaseMs: 1,
      now: "2026-07-14T00:00:00.000Z",
    });
    equal(initial.kind, "claimed");
    first.close();

    const reopened = new SQLiteStateStore(databasePath);
    await reopened.ensureSchema();
    ok(await reopened.get("identity", identity.id));
    const resumedTasks = asTaskStore(reopened);
    const resumed = await resumedTasks.claim({
      jobId: "job-1",
      taskId: "external-publish",
      fingerprint: "same-input",
      version: "1",
      effect: "unsafe",
      leaseMs: 1,
      now: "2026-07-14T00:00:01.000Z",
    });
    equal(resumed.kind, "unknown");
    equal((await resumedTasks.get("job-1", "external-publish"))?.status, "unknown");
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite job claims use a compare-and-set transition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trendpublish-job-claim-"));
  const databasePath = join(directory, "state.sqlite3");
  try {
    const state = new SQLiteStateStore(databasePath);
    await state.ensureSchema();
    const jobs = asJobStore(state);
    const job = await jobs.create(createJob("article.generate", { planId: "plan-1" }));
    const input = {
      id: job.id,
      type: job.type,
      now: "2026-07-18T12:00:00.000Z",
    };

    const claims = await Promise.all([jobs.claim(input), jobs.claim(input)]);

    equal(claims.filter((claim) => claim.kind === "claimed").length, 1);
    equal(claims.filter((claim) => claim.kind === "active").length, 1);
    equal((await jobs.get(job.id))?.status, "running");
    state.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite run activities update in place and survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trendpublish-run-state-"));
  const databasePath = join(directory, "state.sqlite3");
  try {
    const first = new SQLiteStateStore(databasePath);
    await first.ensureSchema();
    const jobs = asJobStore(first);
    const runs = new RunManager(asRunStore(first), jobs, new RuntimeEventHub());
    const run = await runs.createRun({
      kind: RunKind.Content,
      trigger: { kind: RunTriggerKind.Debug },
    });
    const session = await runs.createMainSession(run.id);
    const job = await jobs.create(
      createJob("article.generate", {}, new Date(), { runId: run.id, sessionId: session.id }),
    );
    await runs.onTaskActivity({
      jobId: job.id,
      taskId: "react/agent/tool/1/1-search_sources",
      attempt: 1,
      effect: "pure",
      input: { query: "AI" },
      status: "running",
      occurredAt: "2026-08-04T12:00:00.000Z",
    });
    await runs.onTaskActivity({
      jobId: job.id,
      taskId: "react/agent/tool/1/1-search_sources",
      attempt: 1,
      effect: "pure",
      output: { count: 3 },
      status: "succeeded",
      occurredAt: "2026-08-04T12:00:01.000Z",
    });
    await asRunStore(first).setSchemaVersion?.(
      "react-run-records",
      "1",
      "2026-08-04T12:00:02.000Z",
    );
    first.close();

    const reopened = new SQLiteStateStore(databasePath);
    await reopened.ensureSchema();
    const activities = await asRunStore(reopened).listActivities(run.id);
    equal(activities.length, 1);
    equal(activities[0]?.sequence, 2);
    equal(activities[0]?.status, "succeeded");
    equal(JSON.stringify(activities[0]?.output), JSON.stringify({ count: 3 }));
    equal(await asRunStore(reopened).getSchemaVersion?.("react-run-records"), "1");
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
