import { describe, expect, it } from "vitest";
import { changelogSection, noteFlags, notesFromFiles } from "@/lib/changelog";
import { changelogsBetween } from "@/lib/api/views";
import type { extensionVersions } from "@/lib/db/schema";

const LOG = [
  "# Changelog", "", "## Unreleased", "", "- Not yet", "",
  "## [2.0.0-beta.1] - 2026-10-01", "", "- Beta", "",
  "## v1.4.1 (2026-10-29)", "", "### Fixed", "- Sort the attributes", "", "```", "## 9.9.9", "```", "",
  "## 1.4.10", "", "- Ten", "",
  "## 1.4.0", "", "### Fixed", "",
].join("\r\n");

describe("changelogSection", () => {
  it("finds a version under the heading styles authors use", () => {
    expect(changelogSection(LOG, "1.4.1")).toBe("### Fixed\n- Sort the attributes\n\n```\n## 9.9.9\n```");
    expect(changelogSection(LOG, "2.0.0-beta.1")).toBe("- Beta");
    expect(changelogSection(LOG, "1.4.10")).toBe("- Ten");
  });

  it("has nothing for a missing version, one inside a code block, or a section of only headings", () => {
    expect(changelogSection(LOG, "1.4.2")).toBeNull();
    expect(changelogSection(LOG, "9.9.9")).toBeNull();
    expect(changelogSection(LOG, "1.4.0")).toBeNull();
    expect(changelogSection(LOG, "1.4.1".slice(0, 3))).toBeNull();
  });

  it("caps the notes", () => {
    expect(changelogSection(`## 1.0.0\n\n${"x".repeat(30_000)}`, "1.0.0")).toHaveLength(20_000);
  });
});

describe("notesFromFiles", () => {
  const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k, new TextEncoder().encode(v)]));

  it("reads CHANGELOG.md, then the other usual names", () => {
    expect(notesFromFiles(files({ "CHANGELOG.md": "## 1.0.0\n- A", "CHANGES.md": "## 1.0.0\n- B" }), "1.0.0")).toBe("- A");
    expect(notesFromFiles(files({ "CHANGES.md": "## 1.0.0\n- B" }), "1.0.0")).toBe("- B");
    expect(notesFromFiles(files({ "docs/CHANGELOG.md": "## 1.0.0\n- C" }), "1.0.0")).toBeNull();
  });
});

describe("noteFlags", () => {
  it("marks Security and Breaking headings", () => {
    expect(noteFlags("### Security\n- x\n\n### Breaking changes\n- y")).toEqual({ security: true, breaking: true });
    expect(noteFlags("### Fixed\n- A security fix")).toEqual({ security: false, breaking: false });
    expect(noteFlags(null)).toEqual({ security: false, breaking: false });
  });
});

describe("changelogsBetween", () => {
  type Version = typeof extensionVersions.$inferSelect;
  const v = (version: string, extra: Partial<Version> = {}) =>
    ({ version, channel: version.includes("-") ? "beta" : "stable", yankedAt: null, publishedAt: null, changelog: `notes ${version}`, ...extra }) as Version;
  const all = [v("1.0.0"), v("1.1.0"), v("1.2.0", { yankedAt: new Date() }), v("1.3.0-beta.1"), v("1.3.0"), v("1.4.0")];

  it("lists the versions after the installed one up to the target, newest first, without yanked ones", () => {
    expect(changelogsBetween(all, "1.0.0", v("1.3.0"), "stable").map((c) => c.version)).toEqual(["1.3.0", "1.1.0"]);
  });

  it("shows betas only on the beta channel", () => {
    expect(changelogsBetween(all, "1.1.0", v("1.3.0"), "beta").map((c) => c.version)).toEqual(["1.3.0", "1.3.0-beta.1"]);
  });

  it("flags each entry", () => {
    const [entry] = changelogsBetween([v("2.0.0", { changelog: "### Breaking\n- Gone" })], "1.0.0", v("2.0.0"), "stable");
    expect(entry).toMatchObject({ version: "2.0.0", changelog: "### Breaking\n- Gone", notes: { breaking: true, security: false } });
  });
});
