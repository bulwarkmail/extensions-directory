"use client";

import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/client/action";

export function SubmitVersionForm({ slug }: { slug: string }) {
  const router = useRouter();
  return (
    <ActionForm
      path={`/extensions/${slug}/submissions`}
      submit="Submit"
      onDone={(data) => router.push(`/dashboard/submissions/${(data as { id: string }).id}`)}
      fields={[
        { name: "ref", label: "Tag, branch or commit", placeholder: "v1.2.0", help: "A tag is best: its GitHub release notes become the changelog." },
        { name: "dryRun", label: "Dry run: build and check only", type: "checkbox" },
      ]}
    />
  );
}
