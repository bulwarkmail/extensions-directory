"use client";

import { useState } from "react";
import { ActionForm } from "@/components/client/action";

export function WebhookForm() {
  const [secret, setSecret] = useState<string | null>(null);
  if (secret) {
    return (
      <div className="bw-note">
        <p><strong>Copy the signing secret now.</strong> It is not shown again.</p>
        <pre className="bw-code"><code>{secret}</code></pre>
        <button type="button" className="bw-btn bw-btn-ghost" onClick={() => setSecret(null)}>Done</button>
      </div>
    );
  }
  return (
    <ActionForm
      path="/webhooks"
      submit="Add webhook"
      onDone={(d) => setSecret((d as { secret: string }).secret)}
      fields={[{ name: "url", label: "URL", placeholder: "https://ci.example.org/hooks/bulwark", help: "https on a public host name." }]}
    />
  );
}
