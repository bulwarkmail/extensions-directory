import type { Metadata } from "next";
import { allRatings } from "@/lib/dashboard";
import { timeAgo } from "@/lib/utils";
import { ActionButton } from "@/components/client/action";

export const metadata: Metadata = { title: "Ratings" };

export default function RatingsPage() {
  const rows = allRatings();
  return (
    <div>
      <h1 className="bw-h2">Ratings</h1>
      {rows.length === 0 ? <p className="bw-help">No ratings yet.</p> : (
        <div className="bw-table-wrap">
          <table className="bw-table">
            <thead><tr><th scope="col">Extension</th><th scope="col">Stars</th><th scope="col">Review</th><th scope="col">By</th><th scope="col">When</th><th scope="col"><span className="bw-muted">Actions</span></th></tr></thead>
            <tbody>
              {rows.map(({ r, slug, login }) => (
                <tr key={r.id}>
                  <td>{slug}</td>
                  <td>{"★".repeat(r.stars)}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{r.body}{r.hiddenAt ? <div className="bw-help">Hidden</div> : null}</td>
                  <td>@{login}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{timeAgo(r.updatedAt)}</td>
                  <td><ActionButton path={`/admin/ratings/${r.id}`} body={{ hidden: !r.hiddenAt }} label={r.hiddenAt ? "Show" : "Hide"} ghost small /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
