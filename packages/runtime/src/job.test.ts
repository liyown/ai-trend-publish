import { describe, expect, it } from "vite-plus/test";
import { JobClaimKind, createJob, finishJob, MemoryJobStore, startJob } from "./job.ts";

describe("job lifecycle", () => {
  it("persists explicit lifecycle transitions", async () => {
    const store = new MemoryJobStore();
    const created = await store.create(createJob("article.generate", { planId: "plan-1" }));
    const running = await store.update(startJob(created));
    const finished = await store.update(finishJob(running, "succeeded", { output: { id: "pkg" } }));

    expect((await store.get(finished.id))?.status).toBe("succeeded");
    expect(await store.list("article.generate")).toHaveLength(1);
  });

  it("grants only one concurrent execution claim", async () => {
    const store = new MemoryJobStore();
    const created = await store.create(createJob("article.generate", { planId: "plan-1" }));
    const input = {
      id: created.id,
      type: created.type,
      now: "2026-07-18T12:00:00.000Z",
    };

    const claims = await Promise.all([store.claim(input), store.claim(input)]);

    expect(claims.map((claim) => claim.kind).sort()).toEqual(
      [JobClaimKind.Active, JobClaimKind.Claimed].sort(),
    );
  });

  it("clears the previous outcome when a failed job starts another attempt", () => {
    const queued = createJob("article.generate", { planId: "plan-1" });
    const failed = finishJob(
      startJob(queued, new Date("2026-07-18T12:00:00.000Z")),
      "failed",
      { output: { stale: true }, error: "failed once" },
      new Date("2026-07-18T12:01:00.000Z"),
    );

    const restarted = startJob(failed, new Date("2026-07-18T12:02:00.000Z"));

    expect(restarted.status).toBe("running");
    expect(restarted.output).toBeUndefined();
    expect(restarted.error).toBeUndefined();
    expect(restarted.finishedAt).toBeUndefined();
    expect(restarted.startedAt).toBe("2026-07-18T12:02:00.000Z");
  });

  it("replays successful terminal jobs without claiming them again", async () => {
    const succeeded = finishJob(
      startJob(createJob("article.generate", { planId: "plan-1" })),
      "succeeded",
      { output: { id: "package-1" } },
    );
    const store = new MemoryJobStore([succeeded]);

    const claim = await store.claim({
      id: succeeded.id,
      type: succeeded.type,
      now: "2026-07-18T12:03:00.000Z",
    });

    expect(claim.kind).toBe(JobClaimKind.Terminal);
    expect(claim.record).toEqual(succeeded);
    expect(await store.get(succeeded.id)).toEqual(succeeded);
  });
});
