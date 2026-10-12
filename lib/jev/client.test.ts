import { describe, expect, it } from "vitest";
import type { DecisionsApiRequest } from "./request.js";
import { callJevDecisions, JevClientError } from "./client.js";

const fakeRequest: DecisionsApiRequest = {
  model: "typesafe/jev-1.13",
  state: { transaction: {} as never, psps: [] },
  questions: { psp_selection: { type: "choice", instructions: "x", criteria: { alpha: "a" } } },
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "Content-Type": "application/json" } });
}

describe("callJevDecisions", () => {
  it("sends the API key as a bearer token and the request as the JSON body", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ model: "typesafe/jev-1.13", answers: { psp_selection: { type: "choice", choice: "alpha", probabilities: { alpha: 1 } } } });
    }) as typeof fetch;

    await callJevDecisions(fakeRequest, { apiKey: "test-key", fetchImpl });

    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(capturedInit!.body as string)).toEqual(fakeRequest);
  });

  it("returns the parsed, validated response on success", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        model: "typesafe/jev-1.13",
        answers: { psp_selection: { type: "choice", choice: "beta", probabilities: { beta: 1 }, confidence: 0.8 } },
      })) as typeof fetch;

    const result = await callJevDecisions(fakeRequest, { apiKey: "test-key", fetchImpl });
    expect(result.answers.psp_selection!.choice).toBe("beta");
  });

  it("throws JevClientError when the network call itself fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await expect(callJevDecisions(fakeRequest, { apiKey: "test-key", fetchImpl })).rejects.toBeInstanceOf(JevClientError);
  });

  it("throws JevClientError on a non-2xx status", async () => {
    const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    await expect(callJevDecisions(fakeRequest, { apiKey: "test-key", fetchImpl })).rejects.toThrow(/status 429/);
  });

  it("throws JevClientError when the response body fails shape validation", async () => {
    const fetchImpl = (async () => jsonResponse({ not: "a valid response" })) as typeof fetch;
    await expect(callJevDecisions(fakeRequest, { apiKey: "test-key", fetchImpl })).rejects.toBeInstanceOf(JevClientError);
  });

  it("aborts and throws when the call exceeds the timeout", async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as typeof fetch;

    await expect(callJevDecisions(fakeRequest, { apiKey: "test-key", fetchImpl, timeoutMs: 10 })).rejects.toBeInstanceOf(JevClientError);
  });
});
