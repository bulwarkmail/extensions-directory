// A version's notes from a CHANGELOG.md in the submitted folder.
//
// A version section is a level-2 heading that starts with the version, with
// or without brackets or a "v", maybe followed by a date:
//   ## 1.4.1   ## 1.4.1 (2026-10-29)   ## [1.4.1] - 2026-10-29   ## v1.4.1
// Its notes run to the next level-2 heading. This is the format
// bulwarkmail/plugins writes with scripts/changelog-lib.mjs, and the one
// Keep a Changelog uses.

export const CHANGELOG_FILES = ["CHANGELOG.md", "changelog.md", "CHANGES.md"];
export const MAX_NOTES = 20_000;

const SECTION = /^##(?!#)\s*(.*?)\s*$/;

function headingVersion(title: string): string | null {
  const m = title.match(/^\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]?(?=$|[\s(:-])/);
  return m ? m[1] : null;
}

/** The notes for one version, trimmed; null when the file has no section for it or it says nothing. */
export function changelogSection(text: string, version: string): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = lines[i].match(SECTION);
    if (!m) continue;
    if (start !== -1) { end = i; break; }
    if (headingVersion(m[1]) === version) start = i;
  }
  if (start === -1) return null;
  const body = lines.slice(start + 1, end).join("\n").trim();
  // Only headings ("### Fixed" and nothing under it) is no notes.
  return body.split("\n").some((l) => l.trim() && !/^#{1,6}\s/.test(l)) ? body.slice(0, MAX_NOTES) : null;
}

/** The notes for `version` from the first changelog file among the folder's files. */
export function notesFromFiles(files: Map<string, Uint8Array>, version: string): string | null {
  for (const name of CHANGELOG_FILES) {
    const data = files.get(name);
    if (data) return changelogSection(new TextDecoder().decode(data), version);
  }
  return null;
}

/** What admins should notice before updating: a Security or Breaking heading in the notes. */
export function noteFlags(notes: string | null | undefined): { security: boolean; breaking: boolean } {
  const headings = (notes ?? "").split(/\r?\n/).filter((l) => /^#{2,4}\s/.test(l)).map((l) => l.replace(/^#+\s*/, "").toLowerCase());
  return {
    security: headings.some((h) => h.startsWith("security")),
    breaking: headings.some((h) => h.startsWith("breaking")),
  };
}
