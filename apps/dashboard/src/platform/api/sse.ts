/** A small incremental SSE parser that accepts LF, CRLF and CR line endings. */
export class SseParser {
  private line = "";
  private pendingCarriageReturn = false;
  private dataLines: string[] = [];

  constructor(private readonly onData: (data: string) => void) {}

  push(chunk: string): void {
    for (const character of chunk) {
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.finishLine();
        if (character === "\n") continue;
      }
      if (character === "\r") {
        this.pendingCarriageReturn = true;
      } else if (character === "\n") {
        this.finishLine();
      } else {
        this.line += character;
      }
    }
  }

  finish(): void {
    if (this.pendingCarriageReturn) {
      this.pendingCarriageReturn = false;
      this.finishLine();
    }
    // An event is dispatched only after a blank line. A partial frame at EOF is intentionally
    // ignored so that a truncated response cannot be mistaken for a complete runtime event.
  }

  private finishLine(): void {
    const line = this.line;
    this.line = "";
    if (!line) {
      if (this.dataLines.length) this.onData(this.dataLines.join("\n"));
      this.dataLines = [];
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.dataLines.push(value);
  }
}

export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser(onData);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) parser.push(decoder.decode(value, { stream: !done }));
      if (done) {
        parser.push(decoder.decode());
        parser.finish();
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function isEventStreamContentType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream";
}
