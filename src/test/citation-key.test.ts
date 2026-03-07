import { assertEquals } from "https://deno.land/std@0.217.0/assert/mod.ts";
import { buildLatexCitationKey } from "@src/utils/common.ts";

Deno.test("buildLatexCitationKey: 兼容 Google Scholar 作者格式（逗号分隔）", () => {
  const key = buildLatexCitationKey(
    "Li S, Yang B, Hu J",
    "2011",
    "Performance comparison of different multi-resolution transforms for image fusion",
  );

  assertEquals(key, "li2011performance");
});

Deno.test("buildLatexCitationKey: 兼容 and 连接作者", () => {
  const key = buildLatexCitationKey(
    "Li S and Yang B and Hu J",
    "2011",
    "Performance comparison of different multi-resolution transforms for image fusion",
  );

  assertEquals(key, "li2011performance");
});

Deno.test("buildLatexCitationKey: 跳过停用词", () => {
  const key = buildLatexCitationKey("Smith J", 2024, "The analysis of data systems");
  assertEquals(key, "smith2024analysis");
});
