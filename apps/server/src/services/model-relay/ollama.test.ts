import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { ResolvedRoute } from "./domain.js";
import { callOllama, OllamaRequestError } from "./ollama.js";

const route: ResolvedRoute = {
  id: "route", capabilityId: "capability", deploymentId: "deployment", priority: 1,
  promptTemplate: "Describe", enabled: true, createdAt: "", updatedAt: "",
  endpointName: "Ollama", baseUrl: "http://ollama:11434", modelName: "vision", timeoutMs: 1_000
};

afterEach(() => vi.unstubAllGlobals());

test("a chunked response is cancelled as soon as it exceeds the byte limit", async () => {
  let chunksRead = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksRead += 1;
      if (chunksRead <= 8) controller.enqueue(new Uint8Array(512 * 1024));
      else controller.close();
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  vi.stubGlobal("fetch", async () => new Response(stream));

  await assert.rejects(callOllama(route, "AAAA"), (error: unknown) =>
    error instanceof OllamaRequestError && error.message === "OLLAMA_RESPONSE_TOO_LARGE" && !error.retryable);
  assert.equal(chunksRead, 3);
  assert.equal(cancelled, true);
});

test("valid JSON retains multibyte text split across response chunks", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ message: { content: "你好" } }));
  vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    }
  })));

  assert.equal((await callOllama(route, "AAAA")).text, "你好");
});

test("a valid response exactly at the byte limit is accepted", async () => {
  const envelopeBytes = Buffer.byteLength(JSON.stringify({ message: { content: "" } }));
  const content = "x".repeat(1_048_576 - envelopeBytes);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: { content } })));

  assert.equal((await callOllama(route, "AAAA")).text, content);
});

test("a response that stalls while reading still reports a retryable timeout", async () => {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      init.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    }
  })));

  await assert.rejects(callOllama({ ...route, timeoutMs: 10 }, "AAAA"), (error: unknown) =>
    error instanceof OllamaRequestError && error.message === "OLLAMA_TIMEOUT" && error.retryable);
});
