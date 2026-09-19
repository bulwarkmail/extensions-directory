"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDownloads, timeAgo } from "@/lib/utils";
import { EditExtensionButton } from "@/components/edit-extension-button";
import { formatTypeLabel } from "@/components/ext-icon";
import { Status } from "@/components/status";

interface Extension {
  id: string;
  name: string;
  slug: string;
  type: string;
  pluginType?: string | null;
  status: string;
  featured: boolean;
  totalDownloads: number;
  updatedAt: string;
  githubRepo: string;
  subpath: string;
  description: string;
  author?: { displayName: string };
}

// Display only: githubRepo may be "owner/repo" or a full URL.
const repoName = (r: string) => r.replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");

export default function AdminExtensionsPage() {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);

  function fetchExtensions() {
    fetch("/api/v1/admin/extensions")
      .then((r) => r.json())
      .then((data) => setExtensions(data.extensions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchExtensions();
  }, []);

  async function toggleFeatured(id: string, featured: boolean) {
    await fetch("/api/v1/admin/extensions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensionId: id, featured: !featured }),
    });
    fetchExtensions();
  }

  async function updateStatus(id: string, status: string) {
    await fetch("/api/v1/admin/extensions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensionId: id, status }),
    });
    fetchExtensions();
  }

  return (
    <div>
      <div className="dx-work-head" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="bw-h2">Extensions</h1>
          <p>Every extension in the directory, published or not. Changes apply at once.</p>
        </div>
      </div>

      {loading ? (
        <p className="bw-help" aria-live="polite">
          Loading extensions…
        </p>
      ) : extensions.length === 0 ? (
        <p className="bw-help">No extensions yet.</p>
      ) : (
        <div className="bw-table-wrap">
          <table className="bw-table">
            <thead>
              <tr>
                <th scope="col">Extension</th>
                <th scope="col">Author</th>
                <th scope="col" className="num">
                  Downloads
                </th>
                <th scope="col">Status</th>
                <th scope="col">Featured</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {extensions.map((ext) => (
                <tr key={ext.id}>
                  <td>
                    {ext.status === "approved" ? (
                      <Link href={`/extension/${ext.slug}`} className="bw-link">
                        {ext.name}
                      </Link>
                    ) : (
                      ext.name
                    )}
                    <span className="bw-help" style={{ display: "block", marginTop: 2 }}>
                      {formatTypeLabel(ext.type, ext.pluginType)} · {repoName(ext.githubRepo)}
                      {ext.subpath ? `/${ext.subpath}` : ""}
                    </span>
                  </td>
                  <td>{ext.author?.displayName ?? "Unknown"}</td>
                  <td className="num">{formatDownloads(ext.totalDownloads)}</td>
                  <td>
                    <Status value={ext.status} />
                  </td>
                  <td>
                    <label className="bw-check">
                      <input
                        type="checkbox"
                        checked={ext.featured}
                        onChange={() => toggleFeatured(ext.id, ext.featured)}
                      />
                      <span className="sr-only">Featured: {ext.name}</span>
                    </label>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{timeAgo(ext.updatedAt)}</td>
                  <td style={{ paddingRight: 0 }}>
                    <div className="dx-rowact">
                      <EditExtensionButton
                        slug={ext.slug}
                        extensionName={ext.name}
                        defaultRepo={ext.githubRepo}
                        defaultSubpath={ext.subpath ?? ""}
                        defaultDescription={ext.description}
                        asAdmin
                        onSaved={fetchExtensions}
                        buttonLabel="Edit"
                        buttonClassName="dx-textbtn"
                      />
                      {ext.status === "approved" ? (
                        <button type="button" className="dx-textbtn" onClick={() => updateStatus(ext.id, "suspended")}>
                          Suspend<span className="sr-only"> {ext.name}</span>
                        </button>
                      ) : ext.status === "suspended" ? (
                        <button type="button" className="dx-textbtn" onClick={() => updateStatus(ext.id, "approved")}>
                          Reinstate<span className="sr-only"> {ext.name}</span>
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
