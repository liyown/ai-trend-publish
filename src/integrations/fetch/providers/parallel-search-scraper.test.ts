import { assertEquals, assertRejects } from "@std/assert";
import { ParallelSearchScraper } from "./parallel-search-scraper.ts";

const QUERY = "Deno 2.7 release documentation";
const SOURCE_URL = "https://deno.com/blog/v2.7";

Deno.test("Parallel sends only the authorized query and preserves original URLs", async () => {
  const calls: Record<string, unknown>[] = [];
  const scraper = new ParallelSearchScraper(
    [QUERY],
    mcpFetch({
      content: [{
        type: "text",
        text: JSON.stringify({
          results: [
            {
              title: "Deno 2.7",
              url: SOURCE_URL,
              excerpts: ["Official release documentation", "Release notes"],
              publish_date: "2026-02-25",
            },
            { url: "javascript:alert(1)" },
            { title: "Missing URL" },
          ],
        }),
      }],
    }, calls),
  );

  const result = await scraper.scrape(QUERY);
  assertEquals(result.length, 1);
  assertEquals(result[0].url, SOURCE_URL);
  assertEquals(
    result[0].content,
    "Official release documentation Release notes",
  );
  assertEquals(result[0].metadata.provider, "parallel-search");
  assertEquals(calls.filter((call) => call.method === "tools/call"), [{
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search",
      arguments: { objective: QUERY, search_queries: [QUERY] },
    },
  }]);
  assertEquals(
    calls.every((call) =>
      ["initialize", "notifications/initialized", "tools/call"].includes(
        String(call.method),
      )
    ),
    true,
  );
});

Deno.test("Parallel is disabled without literal query authorization", async () => {
  let requests = 0;
  const fetcher: typeof fetch = () => {
    requests++;
    throw new Error("unexpected request");
  };
  for (
    const [allowed, query] of [
      [[], QUERY],
      [[QUERY], `${QUERY} private context`],
      [[QUERY], ` ${QUERY}`],
      [[QUERY], "https://deno.com/blog/v2.7"],
    ] as [string[], string][]
  ) {
    await assertRejects(
      () => new ParallelSearchScraper(allowed, fetcher).scrape(query),
      Error,
      "must match",
    );
  }
  assertEquals(requests, 0);
});

Deno.test("Parallel handles structured and empty results and rejects tool errors", async () => {
  const empty = new ParallelSearchScraper(
    [QUERY],
    mcpFetch({
      content: [],
      structuredContent: { results: [] },
    }),
  );
  assertEquals(await empty.scrape(QUERY), []);
  for (
    const result of [
      { content: [{ type: "text", text: "unavailable" }], isError: true },
      { content: [] },
      { content: [], structuredContent: { unexpected: [] } },
    ]
  ) {
    await assertRejects(
      () => new ParallelSearchScraper([QUERY], mcpFetch(result)).scrape(QUERY),
      Error,
    );
  }
});

Deno.test("Parallel reports unavailable HTTP service", async () => {
  await assertRejects(
    () =>
      new ParallelSearchScraper(
        [QUERY],
        () => Promise.resolve(new Response("Unavailable", { status: 503 })),
      )
        .scrape(QUERY),
    Error,
  );
});

Deno.test("Parallel aborts a stalled request within its timeout", async () => {
  let aborted = false;
  const scraper = new ParallelSearchScraper(
    [QUERY],
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => {
          aborted = true;
          reject(init!.signal!.reason);
        }, { once: true });
      }),
    20,
  );
  await assertRejects(() => scraper.scrape(QUERY));
  assertEquals(aborted, true);
});

function mcpFetch(
  result: unknown,
  calls: Record<string, unknown>[] = [],
): typeof fetch {
  return async (input, init) => {
    assertEquals(String(input), "https://mcp.parallel.ai/mcp?tools=web_search");
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("user-agent"), "TrendPublish/parallel-search");
    assertEquals(headers.has("authorization"), false);
    assertEquals(headers.has("cookie"), false);
    assertEquals(init?.redirect, "error");
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body));
    calls.push(request);
    if (!request.id && request.id !== 0) {
      return new Response(null, { status: 202 });
    }
    const response = {
      jsonrpc: "2.0",
      id: request.id,
      result: request.method === "initialize"
        ? {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1.0" },
        }
        : result,
    };
    return new Response(
      `event: message\ndata: ${JSON.stringify(response)}\n\n`,
      {
        headers: { "content-type": "text/event-stream" },
      },
    );
  };
}
