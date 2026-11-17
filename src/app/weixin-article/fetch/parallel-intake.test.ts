import { assertEquals, assertThrows } from "@std/assert";
import { resolveTrendPublishConfig } from "@src/utils/config/define-config.ts";
import type { ContentScraper } from "@src/core/ports/content-scraper.ts";
import {
  planArticleSources,
  resolveSourceProviders,
} from "./article-fetch-planner.ts";
import { ArticleFetchRouter } from "./article-fetch-router.ts";

const QUERY = "Deno 2.7 release documentation";

function config() {
  return resolveTrendPublishConfig({
    providers: { fetch: { parallel: { publicReleaseQueries: [QUERY] } } },
    fetchGroups: { default: ["auto"], releases: ["parallel-search"] },
    features: { article: { sources: [`releases:query:${QUERY}`] } },
  });
}

Deno.test("Parallel intake requires an explicit group and a literal allowlisted query", () => {
  const enabled = config();
  assertEquals(planArticleSources(enabled)[0].providers, ["parallel-search"]);
  const disabled = config();
  disabled.providers.fetch.parallel!.publicReleaseQueries = [];
  assertThrows(
    () => planArticleSources(disabled),
    Error,
    "publicReleaseQueries",
  );

  const changed = config();
  changed.features.article.sources = [`releases:query:${QUERY} extra context`];
  assertThrows(
    () => planArticleSources(changed),
    Error,
    "publicReleaseQueries",
  );

  const url = config();
  url.features.article.sources = ["releases:https://deno.com/blog/v2.7"];
  assertThrows(() => planArticleSources(url));

  const defaults = config();
  defaults.fetchGroups.default = ["parallel-search"];
  defaults.features.article.sources = [`default:query:${QUERY}`];
  assertThrows(() => planArticleSources(defaults), Error, "provider");
});

Deno.test("auto and supplemental search never select Parallel even in custom settings", () => {
  assertEquals(resolveSourceProviders(QUERY, ["auto"], "query"), [
    "jina-search",
  ]);
  // Both normal supplemental research and the quality experiment use this
  // resolver without the operator-intake opt-in, even for fetchGroups.search.
  assertEquals(
    resolveSourceProviders(QUERY, ["parallel-search", "gdelt"], "query"),
    ["gdelt"],
  );
  assertEquals(resolveSourceProviders(QUERY, ["parallel-search"], "query"), []);
});

Deno.test("router accepts configured intake but rejects derived queries and page hydration", async () => {
  const enabled = config();
  const calls: string[] = [];
  const content = {
    id: "release",
    title: "Deno 2.7",
    url: "https://deno.com/blog/v2.7",
    content: "Public release notes",
    publishDate: "2026-02-25",
    metadata: { provider: "parallel-search" },
  };
  const scrapers = new Map<"parallel-search" | "jina", ContentScraper>([
    ["parallel-search", {
      scrape(query) {
        calls.push(query);
        return Promise.resolve([content]);
      },
    }],
    ["jina", {
      scrape() {
        throw new Error("must not fetch result pages");
      },
    }],
  ]);
  const router = new ArticleFetchRouter(enabled, scrapers);
  const source = planArticleSources(enabled)[0];
  assertEquals((await router.scrape(source)).contents[0].url, content.url);
  const derived = await router.scrape({
    ...source,
    raw: `search:${QUERY}`,
    group: "search",
  });
  assertEquals(derived.contents, []);
  assertEquals(derived.failures.length, 1);
  assertEquals(calls, [QUERY]);
  assertEquals((await router.hydrate(content)).content, content);
});

Deno.test("Parallel empty and unavailable responses retain router fallback and failures", async () => {
  for (const unavailable of [false, true]) {
    const enabled = config();
    enabled.fetchGroups.releases.push("gdelt");
    const router = new ArticleFetchRouter(
      enabled,
      new Map([
        ["parallel-search", {
          scrape() {
            if (unavailable) throw new Error("unavailable");
            return Promise.resolve([]);
          },
        }],
        ["gdelt", {
          scrape() {
            return Promise.resolve([{
              id: "fallback",
              title: "Release",
              content: "Notes",
              url: "https://example.com/release",
              publishDate: "",
              metadata: {},
            }]);
          },
        }],
      ]),
    );
    const result = await router.scrape(planArticleSources(enabled)[0]);
    assertEquals(result.provider, "gdelt");
    assertEquals(result.failures.length, 1);
    assertEquals(result.failures[0].provider, "parallel-search");
  }
});
