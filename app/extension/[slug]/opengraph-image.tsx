import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import { getExtensionBySlug } from "@/lib/db/queries";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "Bulwark Extension";

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");
const PROJECT_ROOT = process.cwd();

// The social card follows the website's (repos/website/scripts/og.mjs): the
// raspberry field, the white mark and wordmark top-left, the title at 60px
// in Hanken Grotesk 400, the host bottom-left, and the product picture (here
// the author's banner) leaving the card at the right in a 1px frame.
const FIELD = "#db2d54";
const ON_FIELD = "#ffffff";
const FRAME = "rgba(255,255,255,0.55)";

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

async function loadUpload(rel: string | null): Promise<string | null> {
  if (!rel) return null;
  const safe = rel.replace(/^\/+/, "").replace(/\\/g, "/");
  if (safe.split("/").includes("..")) return null;
  return readAsDataUrl(path.join(UPLOADS_DIR, safe));
}

// Static instances of Hanken Grotesk (SIL Open Font License) shipped in
// public/fonts, so rendering makes no network request.
async function loadFont(file: string): Promise<ArrayBuffer | null> {
  try {
    const buf = await readFile(path.join(PROJECT_ROOT, "public", "fonts", file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function Mark({ size: s }: { size: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 1000 1000">
      <path fill={ON_FIELD} d="M373.467 557.247L55.226 271.52V385.564C55.226 398.153 62.453 415.6 71.355 424.501L107.525 460.671C116.426 469.573 123.653 487.02 123.653 499.609V682.08C123.655 718.462 133.336 750.017 152.047 778.668L373.467 557.247z" />
      <path fill={ON_FIELD} d="M626.533 557.247L944.774 271.52V396.969C944.774 403.263 941.16 411.987 936.709 416.437L884.411 468.736C879.96 473.186 876.347 481.91 876.347 488.204V682.08C876.345 718.462 866.664 750.017 847.953 778.668L626.533 557.247z" />
      <path fill={ON_FIELD} d="M500 638.743C466.206 638.738 448.855 625.316 424.448 603.033L197.809 829.672C261.382 884.635 364.213 931.859 500 990C635.787 931.859 738.618 884.635 802.191 829.672L575.552 603.033C551.145 625.316 533.794 638.738 500 638.743z" />
      <path fill={ON_FIELD} d="M483.028 563.647L63.713 187.183C59.029 182.978 55.226 174.454 55.226 168.159V122.542C55.226 116.247 60.206 109.988 66.339 108.573L215.181 74.225C221.314 72.809 226.293 76.77 226.293 83.065V176.92L352.034 147.895C358.167 146.479 363.147 140.219 363.147 133.925V51.483C363.147 45.189 368.126 38.93 374.259 37.514L488.888 11.061C495.021 9.646 504.979 9.646 511.112 11.061L625.741 37.514C631.874 38.93 636.853 45.189 636.853 51.483V133.925C636.853 140.219 641.833 146.479 647.966 147.895L773.707 176.92V83.065C773.707 76.77 778.686 72.809 784.819 74.225L933.661 108.573C939.794 109.988 944.774 116.247 944.774 122.542V168.159C944.774 174.454 940.971 182.978 936.287 187.183L516.972 563.647C512.288 567.852 504.684 567.852 500 567.852C495.316 567.852 487.712 567.852 483.028 563.647z" />
    </svg>
  );
}

function Card({
  title,
  sentence,
  icon,
  initial,
  banner,
}: {
  title: string;
  sentence: string;
  icon?: string | null;
  initial?: string;
  banner?: string | null;
}) {
  const textWidth = banner ? 540 : 1000;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: FIELD,
        color: ON_FIELD,
        fontFamily: "Hanken Grotesk",
      }}
    >
      <div style={{ position: "absolute", top: 56, left: 64, display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 600 }}>
        <Mark size={36} />
        <span>
          Bulwark <span style={{ fontWeight: 400, marginLeft: 8 }}>Extensions</span>
        </span>
      </div>

      <div style={{ position: "absolute", top: 172, left: 64, width: textWidth, display: "flex", flexDirection: "column", gap: 24 }}>
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" width={88} height={88} />
        ) : initial ? (
          <div
            style={{
              width: 88,
              height: 88,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${FRAME}`,
              fontSize: 40,
              fontWeight: 500,
            }}
          >
            {initial}
          </div>
        ) : null}
        <div style={{ fontSize: 60, lineHeight: 1.06, letterSpacing: "-0.015em", fontWeight: 400 }}>{title}</div>
        <div style={{ fontSize: 26, lineHeight: 1.4, fontWeight: 400 }}>{sentence}</div>
      </div>

      <div style={{ position: "absolute", bottom: 52, left: 64, fontSize: 24 }}>extensions.bulwarkmail.org</div>

      {banner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={banner}
          alt=""
          width={640}
          height={360}
          style={{
            position: "absolute",
            left: 652,
            top: 190,
            borderTop: `1px solid ${FRAME}`,
            borderLeft: `1px solid ${FRAME}`,
            objectFit: "cover",
          }}
        />
      ) : null}
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ext = await getExtensionBySlug(slug).catch(() => null);

  const [regular, medium, semibold] = await Promise.all([
    loadFont("HankenGrotesk-Regular.ttf"),
    loadFont("HankenGrotesk-Medium.ttf"),
    loadFont("HankenGrotesk-SemiBold.ttf"),
  ]);

  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 }[] = [];
  if (regular) fonts.push({ name: "Hanken Grotesk", data: regular, weight: 400 });
  if (medium) fonts.push({ name: "Hanken Grotesk", data: medium, weight: 500 });
  if (semibold) fonts.push({ name: "Hanken Grotesk", data: semibold, weight: 600 });

  if (!ext || ext.status !== "approved") {
    return new ImageResponse(
      <Card title="Plugins and themes for Bulwark Webmail." sentence="Free, open source and reviewed before they are published." />,
      { ...size, fonts }
    );
  }

  const [icon, banner] = await Promise.all([loadUpload(ext.iconPath), loadUpload(ext.bannerPath)]);
  const by = ext.author?.displayName ? ` by ${ext.author.displayName}` : "";
  const kind = ext.type === "theme" ? "A theme" : "A plugin";

  return new ImageResponse(
    (
      <Card
        title={truncate(ext.name, banner ? 26 : 40)}
        sentence={truncate(`${kind}${by}. ${ext.description}`, banner ? 110 : 160)}
        icon={icon}
        initial={ext.name.trim().charAt(0).toUpperCase()}
        banner={banner}
      />
    ),
    { ...size, fonts }
  );
}
