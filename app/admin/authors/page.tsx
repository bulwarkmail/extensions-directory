"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Minus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Status } from "@/components/status";
import { ICON } from "@/components/icon";

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

  return (
    <div>
      <div className="dx-work-head" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="bw-h2">Authors</h1>
          <p>Everyone who has signed in with GitHub. Banning an author hides their public page and their dashboard.</p>
        </div>
      </div>

      {loading ? (
        <p className="bw-help" aria-live="polite">
          Loading authors…
        </p>
      ) : authors.length === 0 ? (
        <p className="bw-help">No authors yet.</p>
      ) : (
        <div className="bw-table-wrap">
          <table className="bw-table">
            <thead>
              <tr>
                <th scope="col">Author</th>
                <th scope="col">GitHub</th>
                <th scope="col">Verified</th>
                <th scope="col">Status</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {authors.map((author) => (
                <tr key={author.id}>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 180 }}>
                      <span className="dx-initial dx-initial-sm" aria-hidden="true">
                        {author.displayName?.charAt(0).toUpperCase() ?? "?"}
                      </span>
                      {author.banned ? (
                        author.displayName
                      ) : (
                        <Link href={`/author/${author.githubLogin}`} className="bw-link">
                          {author.displayName}
                        </Link>
                      )}
                    </span>
                  </td>
                  <td>@{author.githubLogin}</td>
                  <td>
                    {author.verified ? (
                      <span className="dx-st">
                        <BadgeCheck size={16} {...ICON} />
                        Yes
                      </span>
                    ) : (
                      <span className="dx-st dx-st-off">
                        <Minus size={16} {...ICON} />
                        No
                      </span>
                    )}
                  </td>
                  <td>
                    <Status value={author.banned ? "banned" : "active"} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(author.createdAt)}</td>
                  <td>
                    <button type="button" className="dx-textbtn" onClick={() => toggleBan(author.id, author.banned)}>
                      {author.banned ? "Unban" : "Ban"}
                      <span className="sr-only"> {author.displayName}</span>
                    </button>
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
