import { expect, test } from "vite-plus/test";
import { consumeSse, isEventStreamContentType, SseParser } from "./sse.ts";

test("SSE parser accepts LF, CRLF and CR frames across chunk boundaries", () => {
  const received: string[] = [];
  const parser = new SseParser((data) => received.push(data));

  parser.push(": heartbeat\n");
  parser.push('event: runtime\ndata: {"line":1}\n\n');
  parser.push("data: first\r\ndata: second\r");
  parser.push("\n\r\n");
  parser.push("data: old-mac\r\r");
  parser.finish();

  expect(received).toEqual(['{"line":1}', "first\nsecond", "old-mac"]);
});

test("SSE parser does not emit a truncated frame at EOF", () => {
  const received: string[] = [];
  const parser = new SseParser((data) => received.push(data));
  parser.push("data: partial");
  parser.finish();
  expect(received).toEqual([]);
});

test("SSE stream consumer decodes split UTF-8 text", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode("data: 你好\n\n");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 8));
      controller.enqueue(bytes.slice(8));
      controller.close();
    },
  });
  const received: string[] = [];
  await consumeSse(stream, (data) => received.push(data));
  expect(received).toEqual(["你好"]);
});

test("event stream content type allows parameters but rejects ordinary responses", () => {
  expect(isEventStreamContentType("text/event-stream; charset=utf-8")).toBe(true);
  expect(isEventStreamContentType("TEXT/EVENT-STREAM")).toBe(true);
  expect(isEventStreamContentType("application/json")).toBe(false);
  expect(isEventStreamContentType(null)).toBe(false);
});
