import { test } from "vite-plus/test";
import {
  JobStatus as ContractJobStatus,
  TaskEffect as ContractTaskEffect,
  TaskStatus as ContractTaskStatus,
} from "@trendpublish/contracts";
import { assertEquals } from "@trendpublish/core/test";
import {
  JobStatus as RuntimeJobStatus,
  TaskEffect as RuntimeTaskEffect,
  TaskStatus as RuntimeTaskStatus,
} from "@trendpublish/runtime";

test("HTTP execution vocabulary stays aligned with runtime serialization", () => {
  assertEquals(ContractJobStatus, RuntimeJobStatus);
  assertEquals(ContractTaskStatus, RuntimeTaskStatus);
  assertEquals(ContractTaskEffect, RuntimeTaskEffect);
});
