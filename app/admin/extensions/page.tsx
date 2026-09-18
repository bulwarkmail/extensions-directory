"use client";

import { useEffect, useState } from "react";
import { formatDownloads, timeAgo } from "@/lib/utils";
import { EditExtensionButton } from "@/components/edit-extension-button";

interface Extension {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  featured: boolean;
  totalDownloads: number;
  updatedAt: string;
  githubRepo: string;
  subpath: string;
  description: string;
  author?: { displayName: string };
}

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

  if (loading) {
    return <p className="text-muted-foreground">Loading extensions…</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-foreground">All extensions</h2>

      {extensions.length === 0 ? (
        <p className="mt-4 text-muted-foreground">No extensions yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 font-medium text-foreground">Name</th>
                <th className="px-3 py-2 font-medium text-foreground">Type</th>
                <th className="px-3 py-2 font-medium text-foreground">Author</th>
                <th className="px-3 py-2 font-medium text-foreground">Repo · subpath</th>
                <th className="px-3 py-2 font-medium text-foreground">Downloads</th>
                <th className="px-3 py-2 font-medium text-foreground">Status</th>
                <th className="px-3 py-2 font-medium text-foreground">Featured</th>
                <th className="px-3 py-2 font-medium text-foreground">Updated</th>
                <th className="px-3 py-2 font-medium text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {extensions.map((ext) => (
                <tr key={ext.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {ext.name}
                  </td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">
                    {ext.type}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ext.author?.displayName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                    {ext.githubRepo}
                    {ext.subpath ? (
                      <span className="text-foreground/55">/{ext.subpath}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDownloads(ext.totalDownloads)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium ${
                        ext.status === "approved"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : ext.status === "suspended"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {ext.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => toggleFeatured(ext.id, ext.featured)}
                      className={`text-lg ${
                        ext.featured ? "text-warning" : "text-muted-foreground/40"
                      }`}
                      title={
                        ext.featured ? "Remove from featured" : "Mark as featured"
                      }
                    >
                      ★
                    </button>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {timeAgo(ext.updatedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <EditExtensionButton
                        slug={ext.slug}
                        extensionName={ext.name}
                        defaultRepo={ext.githubRepo}
                        defaultSubpath={ext.subpath ?? ""}
                        defaultDescription={ext.description}
                        asAdmin
                        onSaved={fetchExtensions}
                        buttonLabel="Edit"
                      />
                      {ext.status === "approved" ? (
                        <button
                          onClick={() => updateStatus(ext.id, "suspended")}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Suspend
                        </button>
                      ) : ext.status === "suspended" ? (
                        <button
                          onClick={() => updateStatus(ext.id, "approved")}
                          className="text-xs text-green-600 hover:underline"
                        >
                          Reinstate
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
