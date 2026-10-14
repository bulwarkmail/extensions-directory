import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account suspended" };

export default function BannedPage() {
  return (
    <div className="bw-w">
      <div className="dx-msg">
        <h1 className="bw-h2">This account can&apos;t sign in.</h1>
        <p>It was suspended by the directory staff. If you think that is a mistake, write to the Bulwark Mail team.</p>
        <div className="bw-btns"><Link href="/" className="bw-btn bw-btn-ghost">Back to the directory</Link></div>
      </div>
    </div>
  );
}
