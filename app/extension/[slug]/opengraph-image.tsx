import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import { getExtensionBySlug } from "@/lib/db/queries";
import { formatDownloads } from "@/lib/utils";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "Bulwark Extension";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");
const PROJECT_ROOT = process.cwd();

const COLORS = {
  bg: "#0a0a0a",
  card: "#111111",
  border: "#262626",
  fg: "#fafafa",
  muted: "#a3a3a3",
  primary: "#db2d54",
  primaryDim: "rgba(219,45,84,0.20)",
  pluginTint: "rgba(219,45,84,0.14)",
  pluginText: "#f7a3b6",
  themeTint: "rgba(139,92,246,0.18)",
  themeText: "#c4b5fd",
};

function mimeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function readAsDataUrl(absPath: string): Promise<string | null> {
  try {
    const buf = await readFile(absPath);
    return `data:${mimeFor(absPath)};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadIcon(iconPath: string | null): Promise<string | null> {
  if (!iconPath) return null;
  const safe = iconPath.replace(/^\/+/, "").replace(/\\/g, "/");
  return readAsDataUrl(path.join(UPLOADS_DIR, safe));
}

async function loadLogo(): Promise<string | null> {
  return readAsDataUrl(path.join(PROJECT_ROOT, "public", "extension logo.svg"));
}

async function loadFont(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(path.join(PROJECT_ROOT, "public", "fonts", file));
    return buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Cut at the last word boundary so satori doesn't wrap a half-word
  // onto a third line.
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ext = await getExtensionBySlug(slug).catch(() => null);

  const [logoDataUrl, regular, bold, extraBold] = await Promise.all([
    loadLogo(),
    loadFont("Inter-Regular.ttf"),
    loadFont("Inter-Bold.ttf"),
    loadFont("Inter-ExtraBold.ttf"),
  ]);

  const fonts: ConstructorParameters<typeof ImageResponse>[1] extends infer O
    ? O extends { fonts?: infer F }
      ? F
      : never
    : never = [];
  if (regular) fonts.push({ name: "Inter", data: regular, weight: 400 });
  if (bold) fonts.push({ name: "Inter", data: bold, weight: 700 });
  if (extraBold) fonts.push({ name: "Inter", data: extraBold, weight: 800 });

  if (!ext || ext.status !== "approved") {
    return new ImageResponse(<FallbackCard logoDataUrl={logoDataUrl} />, {
      ...size,
      fonts,
    });
  }

  const iconDataUrl = await loadIcon(ext.iconPath);
  const isPlugin = ext.type === "plugin";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: COLORS.bg,
          color: COLORS.fg,
          fontFamily: "Inter",
          position: "relative",
        }}
      >
        {/* Brand glow */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: -260,
            width: 900,
            height: 900,
            background: `radial-gradient(circle, ${COLORS.primaryDim} 0%, transparent 60%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -340,
            right: -240,
            width: 800,
            height: 800,
            background: `radial-gradient(circle, rgba(219,45,84,0.10) 0%, transparent 60%)`,
            display: "flex",
          }}
        />

        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "44px 60px 0 60px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logoDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoDataUrl}
                alt=""
                width={56}
                height={56}
                style={{ display: "block" }}
              />
            )}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: "-0.015em",
              }}
            >
              <span style={{ color: COLORS.fg }}>Bulwark</span>
              <span style={{ color: COLORS.primary }}>Extensions</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 18px",
              borderRadius: 8,
              background: isPlugin ? COLORS.pluginTint : COLORS.themeTint,
              color: isPlugin ? COLORS.pluginText : COLORS.themeText,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {isPlugin ? "Plugin" : "Theme"}
          </div>
        </div>

        {/* Main card */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            margin: "40px 60px 50px 60px",
            padding: 52,
            borderRadius: 24,
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            flex: 1,
            justifyContent: "space-between",
          }}
        >
          {/* Top: icon + name */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 36 }}>
            <div
              style={{
                width: 168,
                height: 168,
                borderRadius: 28,
                background: iconDataUrl
                  ? COLORS.bg
                  : isPlugin
                    ? COLORS.pluginTint
                    : COLORS.themeTint,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flexShrink: 0,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              {iconDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={iconDataUrl}
                  alt=""
                  width={148}
                  height={148}
                  style={{ borderRadius: 20, display: "block" }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 86,
                    fontWeight: 800,
                    letterSpacing: "-0.04em",
                    color: isPlugin ? COLORS.pluginText : COLORS.themeText,
                    display: "flex",
                  }}
                >
                  {initials(ext.name)}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 80,
                  fontWeight: 800,
                  lineHeight: 1.0,
                  letterSpacing: "-0.03em",
                  color: COLORS.fg,
                  display: "flex",
                }}
              >
                {truncate(ext.name, 28)}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginTop: 18,
                  fontSize: 26,
                  fontWeight: 400,
                  color: COLORS.muted,
                }}
              >
                <span>by {ext.author?.displayName ?? "Unknown"}</span>
                {ext.latestVersion?.version && (
                  <>
                    <span style={{ color: COLORS.border }}>•</span>
                    <span style={{ color: COLORS.fg, fontWeight: 700 }}>
                      v{ext.latestVersion.version}
                    </span>
                  </>
                )}
              </div>
              {ext.githubRepo && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 16,
                    fontSize: 22,
                    fontWeight: 400,
                    color: COLORS.muted,
                  }}
                >
                  <GitHubMark color={COLORS.muted} />
                  <span style={{ color: COLORS.fg }}>{ext.githubRepo}</span>
                </div>
              )}
            </div>
          </div>

          {/* Description — truncate to ~2 lines worth of text. ~64 chars per
              line at 30px Inter on a ~970px column; truncate at a word
              boundary just under 2 lines so it never spills onto a 3rd. */}
          <div
            style={{
              fontSize: 30,
              lineHeight: 1.3,
              fontWeight: 400,
              color: COLORS.muted,
              marginTop: 32,
            }}
          >
            {truncate(ext.description, 120)}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 36,
              fontSize: 24,
              color: COLORS.muted,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: COLORS.primary,
                fontWeight: 700,
              }}
            >
              /{ext.slug}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <DownloadIcon color={COLORS.muted} />
              <span style={{ color: COLORS.fg, fontWeight: 700 }}>
                {formatDownloads(ext.totalDownloads ?? 0)}
              </span>
              <span>downloads</span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}

function FallbackCard({ logoDataUrl }: { logoDataUrl: string | null }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
        background: COLORS.bg,
        color: COLORS.fg,
        fontFamily: "Inter",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -200,
          left: "50%",
          transform: "translateX(-50%)",
          width: 1000,
          height: 1000,
          background: `radial-gradient(circle, ${COLORS.primaryDim} 0%, transparent 60%)`,
          display: "flex",
        }}
      />
      {logoDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoDataUrl} alt="" width={140} height={140} />
      )}
      <div
        style={{
          fontSize: 76,
          fontWeight: 800,
          letterSpacing: "-0.025em",
          display: "flex",
          gap: 16,
        }}
      >
        <span>Bulwark</span>
        <span style={{ color: COLORS.primary }}>Extensions</span>
      </div>
      <div
        style={{
          fontSize: 32,
          color: COLORS.muted,
          display: "flex",
          fontWeight: 400,
        }}
      >
        Plugins and themes for Bulwark Webmail
      </div>
    </div>
  );
}

function GitHubMark({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        fill={color}
        d="M12 .5C5.4.5 0 5.9 0 12.5c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.3-.1-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.3 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.3 3.3-1.3.7 1.7.2 3 .1 3.3.8.9 1.3 2 1.3 3.3 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6C20.6 22.3 24 17.8 24 12.5 24 5.9 18.6.5 12 .5Z"
      />
    </svg>
  );
}

function DownloadIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
