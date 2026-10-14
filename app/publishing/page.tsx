import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { renderMarkdown } from "@/lib/markdown";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Publishing",
  description: "How to publish a Bulwark Webmail extension from the dashboard, GitHub Actions or any CI.",
};

// content/publishing.md is traced into the build (next.config.ts).
export default function PublishingPage() {
  const md = fs.readFileSync(path.join(process.cwd(), "content", "publishing.md"), "utf8").replace(/^# .*\n/, "");
  return (
    <>
      <PageHeader title="Publishing an extension" description="From the dashboard, from GitHub Actions without any secret, or from any CI with a scoped token. Every version is built by the directory and reviewed." compact />
      <div className="bw-w dx-sec">
        <div className="ext-prose dx-doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
      </div>
    </>
  );
}
