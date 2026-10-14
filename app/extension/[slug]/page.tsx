import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, Download } from "lucide-react";
import { getExtensionBySlug } from "@/lib/db/queries";
import { PermissionList } from "@/components/permission-badge";
import { ExtIcon, formatTypeLabel } from "@/components/ext-icon";
import { ICON } from "@/components/icon";
import { formatDownloads, formatDate, formatBytes, timeAgo } from "@/lib/utils";
import { renderMarkdown } from "@/lib/markdown";
import { advisoriesFor, ratingSummary } from "@/lib/catalog";
import { ratingsOf } from "@/lib/community";
import { currentUser } from "@/lib/auth/session";
import { source } from "@/lib/sources";
import { RateForm, ReportForm } from "./forms";
import type { Metadata } from "next";

const firstLine = (s: string) => {
  const line = s.split(/\r?\n/).map((l) => l.replace(/^[#*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
};

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  let ext;
  try {
    ext = await getExtensionBySlug(slug);
  } catch {
    return { title: "Extension — BulwarkMail Extensions" };
  }

  if (!ext) return { title: "Extension Not Found" };

  const ogTitle = `${ext.name} — Bulwark Extensions`;
  const description = ext.description;

  return {
    title: ext.name,
    description,
    openGraph: { title: ogTitle, description, type: "website" },
    twitter: { card: "summary_large_image", title: ogTitle, description },
  };
}

// githubRepo arrives as "owner/repo" from submissions and as a full URL from
// the seed script; show and link both correctly without touching the data.
function repoParts(host: string, repo: string, subpath: string | null) {
  const sub = (subpath ?? "").replace(/^\/+|\/+$/g, "");
  let href: string;
  try {
    href = source(host).repoUrl(repo);
  } catch {
    href = `https://${host}/${repo}`;
  }
  return { label: `${host === "github.com" ? "" : `${host}/`}${repo}${sub ? `/${sub}` : ""}`, href };
}

export default async function ExtensionDetailPage({ params }: Props) {
  const { slug } = await params;

  let extension;
  try {
    extension = await getExtensionBySlug(slug);
  } catch {
    notFound();
  }

  if (!extension || extension.status !== "approved") {
    notFound();
  }

  const latestVersion = extension.latestVersion;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const typeLabel = formatTypeLabel(extension.type, extension.pluginType);
  const isPlugin = extension.type === "plugin";
  const repo = extension.githubRepo ? repoParts(extension.sourceHost, extension.githubRepo, extension.subpath) : null;
  const advisories = advisoriesFor(extension.id).map((a) => ({ ...a, affectsLatest: latestVersion ? advisoriesFor(extension.id, latestVersion.version).some((x) => x.id === a.id) : false }));
  const rating = ratingSummary([extension.id]).get(extension.id);
  const reviews = ratingsOf(extension.id, 20);
  const user = await currentUser();
  const pictures = [
    ...extension.screenshots.map((s) => ({ key: s.id, path: s.path, caption: s.altText || null, alt: s.altText || `${extension.name} screenshot` })),
    ...extension.themePreviews.map((p) => ({
      key: p.id,
      path: p.previewPath,
      caption: p.variant === "dark" ? "Dark" : "Light",
      alt: `${extension.name} in ${p.variant}`,
    })),
  ];

  return (
    <article>
      <header className="bw-field dx-dhero">
        <div className={`bw-w dx-dhero-in${extension.bannerPath ? " has-banner" : ""}`}>
          <div className="dx-dhero-text">
            <nav className="bw-crumb" aria-label="Breadcrumb">
              <Link href={isPlugin ? "/plugins" : "/themes"}>{isPlugin ? "Plugins" : "Themes"}</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{extension.name}</span>
            </nav>
            <div className="dx-dhero-title">
              <ExtIcon name={extension.name} iconPath={extension.iconPath} size="lg" />
              <h1 className="bw-h1">{extension.name}</h1>
            </div>
            {extension.author ? (
              <p className="dx-byline">
                by <Link href={`/author/${extension.author.githubLogin}`}>{extension.author.displayName}</Link>
                {extension.author.verified ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                    <BadgeCheck size={16} {...ICON} />
                    verified author
                  </span>
                ) : null}
              </p>
            ) : null}
            <p className="bw-lead">{extension.description}</p>
            <div className="bw-btns">
              {latestVersion ? (
                <a href={`${siteUrl}/api/v1/bundle/${extension.slug}/${latestVersion.version}`} className="bw-btn">
                  Download version {latestVersion.version}
                  <Download size={16} {...ICON} />
                </a>
              ) : null}
              {repo ? (
                <a href={repo.href} target="_blank" rel="noopener noreferrer" className="bw-btn bw-btn-ghost">
                  View source
                  <ArrowUpRight size={16} {...ICON} />
                </a>
              ) : null}
            </div>
          </div>
          {extension.bannerPath ? (
            <span className="dx-banner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/v1/files/${extension.bannerPath}`} alt="" />
            </span>
          ) : null}
        </div>
      </header>

      <div className="bw-w dx-sec">
        {extension.deprecatedAt ? (
          <p className="bw-note bw-note-warning">
            This extension is deprecated{extension.deprecationMessage ? `: ${extension.deprecationMessage}` : "."}
            {extension.replacementSlug ? <> Use <Link className="bw-link" href={`/extension/${extension.replacementSlug}`}>{extension.replacementSlug}</Link> instead.</> : null}
          </p>
        ) : null}
        {advisories.map((a) => (
          <div key={a.id} className="bw-note bw-note-warning">
            <strong>Security advisory {a.id} ({a.severity})</strong>: {a.summary} Affects {a.affected}{a.fixedIn ? `, fixed in ${a.fixedIn}` : ""}.
            {a.details ? <div className="ext-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.details) }} /> : null}
          </div>
        ))}
        <div className="dx-split">
          <div className="dx-stack">
            {extension.longDescription ? (
              <section>
                <h2 className="dx-h2">About</h2>
                <div className="ext-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(extension.longDescription) }} />
              </section>
            ) : null}

            {pictures.length > 0 ? (
              <section>
                <h2 className="dx-h2">Screenshots</h2>
                <div className="dx-shots">
                  {pictures.map((p) => (
                    <figure key={p.key}>
                      <span className="dx-shot">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/v1/files/${p.path}`} alt={p.alt} loading="lazy" />
                      </span>
                      {p.caption ? <figcaption>{p.caption}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              </section>
            ) : null}

            {extension.versions.length > 0 ? (
              <section>
                <h2 className="dx-h2">Versions</h2>
                <div className="bw-table-wrap">
                  <table className="bw-table">
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Released</th>
                        <th scope="col">Changes</th>
                        <th scope="col">Built from</th>
                        <th scope="col" className="num">
                          Size
                        </th>
                        <th scope="col">
                          <span className="sr-only">Download</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {extension.versions.map((v) => (
                        <tr key={v.id}>
                          <td><Link className="bw-link" href={`/extension/${extension.slug}/versions/${encodeURIComponent(v.version)}`}>{v.version}</Link></td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatDate(v.publishedAt)}</td>
                          <td>{v.changelog ? firstLine(v.changelog) : "No notes"}</td>
                          <td>{v.sourceCommit ? <code className="bw-icode">{v.sourceCommit.slice(0, 7)}</code> : <span className="bw-muted">{v.sourceRef ?? ""}</span>}{v.signature ? " ✓ signed" : ""}</td>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>
                            {formatBytes(v.bundleSize)}
                          </td>
                          <td>
                            <a className="bw-link" href={`${siteUrl}/api/v1/bundle/${extension.slug}/${v.version}`}>
                              Download<span className="sr-only"> version {v.version}</span>
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            <section>
              <h2 className="dx-h2">Ratings</h2>
              <p>{rating ? `${rating.average} out of 5 from ${rating.count} ${rating.count === 1 ? "rating" : "ratings"}.` : "No ratings yet."}</p>
              {reviews.filter((r) => r.body).slice(0, 10).map((r) => (
                <blockquote key={r.id} className="dx-review">
                  <p><span aria-label={`${r.stars} stars`}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</span> @{r.login}</p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{r.body}</p>
                </blockquote>
              ))}
              {user ? <RateForm slug={extension.slug} /> : <p className="bw-help"><a className="bw-link" href={`/api/v1/auth/github?returnTo=${encodeURIComponent(`/extension/${extension.slug}`)}`}>Sign in with GitHub</a> to rate it.</p>}
            </section>

            <section>
              <h2 className="dx-h2">Report a problem</h2>
              <ReportForm slug={extension.slug} versions={extension.versions.map((v) => v.version)} />
            </section>
          </div>

          <aside className="dx-stack" style={{ gap: 40 }}>
            <section>
              <h2 className="dx-h2">Details</h2>
              <dl className="bw-deflist">
                <div>
                  <dt>Type</dt>
                  <dd>{typeLabel}</dd>
                </div>
                <div>
                  <dt>Licence</dt>
                  <dd>{extension.license}</dd>
                </div>
                <div>
                  <dt>Downloads</dt>
                  <dd>{formatDownloads(extension.totalDownloads ?? 0)}</dd>
                </div>
                {extension.minAppVersion ? (
                  <div>
                    <dt>Needs Bulwark</dt>
                    <dd>{extension.minAppVersion} or later</dd>
                  </div>
                ) : null}
                {latestVersion ? (
                  <div>
                    <dt>Bundle</dt>
                    <dd>{formatBytes(latestVersion.bundleSize)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Updated</dt>
                  <dd>{timeAgo(extension.updatedAt)}</dd>
                </div>
                {repo ? (
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <a className="bw-link" href={repo.href} target="_blank" rel="noopener noreferrer">
                        {repo.label}
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section>
              <h2 className="dx-h2">Permissions</h2>
              <PermissionList permissions={extension.permissions ?? []} isTheme={!isPlugin} />
            </section>

            {extension.tags && extension.tags.length > 0 ? (
              <section>
                <h2 className="dx-h2">Tags</h2>
                <ul className="dx-tags">
                  {extension.tags.map((tag) => (
                    <li key={tag}>
                      <Link className="bw-link" href={`/search?tag=${encodeURIComponent(tag)}`}>
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </article>
  );
}
