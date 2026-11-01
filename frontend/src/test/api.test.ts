import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API client", () => {
  it("streams meta, delta and done events split across network chunks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse([
      'event: meta\ndata: {"conversation_id":7,"conversation_title":"T","generator":"offline","sources":[],"user_message_id":1,"mode":"chat"}\n\nevent: del',
      'ta\ndata: {"text":"Hello "}\n\nevent: delta\ndata: {"text":"world"}\n\n',
      'event: done\ndata: {"message_id":9,"conversation_id":7,"conversation_title":"T","generator":"offline","note":"offline","sources":[]}\n\n',
    ]));
    const meta = vi.fn();
    const delta = vi.fn();
    const done = vi.fn();
    await api.chatStream({ message: "hi" }, { onMeta: meta, onDelta: delta, onDone: done });
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: 7, generator: "offline" }));
    expect(delta.mock.calls.map((call) => call[0]).join("")).toBe("Hello world");
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ message_id: 9 }));
  });

  it("sends session cookies and emits an unauthorized event on 401", async () => {
    const listener = vi.fn();
    window.addEventListener("aec:unauthorized", listener);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ detail: "Authentication required.", auth_required: true }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));
    await expect(api.subjects()).rejects.toMatchObject({ status: 401, authRequired: true });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/subjects"), expect.objectContaining({ credentials: "include" }));
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail.authRequired).toBe(true);
    window.removeEventListener("aec:unauthorized", listener);
  });

  it("surfaces FastAPI validation messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ detail: [{ msg: "field required" }, { msg: "invalid email" }] }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    ));
    await expect(api.login("bad", "short")).rejects.toThrow("field required, invalid email");
    await expect(api.login("bad", "short")).rejects.toBeInstanceOf(ApiError);
  });
});
