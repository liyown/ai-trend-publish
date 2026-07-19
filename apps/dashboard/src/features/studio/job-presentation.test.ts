import { expect, test } from "vite-plus/test";
import { JobType } from "@trendpublish/contracts";
import { isResumableJob } from "./job-presentation.ts";

test("all executable job types can resume from the dashboard", () => {
  expect(isResumableJob({ type: JobType.GenerateArticle })).toBe(true);
  expect(isResumableJob({ type: JobType.CompleteArticle })).toBe(true);
  expect(isResumableJob({ type: JobType.PublishContent })).toBe(true);
  expect(isResumableJob({ type: JobType.RunAutomation })).toBe(true);
  expect(isResumableJob({ type: "unknown" })).toBe(false);
});
