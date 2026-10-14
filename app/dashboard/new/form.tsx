"use client";

import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/client/action";

export function NewExtensionForm() {
  const router = useRouter();
  return (
    <ActionForm
      path="/extensions"
      submit="Reserve and continue"
      resetOnDone={false}
      onDone={(data) => router.push(`/dashboard/extensions/${(data as { slug: string }).slug}`)}
      fields={[
        { name: "slug", label: "Id", placeholder: "jitsi-meet", help: "Lowercase letters, digits and dashes, as in manifest.json." },
        { name: "type", label: "Kind", type: "select", options: [{ value: "plugin", label: "Plugin" }, { value: "theme", label: "Theme" }] },
        { name: "repository", label: "Repository", placeholder: "https://github.com/owner/repo", help: "A public repository on github.com, gitlab.com or codeberg.org." },
        { name: "subpath", label: "Folder in the repository", optional: true, placeholder: "jitsi-meet", help: "For a repository with several extensions: the folder that holds manifest.json." },
        { name: "name", label: "Display name", optional: true },
        { name: "description", label: "One-line description", optional: true },
      ]}
    />
  );
}
