import { equal } from "node:assert/strict";
import { test } from "vite-plus/test";
import { suggestConnectionName } from "../apps/dashboard/src/features/studio/connection-naming.ts";

test("uses the connector name when it is unused", () => {
  equal(suggestConnectionName("MiniMax", ["OpenAI"]), "MiniMax");
});

test("uses the smallest available suffix for repeated connectors", () => {
  equal(suggestConnectionName("MiniMax", ["MiniMax", "MiniMax 2", "MiniMax 4"]), "MiniMax 3");
});

test("normalizes connection names before comparing them", () => {
  equal(suggestConnectionName("MiniMax", [" minimax ", "MINIMAX 2"]), "MiniMax 3");
});
