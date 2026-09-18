import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  Github,
  Palette,
  Puzzle,
} from "lucide-react";
import { getExtensionBySlug } from "@/lib/db/queries";
import { PermissionList } from "@/components/permission-badge";
import { formatDownloads, formatDate, formatBytes, timeAgo } from "@/lib/utils";
import type { Metadata } from "next";

const SANS = "var(--font-exo2), system-ui, sans-serif";
const SERIF = "var(--font-source-serif), 'Source Serif 4', Georgia, serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

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
  const Icon = extension.type === "plugin" ? Puzzle : Palette;

  return (
    <article className="text-foreground">
      {/* Hero / header */}
      <header className="px-5 sm:px-8 lg:px-14 pt-14 sm:pt-20 pb-12 sm:pb-14 border-b border-[color:var(--rule)]">
        <div className="mx-auto max-w-[1440px]">
          <div className="flex items-center gap-2 mb-6">
            <Link
              href={extension.type === "plugin" ? "/plugins" : "/themes"}
              className="inline-flex items-center"
              style={{
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--rasp)",
              }}
            >
              {extension.type === "plugin" ? "Plugins" : "Themes"}
            </Link>
            <span className="ed-folio">·</span>
            <span className="ed-folio">{typeLabel}</span>
            {extension.featured && (
              <>
                <span className="ed-folio">·</span>
                <span
                  className="ed-folio"
                  style={{ color: "var(--rasp)", fontStyle: "normal" }}
                >
                  Featured
                </span>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-10 items-start">
            <div
              className="flex h-20 w-20 sm:h-24 sm:w-24 shrink-0 items-center justify-center bg-[color:var(--alt-section)] border border-[color:var(--rule)] text-foreground/70"
            >
              {extension.iconPath ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/v1/files/${extension.iconPath}`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Icon className="w-10 h-10" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1
                style={{
                  fontFamily: SANS,
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.95,
                  fontSize: "clamp(2rem, 6vw, 4.75rem)",
                  margin: 0,
                  textWrap: "balance",
                }}
              >
                {extension.name}
              </h1>
              {extension.author && (
                <p
                  className="mt-3 text-foreground/70"
                  style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 17 }}
                >
                  by{" "}
                  <Link
                    href={`/author/${extension.author.githubLogin}`}
                    className="text-foreground hover:text-[color:var(--rasp)] transition-colors"
                    style={{ fontStyle: "normal", fontFamily: SANS, fontWeight: 500 }}
                  >
                    {extension.author.displayName}
                  </Link>
                  {extension.author.verified && (
                    <CheckCircle2
                      className="inline w-4 h-4 ml-1 text-[color:var(--rasp)] align-[-0.18em]"
                      aria-label="Verified"
                    />
                  )}
                </p>
              )}
              <p
                className="mt-6 text-foreground/85"
                style={{
                  fontFamily: SANS,
                  fontSize: "clamp(1.0625rem, 1.4vw, 1.25rem)",
                  lineHeight: 1.55,
                  maxWidth: 760,
                }}
              >
                {extension.description}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {latestVersion && (
                  <a
                    href={`${siteUrl}/api/v1/bundle/${extension.slug}/${latestVersion.version}`}
                    className="ed-cta-primary"
                  >
                    <Download className="w-4 h-4" />
                    Download v{latestVersion.version}
                  </a>
                )}
                {extension.githubRepo && (
                  <a
                    href={`https://github.com/${extension.githubRepo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ed-cta-ghost"
                  >
                    <Github className="w-4 h-4" />
                    View source
                    <ArrowUpRight className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Banner */}
      {extension.bannerPath && (
        <section className="px-5 sm:px-8 lg:px-14 pt-10">
          <div className="mx-auto max-w-[1440px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/v1/files/${extension.bannerPath}`}
              alt=""
              className="ed-plate w-full"
            />
          </div>
        </section>
      )}

      {/* Body */}
      <section className="px-5 sm:px-8 lg:px-14 py-12 sm:py-16">
        <div className="mx-auto max-w-[1440px]">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12 lg:gap-16 items-start">
            {/* Main column */}
            <div className="space-y-12 min-w-0">
              {extension.longDescription && (
                <SectionBlock title="About">
                  <div
                    className="ext-prose"
                    dangerouslySetInnerHTML={{ __html: extension.longDescription }}
                  />
                </SectionBlock>
              )}

              {extension.screenshots.length > 0 && (
                <SectionBlock title="Screenshots">
                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {extension.screenshots.map((s) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        key={s.id}
                        src={`/api/v1/files/${s.path}`}
                        alt={s.altText || "Screenshot"}
                        className="h-56 ed-plate object-cover"
                        style={{ width: "auto" }}
                      />
                    ))}
                  </div>
                </SectionBlock>
              )}

              {extension.versions.length > 0 && (
                <SectionBlock title="Versions">
                  <ul className="list-none m-0 p-0 border-t-2 border-foreground">
                    {extension.versions.map((v) => (
                      <li
                        key={v.id}
                        className="py-4 border-b border-[color:var(--rule)] grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 sm:gap-4 items-baseline"
                      >
                        <span
                          className="text-foreground tabular-nums"
                          style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}
                        >
                          v{v.version}
                        </span>
                        <span
                          className="text-foreground/65"
                          style={{ fontFamily: SERIF, fontSize: 14, fontStyle: "italic" }}
                        >
                          {v.changelog || formatDate(v.publishedAt)}
                        </span>
                        <a
                          href={`${siteUrl}/api/v1/bundle/${extension.slug}/${v.version}`}
                          className="inline-flex items-center gap-1.5 text-foreground"
                          style={{
                            fontFamily: MONO,
                            fontSize: 12,
                            fontWeight: 500,
                            letterSpacing: "0.04em",
                            borderBottom: "1.5px solid var(--rasp)",
                            paddingBottom: 4,
                            width: "fit-content",
                          }}
                        >
                          DOWNLOAD · {formatBytes(v.bundleSize)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </SectionBlock>
              )}
            </div>

            {/* Sidebar */}
            <aside className="space-y-10 lg:sticky lg:top-24 self-start">
              <SidebarBlock title="Details">
                <Row label="Type">{typeLabel}</Row>
                <Row label="License">{extension.license}</Row>
                {(extension.totalDownloads ?? 0) > 0 && (
                  <Row label="Downloads">
                    {formatDownloads(extension.totalDownloads ?? 0)}
                  </Row>
                )}
                {extension.minAppVersion && (
                  <Row label="Min app">{extension.minAppVersion}</Row>
                )}
                {latestVersion && (
                  <Row label="Bundle">{formatBytes(latestVersion.bundleSize)}</Row>
                )}
                <Row label="Updated">{timeAgo(extension.updatedAt)}</Row>
              </SidebarBlock>

              <SidebarBlock title="Permissions">
                <PermissionList permissions={extension.permissions ?? []} />
              </SidebarBlock>

              {extension.tags && extension.tags.length > 0 && (
                <SidebarBlock title="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {extension.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/search?tag=${tag}`}
                        className="inline-flex px-2 py-1 text-foreground/70 hover:text-[color:var(--rasp)] hover:border-[color:var(--rasp)] transition-colors"
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          border: "1px solid var(--rule)",
                          background: "var(--alt-section)",
                        }}
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                </SidebarBlock>
              )}
            </aside>
          </div>
        </div>
      </section>
    </article>
  );
}

function SectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="mb-5"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--rasp)",
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function SidebarBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="mb-4 pb-3 border-b-2 border-foreground"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--foreground)",
        }}
      >
        {title}
      </div>
      <div className="space-y-2.5 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-[color:var(--rule)] last:border-b-0">
      <dt
        className="text-foreground/65"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </dt>
      <dd
        className="text-right text-foreground"
        style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 500 }}
      >
        {children}
      </dd>
    </div>
  );
}

const PLUGIN_TYPE_LABELS: Record<string, string> = {
  hook: "Hook",
  "ui-extension": "UI Extension",
  "sidebar-app": "Sidebar App",
};

function formatTypeLabel(type: string, pluginType: string | null): string {
  if (type === "theme") return "Theme";
  if (pluginType && PLUGIN_TYPE_LABELS[pluginType]) {
    return PLUGIN_TYPE_LABELS[pluginType];
  }
  return "Plugin";
}
