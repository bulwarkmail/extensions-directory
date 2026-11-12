// The repository of a trusted publisher is looked up at
// https://api.github.com/repos/<owner>/<name> with the directory's GitHub
// credential. Only owner/name, or its github.com URL, is accepted, and the
// source hosts take nothing but a repository name, a commit SHA and a path
// inside the repository into their URLs.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { req, BASE } from "../helpers/http";
import { signIn, signOut } from "../helpers/session";

const { db } = await import("@/lib/db/client");
const schema = await import("@/lib/db/schema");
const { router } = await import("@/lib/api/router");
const { v2Routes } = await import("@/lib/api/v2");
const { setFetch } = await import("@/lib/sources/http");
const { source } = await import("@/lib/sources");
const { reserveExtension } = await import("@/lib/publishing/submit");

const dispatch = router(v2Routes);
const asked: string[] = [];

beforeAll(async () => {
  await db.insert(schema.authors).values({ id: "mallory", githubId: 9001, githubLogin: "mallory", displayName: "Mallory" });
  reserveExtension("mallory", { slug: "mallory-ext", name: "m", description: "d", type: "plugin", pluginType: "hook", host: "github.com", repo: "mallory/stuff", subpath: "" });
  // GitHub as far as this test needs it: one repository (names are case-insensitive, as on GitHub), and a record of every URL asked for.
  setFetch((async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    asked.push(url.pathname + url.search);
    if (url.pathname.toLowerCase() === "/repos/mallory/stuff") return Response.json({ id: 1, full_name: "mallory/stuff", private: false, default_branch: "main", owner: { id: 9001 } });
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch);
});

beforeEach(() => {
  signOut();
  asked.length = 0;
  db.delete(schema.rateLimits).run();
});

const addRow = async (repository: string) => {
  await signIn("mallory");
  const res = await dispatch("POST")(req("/api/v2/extensions/mallory-ext/publishers", { method: "POST", body: { repository, workflowPath: ".github/workflows/publish.yml" }, headers: { origin: new URL(BASE).origin } }));
  return { status: res.status, body: await res.json() };
};
const add = async (repository: string) => (await addRow(repository)).status;

describe("the repository of a trusted publisher", () => {
  it.each([
    "mallory/stuff/../../../user",
    "mallory/stuff/../../../orgs/bulwarkmail/members",
    "mallory/stuff?per_page=1#",
    "mallory/stuff/collaborators",
    "..",
  ])("%s is refused before anything is fetched", async (repository) => {
    expect(await add(repository)).toBe(400);
    expect(asked).toEqual([]);
  });

  it("owner/name still works (control)", async () => {
    expect(await add("mallory/stuff")).toBe(201);
    expect(asked).toEqual(["/repos/mallory/stuff"]);
  });

  it.each([
    "mallory%2Fstuff",
    "mallory/stuff%2F..%2F..%2Fuser",
    "mallory/%2e%2e",
    "https://github.com/mallory/stuff%2F..%2F..%2Fuser",
    "https://github.com/mallory/stuff/%2e%2e/%2e%2e/user",
    "https://gitlab.com/mallory/stuff",
  ])("%s, with percent-encoded dots or slashes or on another host, is refused before anything is fetched", async (repository) => {
    expect(await add(repository)).toBe(400);
    expect(asked).toEqual([]);
  });

  it.each([
    "mallory/stuff.git",
    "Mallory/Stuff",
    "https://github.com/Mallory/Stuff/",
  ])("%s is accepted and stored as GitHub spells the name", async (repository) => {
    const r = await addRow(repository);
    expect(r.status).toBe(201);
    expect(r.body.data.repository).toBe("mallory/stuff");
    expect(asked.map((p) => p.toLowerCase())).toEqual(["/repos/mallory/stuff"]);
  });
});

describe("the source hosts", () => {
  const SHA = "a".repeat(40);

  it.each(["github.com", "gitlab.com", "codeberg.org"])("%s puts only a repository name, a commit SHA and a path inside the repository into a URL", async (host) => {
    const s = source(host);
    for (const repo of ["mallory/stuff/../../../user", "mallory/stuff?per_page=1#", "mallory%2Fstuff", ".."]) {
      await expect(s.repoInfo(repo)).rejects.toThrow(/Not a repository name/);
      await expect(s.resolveRef(repo, "main")).rejects.toThrow(/Not a repository name/);
      await expect(s.archive(repo, SHA)).rejects.toThrow(/Not a repository name/);
      await expect(s.file(repo, SHA, "manifest.json", 1024)).rejects.toThrow(/Not a repository name/);
      await expect(s.releaseNotes(repo, "v1.0.0")).rejects.toThrow(/Not a repository name/);
    }
    await expect(s.archive("mallory/stuff", "main/../../x")).rejects.toThrow(/Not a commit SHA/);
    await expect(s.file("mallory/stuff", "main", "manifest.json", 1024)).rejects.toThrow(/Not a commit SHA/);
    await expect(s.file("mallory/stuff", SHA, "../other/manifest.json", 1024)).rejects.toThrow(/Not a path inside the repository/);
    expect(asked).toEqual([]);
    // A repository name still goes out.
    await s.repoInfo("mallory/stuff");
    expect(asked).toHaveLength(1);
  });
});
