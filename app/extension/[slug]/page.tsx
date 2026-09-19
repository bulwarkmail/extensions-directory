import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, BadgeCheck, Download } from "lucide-react";
import { getExtensionBySlug } from "@/lib/db/queries";
import { PermissionList } from "@/components/permission-badge";
import { ExtIcon, formatTypeLabel } from "@/components/ext-icon";
import { ICON } from "@/components/icon";
import { formatDownloads, formatDate, formatBytes, timeAgo } from "@/lib/utils";
import type { Metadata } from "next";

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
function repoParts(githubRepo: string, subpath: string | null) {
  const name = githubRepo.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
  const sub = (subpath ?? "").replace(/^\/+|\/+$/g, "");
  return {
    label: sub ? `${name}/${sub}` : name,
    href: `https://github.com/${name}${sub ? `/tree/HEAD/${sub}` : ""}`,
  };
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
  const repo = extension.githubRepo ? repoParts(extension.githubRepo, extension.subpath) : null;
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
        <div className="dx-split">
          <div className="dx-stack">
            {extension.longDescription ? (
              <section>
                <h2 className="dx-h2">About</h2>
                <div className="ext-prose" dangerouslySetInnerHTML={{ __html: extension.longDescription }} />
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
                          <td>{v.version}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{formatDate(v.publishedAt)}</td>
                          <td>{v.changelog || "No notes"}</td>
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
