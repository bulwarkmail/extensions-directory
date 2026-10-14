import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { advisoriesFor, extensionBySlug, releasesOf } from "@/lib/catalog";
import { versionFull } from "@/lib/api/views";
import { renderMarkdown } from "@/lib/markdown";
import { formatBytes, formatDate } from "@/lib/utils";
import { PermissionList } from "@/components/permission-badge";
import { Status } from "@/components/status";
import { ICON } from "@/components/icon";

interface Props {
  params: Promise<{ slug: string; version: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, version } = await params;
  return { title: `${slug} ${decodeURIComponent(version)}` };
}

export const dynamic = "force-dynamic";

export default async function VersionPage({ params }: Props) {
  const { slug, version: raw } = await params;
  const version = decodeURIComponent(raw);
  const row = extensionBySlug(slug);
  if (!row || (row.e.status !== "approved" && row.e.status !== "archived")) notFound();
  const v = (releasesOf([row.e.id]).get(row.e.id) ?? []).find((x) => x.version === version);
  if (!v) notFound();
  const full = versionFull(v, slug);
  const p = full.provenance;
  const workflow = p.ci?.workflowRef ? p.ci.workflowRef.split("@")[0].split("/").slice(2).join("/") : null;
  const advisories = advisoriesFor(row.e.id, v.version);

  return (
    <div className="bw-w dx-work">
      <p className="bw-crumb"><Link className="bw-link" href={`/extension/${slug}`}>{row.e.name}</Link></p>
      <h1 className="bw-h2">{row.e.name} {v.version}</h1>
      <div className="dx-rows-meta">
        {v.channel === "beta" ? <Status value="beta" /> : null}
        {v.yankedAt ? <Status value="yanked" /> : null}
        {v.publishedAt ? <span>Published {formatDate(v.publishedAt)}</span> : null}
        <span>{formatBytes(v.bundleSize)}</span>
        <span>Needs Bulwark {v.minAppVersion ?? "any version"}{v.maxAppVersion ? `, up to ${v.maxAppVersion}` : ""}</span>
      </div>
      {v.yankedAt ? <p className="bw-note bw-note-warning">This version was yanked{v.yankReason ? `: ${v.yankReason}` : "."} It is no longer offered for new installs.</p> : null}
      {advisories.map((a) => <p key={a.id} className="bw-note bw-note-warning"><strong>{a.id} ({a.severity})</strong>: {a.summary}{a.fixedIn ? ` Fixed in ${a.fixedIn}.` : ""}</p>)}
      <div className="bw-btns">
        <a className="bw-btn" href={`/api/v1/bundle/${slug}/${encodeURIComponent(v.version)}`}>Download <Download size={16} {...ICON} /></a>
      </div>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Where it came from</h2>
        <p>
          {p.source.commit && p.source.repo ? (
            <>Built by the directory from commit {p.source.commitUrl ? <a className="bw-link" href={p.source.commitUrl} target="_blank" rel="noopener noreferrer"><code className="bw-icode">{p.source.commit.slice(0, 12)}</code></a> : <code className="bw-icode">{p.source.commit.slice(0, 12)}</code>}{" "}
              of {p.source.host}/{p.source.repo}{p.source.subpath ? ` (folder ${p.source.subpath})` : ""}{p.source.ref ? `, ${p.source.ref.replace(/^refs\/(tags|heads)\//, "")}` : ""}
              {workflow ? <>, submitted by workflow <code className="bw-icode">{workflow}</code>{p.ci?.runUrl ? <> (<a className="bw-link" href={p.ci.runUrl} target="_blank" rel="noopener noreferrer">run {p.ci.runId}</a>)</> : null}</> : v.submittedVia === "token" ? ", submitted with an API token" : v.submittedVia === "web" ? ", submitted on the website" : null}.</>
          ) : (
            <>Published before the directory recorded commits; it was built from {p.source.repo ?? "an unknown repository"}{p.source.ref ? ` at ${p.source.ref}` : ""}.</>
          )}
        </p>
        <dl className="bw-deflist">
          <div><dt>SHA-256</dt><dd><code className="bw-icode" style={{ overflowWrap: "anywhere" }}>{v.bundleSha256}</code></dd></div>
          <div><dt>Build</dt><dd>{p.build.builtWith === "sandbox-build" ? `npm run build in the directory's sandbox${p.build.image ? ` (${p.build.image})` : ""}` : p.build.builtWith === "flat" ? "the plain files, no build step" : "recorded before builds were tracked"}</dd></div>
          <div><dt>Signature</dt><dd>{full.signature ? <>Signed by the directory, key <code className="bw-icode">{full.signature.keyId}</code>. <Link className="bw-link" href={`/api/v2/extensions/${slug}/versions/${encodeURIComponent(v.version)}/provenance`}>Provenance document</Link></> : "Not signed yet"}</dd></div>
        </dl>
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Changelog</h2>
        {v.changelog ? <div className="ext-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(v.changelog) }} /> : <p className="bw-help">No notes for this version.</p>}
      </section>

      <section className="dx-sec-block">
        <h2 className="dx-h2">Permissions</h2>
        <PermissionList permissions={v.permissions ?? []} isTheme={row.e.type === "theme"} />
      </section>
    </div>
  );
}
