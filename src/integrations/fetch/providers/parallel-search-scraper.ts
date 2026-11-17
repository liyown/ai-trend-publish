import { Client } from "npm:@modelcontextprotocol/sdk@1.32.2/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.32.2/client/streamableHttp.js";
import { z } from "npm:zod@3.25.76";
import type {
  ContentScraper,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import {
  normalizeLimit,
  toSearchScrapedContent,
} from "./search-result-utils.ts";

const SERVER_URL = "https://mcp.parallel.ai/mcp?tools=web_search";
const USER_AGENT = "TrendPublish/parallel-search";
const TIMEOUT_MS = 30000;
const SearchResponseSchema = z.object({
  results: z.array(z.object({
    url: z.string().optional(),
    title: z.string().optional(),
    excerpts: z.array(z.string()).optional(),
    publish_date: z.string().nullish(),
  })),
});

/** Search-only intake for literal, operator-authorized public release queries. */
export class ParallelSearchScraper implements ContentScraper {
  constructor(
    private readonly publicReleaseQueries: readonly string[] = [],
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    if (!query.trim() || !this.publicReleaseQueries.includes(query)) {
      throw new Error(
        "Parallel query must match providers.fetch.parallel.publicReleaseQueries exactly",
      );
    }

    const signal = AbortSignal.timeout(this.timeoutMs);
    const client = new Client({ name: "trendpublish", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
      requestInit: {
        headers: { "User-Agent": USER_AGENT },
        redirect: "error",
      },
      fetch: (input, init) =>
        this.fetcher(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([signal, init.signal])
            : signal,
        }),
    });

    try {
      await client.connect(transport, { signal, timeout: this.timeoutMs });
      const result = await client.callTool(
        {
          name: "web_search",
          arguments: { objective: query, search_queries: [query] },
        },
        undefined,
        { signal, timeout: this.timeoutMs },
      );
      if (result.isError) {
        throw new Error("Parallel web_search returned an error");
      }

      const text = result.content.find((item) => item.type === "text");
      const payload = result.structuredContent ??
        (text?.type === "text" ? JSON.parse(text.text) : undefined);
      const parsed = SearchResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("Parallel web_search returned invalid search results");
      }
      return parsed.data.results.flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "parallel-search",
          query,
          rank: index + 1,
          url: item.url,
          title: item.title,
          content: item.excerpts?.join("\n\n"),
          publishedAt: item.publish_date ?? undefined,
        })
      ).slice(0, normalizeLimit(options?.limit, 10, 10));
    } finally {
      await client.close();
    }
  }
}
