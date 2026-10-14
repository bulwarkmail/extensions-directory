import { afterEach, describe, expect, it, vi } from "vitest";
import { submit, waitFor, type Submission } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sub = (status: string): Submission => ({
  id: "s1", slug: "x", version: "1.0.0", status, dryRun: false, error: null, url: "u", statusUrl: "https://ext.test/api/v2/submissions/s1",
  pollToken: "bwp_x", source: { host: "github.com", repo: "a/b", ref: "v1", commit: "c".repeat(40), subpath: "" }, checks: { webmail: null, scan: null },
});

describe("submit", () => {
  it("asks GitHub for an OIDC token with the directory as audience and sends it", async () => {
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", "https://pipelines.example/token?api-version=2.0");
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "runner-secret");
    const calls: { url: string; auth: string | null; body?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url, auth: new Headers(init.headers).get("authorization"), body: init.body as string | undefined });
      if (url.startsWith("https://pipelines.example")) return Response.json({ value: "eyJ.oidc.token" });
      return Response.json({ data: sub("queued") }, { status: 202 });
    });
    await submit({ directory: "https://ext.test/", subpath: "my-plugin" });
    expect(calls[0]).toMatchObject({ url: "https://pipelines.example/token?api-version=2.0&audience=https%3A%2F%2Fext.test", auth: "Bearer runner-secret" });
    expect(calls[1]).toMatchObject({ url: "https://ext.test/api/v2/publish", auth: "Bearer eyJ.oidc.token", body: JSON.stringify({ subpath: "my-plugin" }) });
  });

  it("fails clearly without any credentials", async () => {
    vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", "");
    await expect(submit({ directory: "https://ext.test" })).rejects.toThrow(/No credentials/);
  });

  it("passes the directory's error message on", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "wrong_workflow", message: "Workflow x is not a trusted publisher here" } }, { status: 403 }));
    await expect(submit({ directory: "https://ext.test", token: "bwx_t" })).rejects.toMatchObject({ status: 403, code: "wrong_workflow", message: expect.stringContaining("not a trusted publisher") });
  });
});

describe("waitFor", () => {
  it("polls with the poll token until the submission settles", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const states = ["building", "building", "awaiting_review"];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
      seen.push(new Headers(init.headers).get("authorization") ?? "");
      return Response.json({ data: sub(states.shift()!) });
    });
    const p = waitFor(sub("queued"), "bwp_x");
    await vi.runAllTimersAsync();
    expect((await p).status).toBe("awaiting_review");
    expect(seen).toEqual(["Bearer bwp_x", "Bearer bwp_x", "Bearer bwp_x"]);
    vi.useRealTimers();
  });
});
