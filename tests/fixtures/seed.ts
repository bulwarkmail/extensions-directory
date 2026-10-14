// A small, fixed directory: the same rows and files every run, so v1
// responses can be snapshotted. Ids, times and bytes are all constant.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import { db } from "@/lib/db/client";
import {
  authors,
  directoryAdmins,
  downloadStats,
  extensionMembers,
  extensions,
  extensionVersions,
  screenshots,
  submissions,
  themePreviews,
} from "@/lib/db/schema";

export const T = (iso: string) => new Date(iso);

// A valid 1×1 PNG, and an SVG that would run a script if served as SVG.
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
export const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><rect width="64" height="64" fill="#336"/></svg>'
);

function uploads(): string {
  return process.env.UPLOADS_DIR!;
}

export function writeUpload(rel: string, data: Buffer): void {
  const full = path.join(uploads(), rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}

async function bundle(manifest: Record<string, unknown>, files: Record<string, string>) {
  const zip = new JSZip();
  // Fixed dates keep the zip bytes, and so the hash, identical between runs.
  const date = new Date("2026-01-01T00:00:00Z");
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { date });
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { date });
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buf, sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

async function addVersion(opts: {
  id: string;
  extensionId: string;
  slug: string;
  version: string;
  manifest: Record<string, unknown>;
  files: Record<string, string>;
  createdAt: string;
  reviewStatus?: "approved" | "pending" | "rejected";
  changelog?: string | null;
}) {
  const b = await bundle(opts.manifest, opts.files);
  const rel = `bundles/${opts.slug}/${opts.version}/${opts.slug}-${opts.version}.zip`;
  writeUpload(rel, b.buf);
  await db.insert(extensionVersions).values({
    id: opts.id,
    extensionId: opts.extensionId,
    version: opts.version,
    changelog: opts.changelog ?? null,
    bundlePath: rel,
    bundleSha256: b.sha256,
    bundleSize: b.size,
    permissions: (opts.manifest.permissions as string[]) ?? [],
    minAppVersion: (opts.manifest.minAppVersion as string) ?? null,
    manifest: opts.manifest,
    scanStatus: "clean",
    scanReport: { findings: [], fileCount: 2, blocked: false },
    reviewStatus: opts.reviewStatus ?? "approved",
    reviewerId: "admin-1",
    reviewNotes: "looks fine",
    publishedAt: T(opts.createdAt),
    createdAt: T(opts.createdAt),
  });
  return b;
}

export async function seed() {
  await db.insert(authors).values([
    {
      id: "author-alice",
      githubId: 1001,
      githubLogin: "alice",
      displayName: "Alice Example",
      avatarUrl: "https://avatars.example/alice.png",
      email: "alice@example.com",
      bio: "Writes plugins",
      website: "https://alice.example",
      verified: true,
      banned: false,
      createdAt: T("2026-01-02T10:00:00Z"),
      updatedAt: T("2026-01-02T10:00:00Z"),
    },
    {
      id: "author-bob",
      githubId: 1002,
      githubLogin: "bob",
      displayName: "Bob Example",
      avatarUrl: null,
      email: "bob@example.com",
      bio: null,
      website: null,
      verified: false,
      banned: false,
      createdAt: T("2026-01-03T10:00:00Z"),
      updatedAt: T("2026-01-03T10:00:00Z"),
    },
  ]);
  await db.insert(directoryAdmins).values({
    id: "admin-1",
    githubId: 2001,
    githubLogin: "reviewer",
    displayName: "Reviewer",
    role: "super_admin",
    createdAt: T("2026-01-01T00:00:00Z"),
  });

  // An approved plugin with two stable versions and a newer beta.
  await db.insert(extensions).values({
    id: "ext-jitsi",
    slug: "jitsi-meet",
    name: "Jitsi Meet",
    type: "plugin",
    pluginType: "ui-extension",
    authorId: "author-alice",
    description: "Start a Jitsi call from a message",
    longDescription: "<p>Calls <b>from mail</b>.</p>",
    githubRepo: "alice/plugins",
    subpath: "jitsi-meet",
    license: "MIT",
    iconPath: "icons/jitsi-meet/icon.png",
    bannerPath: "banners/jitsi-meet/banner.svg",
    status: "approved",
    featured: true,
    permissions: ["email:read", "ui:toolbar"],
    tags: ["productivity", "communication"],
    minAppVersion: "1.7.0",
    totalDownloads: 42,
    createdAt: T("2026-02-01T10:00:00Z"),
    updatedAt: T("2026-03-01T10:00:00Z"),
  });
  writeUpload("icons/jitsi-meet/icon.png", PNG_1PX);
  writeUpload("banners/jitsi-meet/banner.svg", SVG_WITH_SCRIPT);
  writeUpload("screenshots/jitsi-meet/1.png", PNG_1PX);
  writeUpload("screenshots/jitsi-meet/2.svg", SVG_WITH_SCRIPT);
  await db.insert(screenshots).values([
    { id: "shot-1", extensionId: "ext-jitsi", path: "screenshots/jitsi-meet/1.png", altText: "Toolbar", sortOrder: 0, createdAt: T("2026-02-01T10:00:00Z") },
    { id: "shot-2", extensionId: "ext-jitsi", path: "screenshots/jitsi-meet/2.svg", altText: null, sortOrder: 1, createdAt: T("2026-02-01T10:00:00Z") },
  ]);
  const jitsi = (version: string, minAppVersion = "1.7.0") => ({
    id: "jitsi-meet",
    name: "Jitsi Meet",
    version,
    author: "Alice",
    description: "Start a Jitsi call from a message",
    type: "ui-extension",
    permissions: ["email:read", "ui:toolbar"],
    entrypoint: "index.js",
    minAppVersion,
  });
  await addVersion({ id: "ver-jitsi-100", extensionId: "ext-jitsi", slug: "jitsi-meet", version: "1.0.0", manifest: jitsi("1.0.0"), files: { "index.js": "export default {}\n" }, createdAt: "2026-02-01T10:00:00Z", changelog: "First release" });
  // 1.10.0 was approved before 1.9.0 (a backport), so "newest" and "highest" differ.
  await addVersion({ id: "ver-jitsi-1100", extensionId: "ext-jitsi", slug: "jitsi-meet", version: "1.10.0", manifest: jitsi("1.10.0", "1.9.0"), files: { "index.js": "export default { v: 110 }\n" }, createdAt: "2026-02-15T10:00:00Z", changelog: "Faster" });
  await addVersion({ id: "ver-jitsi-190", extensionId: "ext-jitsi", slug: "jitsi-meet", version: "1.9.0", manifest: jitsi("1.9.0"), files: { "index.js": "export default { v: 19 }\n" }, createdAt: "2026-02-20T10:00:00Z", changelog: "Backport" });
  await addVersion({ id: "ver-jitsi-beta", extensionId: "ext-jitsi", slug: "jitsi-meet", version: "1.11.0-beta.1", manifest: jitsi("1.11.0-beta.1", "2.0.0"), files: { "index.js": "export default { beta: true }\n" }, createdAt: "2026-03-01T10:00:00Z", changelog: "Beta" });
  await addVersion({ id: "ver-jitsi-rej", extensionId: "ext-jitsi", slug: "jitsi-meet", version: "1.12.0", manifest: jitsi("1.12.0"), files: { "index.js": "eval('x')\n" }, createdAt: "2026-03-02T10:00:00Z", reviewStatus: "rejected" });

  // An approved theme with previews.
  await db.insert(extensions).values({
    id: "ext-nord",
    slug: "nord",
    name: "Nord",
    type: "theme",
    pluginType: null,
    authorId: "author-bob",
    description: "Arctic colours",
    longDescription: null,
    githubRepo: "bob/nord",
    subpath: "",
    license: "MIT",
    iconPath: "icons/nord/icon.svg",
    bannerPath: null,
    status: "approved",
    featured: false,
    permissions: [],
    tags: ["appearance"],
    minAppVersion: null,
    totalDownloads: 7,
    createdAt: T("2026-02-10T10:00:00Z"),
    updatedAt: T("2026-02-10T10:00:00Z"),
  });
  writeUpload("icons/nord/icon.svg", SVG_WITH_SCRIPT);
  writeUpload("theme-previews/nord/light.png", PNG_1PX);
  await db.insert(themePreviews).values([
    { id: "prev-light", extensionId: "ext-nord", variant: "light", previewPath: "theme-previews/nord/light.png", colors: { primary: "#88c0d0" } },
  ]);
  await addVersion({ id: "ver-nord-200", extensionId: "ext-nord", slug: "nord", version: "2.0.0", manifest: { id: "nord", name: "Nord", version: "2.0.0", author: "Bob", description: "Arctic colours", type: "theme" }, files: { "theme.css": ":root { --x: 1 }\n" }, createdAt: "2026-02-10T10:00:00Z" });

  // Not public: a pending extension and a suspended one.
  await db.insert(extensions).values([
    { id: "ext-draft", slug: "draft-thing", name: "Draft", type: "plugin", pluginType: "hook", authorId: "author-bob", description: "Not yet", githubRepo: "bob/draft", status: "pending", createdAt: T("2026-03-05T10:00:00Z"), updatedAt: T("2026-03-05T10:00:00Z") },
    { id: "ext-evil", slug: "evil", name: "Evil", type: "plugin", pluginType: "hook", authorId: "author-bob", description: "Pulled", githubRepo: "bob/evil", status: "suspended", createdAt: T("2026-01-05T10:00:00Z"), updatedAt: T("2026-01-05T10:00:00Z") },
  ]);
  await addVersion({ id: "ver-evil-010", extensionId: "ext-evil", slug: "evil", version: "0.1.0", manifest: { id: "evil", name: "Evil", version: "0.1.0", author: "Bob", description: "Pulled", type: "hook", entrypoint: "index.js" }, files: { "index.js": "steal()\n" }, createdAt: "2026-01-05T10:00:00Z" });

  await db.insert(extensionMembers).values([
    { extensionId: "ext-jitsi", authorId: "author-alice", role: "owner" },
    { extensionId: "ext-nord", authorId: "author-bob", role: "owner" },
    { extensionId: "ext-draft", authorId: "author-bob", role: "owner" },
    { extensionId: "ext-evil", authorId: "author-bob", role: "owner" },
  ]);
  await db.insert(downloadStats).values([
    { id: "dl-1", extensionId: "ext-jitsi", versionId: "ver-jitsi-100", downloadedAt: T("2026-02-02T10:00:00Z"), userAgent: "node", ipHash: "aaaa" },
    { id: "dl-2", extensionId: "ext-jitsi", versionId: "ver-jitsi-1100", downloadedAt: T("2026-02-16T10:00:00Z"), userAgent: "node", ipHash: "bbbb" },
  ]);
  await db.insert(submissions).values({
    id: "sub-open",
    extensionId: "ext-jitsi",
    authorId: "author-alice",
    type: "new_version",
    githubRepo: "alice/plugins",
    githubTag: "main",
    subpath: "jitsi-meet",
    manifestSnapshot: jitsi("1.13.0"),
    status: "pending",
    submittedAt: T("2026-03-10T10:00:00Z"),
  });
}
