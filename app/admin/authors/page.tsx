"use client";

import { useEffect, useState } from "react";

interface Author {
  id: string;
  displayName: string;
  githubLogin: string;
  avatarUrl: string | null;
  verified: boolean;
  banned: boolean;
  createdAt: string;
}

export default function AdminAuthorsPage() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);

  function fetchAuthors() {
    fetch("/api/v1/admin/authors")
      .then((r) => r.json())
      .then((data) => setAuthors(data.authors ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchAuthors();
  }, []);

  async function toggleBan(id: string, banned: boolean) {
    await fetch("/api/v1/admin/authors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorId: id,
        action: banned ? "unban" : "ban",
      }),
    });
    fetchAuthors();
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading authors…</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-foreground">
        Authors
      </h2>

      {authors.length === 0 ? (
        <p className="mt-4 text-muted-foreground">No authors yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {authors.map((author) => (
            <div
              key={author.id}
              className="flex items-center justify-between rounded-[0.375rem] border border-border p-3"
            >
              <div className="flex items-center gap-3">
                {author.avatarUrl ? (
                  <img
                    src={author.avatarUrl}
                    alt={author.displayName}
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                    {author.displayName?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {author.displayName}
                    {author.verified && (
                      <span className="ml-1 text-info">✓</span>
                    )}
                    {author.banned && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        Banned
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    @{author.githubLogin}
                  </p>
                </div>
              </div>
              <button
                onClick={() => toggleBan(author.id, author.banned)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  author.banned
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-red-600 text-white hover:bg-red-700"
                }`}
              >
                {author.banned ? "Unban" : "Ban"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
