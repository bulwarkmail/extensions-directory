// The bundle download, for /api/v1/bundle and the v2 bundle route. Serves
// approved versions of listed and archived extensions, yanked ones too (for
// installs pinned to them), never anything of a suspended extension. Adds
// the directory signature so a webmail can check where the bytes came from.
import { getStoredFile } from "./storage";
import { recordDownload } from "./downloads";
import type { extensions, extensionVersions } from "./db/schema";

type Ext = typeof extensions.$inferSelect;
type Version = typeof extensionVersions.$inferSelect;

export function servable(ext: Ext | null | undefined, v: Version | null | undefined): v is Version {
  return !!ext && !!v && (ext.status === "approved" || ext.status === "archived") && v.reviewStatus === "approved";
}

export async function bundleResponse(request: Request, ext: Ext, v: Version): Promise<Response> {
  const file = await getStoredFile(v.bundlePath);
  if (!file) return Response.json({ error: "Bundle file not found" }, { status: 404 });
  recordDownload(request, ext.id, v.id);
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${ext.slug}-${v.version}.zip"`,
    "Content-Length": String(file.length),
    "X-Content-SHA256": v.bundleSha256,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=3600",
  };
  if (v.signature && v.signedStatement && v.signingKeyId) {
    headers["X-Bundle-Statement"] = Buffer.from(v.signedStatement, "utf8").toString("base64");
    headers["X-Bundle-Signature"] = v.signature;
    headers["X-Bundle-Signature-Key"] = v.signingKeyId;
  }
  if (v.yankedAt) headers["X-Bundle-Yanked"] = encodeURIComponent(v.yankReason ?? "yanked");
  return new Response(new Uint8Array(file), { headers });
}
