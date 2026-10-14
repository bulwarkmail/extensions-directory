// What deployed webmails get from /api/v1. The snapshots were recorded
// against the code before the rework (commit 6a99258); any change to them
// is a change to the v1 contract and has to be one the design doc allows
// (docs/rework-plan.md, section 6.1).
import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "../fixtures/seed";
import { params, req, snapshotOf } from "../helpers/http";

import * as list from "@/app/api/v1/extensions/route";
import * as detail from "@/app/api/v1/extension/[slug]/route";
import * as versions from "@/app/api/v1/extension/[slug]/versions/route";
import * as readme from "@/app/api/v1/extension/[slug]/readme/route";
import * as shots from "@/app/api/v1/extension/[slug]/screenshots/route";
import * as icon from "@/app/api/v1/extension/[slug]/icon/route";
import * as featured from "@/app/api/v1/extensions/featured/route";
import * as popular from "@/app/api/v1/extensions/popular/route";
import * as recent from "@/app/api/v1/extensions/recent/route";
import * as stats from "@/app/api/v1/stats/route";
import * as bundle from "@/app/api/v1/bundle/[slug]/[version]/route";
import * as files from "@/app/api/v1/files/[...path]/route";
import * as checkUpdates from "@/app/api/v1/check-updates/route";

beforeAll(seed);

describe("GET /api/v1/extensions", () => {
  it.each([
    "/api/v1/extensions",
    "/api/v1/extensions?type=plugin",
    "/api/v1/extensions?type=theme",
    "/api/v1/extensions?q=arctic",
    "/api/v1/extensions?tag=communication",
    "/api/v1/extensions?sort=downloads&order=asc",
    "/api/v1/extensions?page=2&perPage=1",
  ])("%s", async (url) => {
    expect(await snapshotOf(await list.GET(req(url)))).toMatchSnapshot();
  });
});

describe("GET /api/v1/extension/{slug}", () => {
  it.each(["jitsi-meet", "nord", "draft-thing", "evil", "missing"])("%s", async (slug) => {
    expect(await snapshotOf(await detail.GET(req(`/api/v1/extension/${slug}`), params({ slug })))).toMatchSnapshot();
  });

  it.each([
    ["versions", versions.GET],
    ["readme", readme.GET],
    ["screenshots", shots.GET],
    ["icon", icon.GET],
  ] as const)("%s", async (name, GET) => {
    for (const slug of ["jitsi-meet", "nord", "evil"]) {
      expect(await snapshotOf(await GET(req(`/api/v1/extension/${slug}/${name}`), params({ slug })))).toMatchSnapshot(slug);
    }
  });
});

describe("private data", () => {
  it("never appears in public responses", async () => {
    const bodies = await Promise.all([
      list.GET(req("/api/v1/extensions")),
      detail.GET(req("/api/v1/extension/jitsi-meet"), params({ slug: "jitsi-meet" })),
      detail.GET(req("/api/v1/extension/nord"), params({ slug: "nord" })),
      featured.GET(),
      popular.GET(),
      recent.GET(),
    ].map(async (r) => (await r).text()));
    for (const body of bodies) {
      expect(body).not.toContain("@example.com");
      expect(body).not.toContain("looks fine");
      expect(body).not.toContain("admin-1");
      expect(body).not.toContain("findings");
    }
  });
});

describe("lists and stats", () => {
  it.each([
    ["featured", featured.GET],
    ["popular", popular.GET],
    ["recent", recent.GET],
    ["stats", stats.GET],
  ] as const)("%s", async (_name, GET) => {
    expect(await snapshotOf(await GET())).toMatchSnapshot();
  });
});

describe("GET /api/v1/bundle/{slug}/{version}", () => {
  it.each([
    ["jitsi-meet", "1.0.0"],
    ["jitsi-meet", "1.11.0-beta.1"],
    ["jitsi-meet", "1.12.0"],
    ["jitsi-meet", "9.9.9"],
    ["nord", "2.0.0"],
    ["evil", "0.1.0"],
  ])("%s %s", async (slug, version) => {
    expect(await snapshotOf(await bundle.GET(req(`/api/v1/bundle/${slug}/${version}`), params({ slug, version })))).toMatchSnapshot();
  });
});

describe("GET /api/v1/files/{path}", () => {
  it.each([
    "icons/jitsi-meet/icon.png",
    "screenshots/jitsi-meet/1.png",
    "theme-previews/nord/light.png",
    "bundles/jitsi-meet/1.0.0/jitsi-meet-1.0.0.zip",
    "banners/jitsi-meet/banner.svg",
    "icons/nord/icon.svg",
    "icons/missing/icon.png",
    "icons/jitsi-meet/notes.txt",
  ])("%s", async (p) => {
    expect(await snapshotOf(await files.GET(req(`/api/v1/files/${p}`), params({ path: p.split("/") })))).toMatchSnapshot();
  });
});

describe("POST /api/v1/check-updates", () => {
  it.each([
    { extensions: [{ slug: "jitsi-meet", version: "1.0.0" }, { slug: "nord", version: "2.0.0" }] },
    { extensions: [{ slug: "evil", version: "0.0.1" }, { slug: "missing", version: "1.0.0" }] },
    { extensions: [] },
    { extensions: [{ slug: "nord" }] },
    { nothing: true },
  ])("%j", async (body) => {
    expect(await snapshotOf(await checkUpdates.POST(req("/api/v1/check-updates", { method: "POST", body })))).toMatchSnapshot();
  });
});
