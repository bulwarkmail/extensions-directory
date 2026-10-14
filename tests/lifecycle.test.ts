// Release lifecycle through v1 and v2: channels, yanking, compatibility,
// suspension, deprecation, advisories and download counting.
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { seed } from "./fixtures/seed";
import { params, req } from "./helpers/http";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { refreshLatest } from "@/lib/release-caches";
import { createAdvisory } from "@/lib/community";
import { deprecate, yankVersion } from "@/lib/lifecycle";
import * as list from "@/app/api/v1/extensions/route";
import * as detail from "@/app/api/v1/extension/[slug]/route";
import * as bundle from "@/app/api/v1/bundle/[slug]/[version]/route";
import * as files from "@/app/api/v1/files/[...path]/route";
import * as checkUpdates from "@/app/api/v1/check-updates/route";
import { router } from "@/lib/api/router";
import { v2Routes } from "@/lib/api/v2";

const v2 = router(v2Routes);
const staff = { kind: "admin" as const, id: "staff" };

beforeAll(async () => {
  await seed();
  await db.insert(schema.authors).values({ id: "staff", githubId: 3001, githubLogin: "staff", displayName: "Staff", role: "admin" });
  refreshLatest(db.$client);
});

const jitsiLatest = async (query = "") => {
  const body = await (await list.GET(req(`/api/v1/extensions?type=plugin${query}`))).json();
  return body.data.find((e: { slug: string }) => e.slug === "jitsi-meet")?.latestVersion;
};
const getBundle = (slug: string, version: string, ip = "198.51.100.1") =>
  bundle.GET(req(`/api/v1/bundle/${slug}/${version}`, { headers: { "x-real-ip": ip } }), params({ slug, version }));
const updates = async (installed: { slug: string; version: string }[], appVersion?: string) =>
  (await (await checkUpdates.POST(req("/api/v1/check-updates", { method: "POST", body: { extensions: installed, appVersion } }))).json()).data;

describe("v1", () => {
  it("offers the highest stable version, not the newest or a beta", async () => {
    expect(await jitsiLatest()).toBe("1.10.0");
  });

  it("offers the highest version the caller's app can run", async () => {
    expect(await jitsiLatest("&appVersion=1.8.0")).toBe("1.9.0");
    expect(await jitsiLatest("&appVersion=1.9.5")).toBe("1.10.0");
  });

  it("keeps betas out of the version list but serves them by exact version", async () => {
    const d = (await (await detail.GET(req("/api/v1/extension/jitsi-meet"), params({ slug: "jitsi-meet" }))).json()).data;
    expect(d.versions.map((v: { version: string }) => v.version)).toEqual(["1.10.0", "1.9.0", "1.0.0"]);
    expect((await getBundle("jitsi-meet", "1.11.0-beta.1")).status).toBe(200);
  });

  it("never offers an update to an older or equal version", async () => {
    expect(await updates([{ slug: "jitsi-meet", version: "1.10.0" }, { slug: "nord", version: "3.0.0" }])).toEqual({ updates: [], upToDate: ["jitsi-meet", "nord"] });
    const { updates: u } = await updates([{ slug: "jitsi-meet", version: "1.0.0" }], "1.8.0");
    expect(u).toEqual([expect.objectContaining({ slug: "jitsi-meet", latestVersion: "1.9.0" })]);
  });

  it("stops offering a yanked version but still serves it to pinned installs", async () => {
    await yankVersion(db.select().from(schema.extensions).where(eq(schema.extensions.slug, "jitsi-meet")).get()!, "1.10.0", "Breaks the composer", staff);
    expect(await jitsiLatest()).toBe("1.9.0");
    const res = await getBundle("jitsi-meet", "1.10.0");
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get("x-bundle-yanked") ?? "")).toBe("Breaks the composer");
  });

  it("serves nothing of a suspended extension", async () => {
    expect((await getBundle("evil", "0.1.0")).status).toBe(404);
    const p = "bundles/evil/0.1.0/evil-0.1.0.zip";
    expect((await files.GET(req(`/api/v1/files/${p}`), params({ path: p.split("/") }))).status).toBe(404);
  });

  it("counts a download once per address, version and day", async () => {
    const count = () => db.select().from(schema.extensionVersions).where(eq(schema.extensionVersions.id, "ver-nord-200")).get()!.downloadCount;
    const before = count();
    await getBundle("nord", "2.0.0", "203.0.113.50");
    await getBundle("nord", "2.0.0", "203.0.113.50");
    await getBundle("nord", "2.0.0", "203.0.113.51");
    expect(count()).toBe(before + 2);
  });
});

describe("POST /api/v2/updates", () => {
  it("reports updates, yanked versions, deprecation, suspension and advisories", async () => {
    const jitsi = db.select().from(schema.extensions).where(eq(schema.extensions.slug, "jitsi-meet")).get()!;
    await createAdvisory(jitsi, { affected: "<1.9.0", fixedIn: "1.9.0", severity: "high", summary: "Leaks the subject line", publish: true }, staff);
    await deprecate(db.select().from(schema.extensions).where(eq(schema.extensions.slug, "nord")).get()!, "", null, staff);
    const res = await v2("POST")(req("/api/v2/updates", { method: "POST", body: { appVersion: "1.9.5", installed: [
      { slug: "jitsi-meet", version: "1.0.0" }, { slug: "jitsi-meet", version: "1.10.0" }, { slug: "nord", version: "2.0.0" }, { slug: "evil", version: "0.1.0" }, { slug: "nope", version: "1.0.0" },
    ] } }));
    const { data } = await res.json();
    expect(data.updates.map((u: { slug: string; currentVersion: string; version: string }) => `${u.slug} ${u.currentVersion}->${u.version}`)).toEqual(["jitsi-meet 1.0.0->1.9.0"]);
    expect(data.yanked).toEqual([expect.objectContaining({ slug: "jitsi-meet", version: "1.10.0", reason: "Breaks the composer" })]);
    expect(data.advisories).toEqual([expect.objectContaining({ extension: "jitsi-meet", installedVersion: "1.0.0", severity: "high", id: expect.stringMatching(/^BWX-\d{4}-0001$/) })]);
    expect(data.deprecated).toEqual([expect.objectContaining({ slug: "nord" })]);
    expect(data.suspended).toEqual(["evil"]);
    expect(data.unknown).toEqual(["nope"]);
  });

  it("offers betas only to callers on the beta channel", async () => {
    const res = await v2("POST")(req("/api/v2/updates", { method: "POST", body: { channel: "beta", appVersion: "2.0.0", installed: [{ slug: "jitsi-meet", version: "1.9.0" }] } }));
    expect((await res.json()).data.updates.map((u: { version: string }) => u.version)).toEqual(["1.11.0-beta.1"]);
  });
});
