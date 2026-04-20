/**
 * Minimal Server-Sent Events parser for the Fetch API.
 *
 * The Node gateway emits frames like:
 *
 *     event: token
 *     data: {"delta":"..."}
 *     <blank line>
 *
 * This parser:
 *   - Decodes the byte stream as UTF-8.
 *   - Buffers across chunk boundaries until it sees a blank line (the
 *     SSE "dispatch" marker) — that's when a complete frame is ready.
 *   - Concatenates multi-line `data:` payloads with newlines, per spec.
 *   - Yields one `SseEvent` per dispatch.
 *
 * Anything the server omits (no `event:` line) defaults to `"message"`.
 */

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";

  const flushFrame = (raw: string): SseEvent | null => {
    if (!raw.trim()) return null;

    let eventName = "message";
    let dataLines: string[] = [];
    let id: string | undefined;

    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value =
        colon === -1
          ? ""
          : line.slice(colon + 1).startsWith(" ")
            ? line.slice(colon + 2)
            : line.slice(colon + 1);

      if (field === "event") eventName = value;
      else if (field === "data") dataLines.push(value);
      else if (field === "id") id = value;
    }

    return {
      event: eventName,
      data: dataLines.join("\n"),
      id,
    };
  };

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        const last = flushFrame(buffer);
        if (last) yield last;
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawFrame = buffer.slice(0, sepIdx);
        const match = buffer.slice(sepIdx).match(/^\r?\n\r?\n/);
        const sepLen = match ? match[0].length : 2;
        buffer = buffer.slice(sepIdx + sepLen);
        const frame = flushFrame(rawFrame);
        if (frame) yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
