import { afterEach, describe, expect, it } from "vitest";
import { cleanSubpath, parseRepoUrl, source } from "./index";
import { get, setFetch } from "./http";

afterEach(() => setFetch((...a) => fetch(...a)));

describe("parseRepoUrl", () => {
  it.each([
    ["alice/plugins", { host: "github.com", repo: "alice/plugins" }],
    ["https://github.com/alice/plugins.git", { host: "github.com", repo: "alice/plugins" }],
    ["https://github.com/alice/plugins/tree/v1.2.0/jitsi-meet", { host: "github.com", repo: "alice/plugins", ref: "v1.2.0", subpath: "jitsi-meet" }],
    ["https://gitlab.com/group/sub/proj/-/tree/main/a/b", { host: "gitlab.com", repo: "group/sub/proj", ref: "main", subpath: "a/b" }],
    ["https://gitlab.com/group/proj", { host: "gitlab.com", repo: "group/proj" }],
    ["https://codeberg.org/bob/theme/src/branch/main/x", { host: "codeberg.org", repo: "bob/theme", ref: "main", subpath: "x" }],
  ])("%s", (input, want) => {
    expect(parseRepoUrl(input)).toEqual(want);
  });

  it.each([
    "http://github.com/a/b",
    "https://gitlab.example.org/a/b",
    "https://github.com/a",
    "https://github.com/../b",
    "javascript:alert(1)",
    "a/b/c",
  ])("refuses %s", (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});

describe("cleanSubpath", () => {
  it("normalizes and refuses escapes", () => {
    expect(cleanSubpath("/jitsi-meet/")).toBe("jitsi-meet");
    expect(cleanSubpath("")).toBe("");
    expect(cleanSubpath("a/../b")).toBeNull();
    expect(cleanSubpath("a//b")).toBeNull();
    expect(cleanSubpath("a\\..\\b")).toBeNull();
  });
});

describe("http", () => {
  it("refuses hosts outside the list, also after a redirect", async () => {
    await expect(get("https://internal.example/x", { maxBytes: 10 })).rejects.toThrow(/Refusing/);
    setFetch(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    await expect(get("https://api.github.com/repos/a/b/zipball/x", { maxBytes: 10 })).rejects.toThrow(/Refusing/);
  });

  it("drops credentials when following a redirect", async () => {
    const seen: (string | null)[] = [];
    setFetch(async (input, init) => {
      seen.push(new Headers(init?.headers).get("authorization"));
      const url = new URL(String(input));
      if (url.hostname === "api.github.com") return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/a/b/zip/x" } });
      return new Response("zip");
    });
    expect((await get("https://api.github.com/repos/a/b/zipball/x", { maxBytes: 10, headers: { Authorization: "Bearer secret" } }))?.toString()).toBe("zip");
    expect(seen).toEqual(["Bearer secret", null]);
  });

  it("stops reading past the size cap", async () => {
    setFetch(async () => new Response("x".repeat(100)));
    await expect(get("https://codeberg.org/x", { maxBytes: 50 })).rejects.toThrow(/larger than 50/);
  });

  it("returns null for 404", async () => {
    setFetch(async () => new Response("no", { status: 404 }));
    expect(await get("https://codeberg.org/x", { maxBytes: 50 })).toBeNull();
  });
});

describe("sources", () => {
  it("reads GitHub repository ids and visibility", async () => {
    setFetch(async () => Response.json({ id: 42, full_name: "Alice/Plugins", private: false, default_branch: "main", owner: { id: 7 } }));
    expect(await source("github.com").repoInfo("alice/plugins")).toEqual({ fullName: "Alice/Plugins", id: "42", ownerId: "7", isPublic: true, defaultBranch: "main" });
  });

  it("treats GitLab internal projects as not public", async () => {
    setFetch(async () => Response.json({ id: 1, path_with_namespace: "g/p", visibility: "internal", default_branch: "main", namespace: { id: 2 } }));
    expect((await source("gitlab.com").repoInfo("g/p"))?.isPublic).toBe(false);
  });

  it("refuses a Codeberg commit that doesn't match the SHA asked for", async () => {
    setFetch(async () => Response.json([{ sha: "b".repeat(40) }]));
    expect(await source("codeberg.org").resolveRef("a/b", "a".repeat(40))).toBeNull();
  });
});
