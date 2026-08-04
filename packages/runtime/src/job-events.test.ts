import { expect, test } from "vite-plus/test";
import { RuntimeEventHub } from "./events.ts";
import { EventedJobStore, MemoryJobStore, createJob } from "./job.ts";

test("evented job store publishes creation and status changes", async () => {
  const events = new RuntimeEventHub();
  const jobs = new EventedJobStore(new MemoryJobStore(), events);
  const created = await jobs.create(createJob("article.generate", { planId: "plan" }));
  await jobs.claim({ id: created.id, type: created.type, now: new Date().toISOString() });

  expect(events.recent({ jobId: created.id }).map((event) => event.type)).toEqual([
    "job.created",
    "job.status.changed",
  ]);
  expect(
    (events.recent({ jobId: created.id })[1]?.data as { status?: string } | undefined)?.status,
  ).toBe("running");
});
