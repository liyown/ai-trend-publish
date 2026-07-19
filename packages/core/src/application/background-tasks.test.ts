import { equal } from "node:assert/strict";
import { test } from "vite-plus/test";
import { MemoryJobStore, createJob, finishJob, startJob } from "@trendpublish/runtime";
import { InProcessBackgroundTasks, recoverBackgroundJobs } from "./background-tasks.ts";

test("in-process background tasks return immediately and can be drained", async () => {
  const runner = new InProcessBackgroundTasks();
  let completed = false;

  runner.start("test", async () => {
    await Promise.resolve();
    completed = true;
  });

  equal(completed, false);
  await runner.waitForIdle();
  equal(completed, true);
});

test("local startup resumes queued jobs and reconciles orphaned running jobs", async () => {
  const jobs = new MemoryJobStore();
  const queued = await jobs.create(createJob("article.generate", { planId: "plan-1" }));
  const orphaned = await jobs.create(createJob("content.publish", { packageId: "package-1" }));
  await jobs.update(startJob(orphaned, new Date("2026-07-18T11:59:00.000Z")));
  const runner = new InProcessBackgroundTasks();
  const resumed: string[] = [];

  await recoverBackgroundJobs({
    jobs,
    background: runner,
    now: () => new Date("2026-07-18T12:00:00.000Z"),
    resumers: {
      "article.generate": async (jobId) => {
        resumed.push(jobId);
        const claim = await jobs.claim({
          id: jobId,
          type: "article.generate",
          now: "2026-07-18T12:00:01.000Z",
        });
        if (claim.kind === "claimed") {
          await jobs.update(
            finishJob(claim.record, "succeeded", {}, new Date("2026-07-18T12:00:02.000Z")),
          );
        }
      },
    },
  });
  await runner.waitForIdle();

  equal(resumed[0], queued.id);
  equal((await jobs.get(queued.id))?.status, "succeeded");
  equal((await jobs.get(orphaned.id))?.status, "needs_attention");
  equal(
    (await jobs.get(orphaned.id))?.error,
    "本地服务在任务执行期间重启，已停止自动续跑；请确认外部副作用后手动恢复",
  );
});
