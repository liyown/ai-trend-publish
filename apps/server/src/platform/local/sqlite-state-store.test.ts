import { equal, ok } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { createWorkspaceEntity } from "@trendpublish/core/workspace";
import { createJob } from "@trendpublish/runtime";
import { asJobStore, asTaskStore, SQLiteStateStore } from "./sqlite-state-store.ts";

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
