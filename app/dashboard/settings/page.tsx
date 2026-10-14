import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session";
import { myWebhooks } from "@/lib/dashboard";
import { timeAgo } from "@/lib/utils";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { DashboardNav } from "@/components/dashboard-nav";
import { ActionButton } from "@/components/client/action";
import { WebhookForm } from "./webhook-form";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) return <SignInPrompt title="Sign in to change notifications." text="The directory tells you when a version was built, approved or rejected." returnTo="/dashboard/settings" />;
  const hooks = myWebhooks(user.id);
  return (
    <div className="bw-w dx-work">
      <DashboardNav current="/dashboard/settings" />
      <div className="dx-work-head">
        <div>
          <h1 className="bw-h2">Notifications</h1>
          <p>When a version is waiting for review, approved, rejected, or fails its build or checks.</p>
        </div>
      </div>
      <section className="dx-sec-block">
        <h2 className="dx-h2">Email</h2>
        <p>
          {user.email ? <>Sent to <strong>{user.email}</strong>, your verified primary address on GitHub.</> : "GitHub has no verified primary address for your account, so no email is sent."}{" "}
          Email is {user.notifyEmail ? "on" : "off"}.
        </p>
        <ActionButton method="PATCH" path="/me" body={{ notifyEmail: !user.notifyEmail }} label={user.notifyEmail ? "Turn email off" : "Turn email on"} ghost />
      </section>
      <section className="dx-sec-block">
        <h2 className="dx-h2">Webhooks</h2>
        <p>
          A POST with the event as JSON. Check the <code className="bw-icode">X-Bulwark-Signature</code> header: it is
          <code className="bw-icode">sha256=</code> and the HMAC-SHA256 of the body with the secret shown when you add the hook.
        </p>
        {hooks.length ? (
          <ul className="dx-rows">
            {hooks.map((h) => (
              <li key={h.id}>
                <div style={{ minWidth: 0 }}>
                  <span className="dx-rows-name" style={{ overflowWrap: "anywhere" }}>{h.url}</span>
                  <div className="dx-rows-meta"><span>{h.events.length} events</span><span>{h.lastDeliveryAt ? `last delivery ${timeAgo(h.lastDeliveryAt)}: ${h.lastStatus}` : "nothing sent yet"}</span></div>
                </div>
                <div className="dx-rows-actions"><ActionButton method="DELETE" path={`/webhooks/${h.id}`} label="Remove" ghost small /></div>
              </li>
            ))}
          </ul>
        ) : null}
        <WebhookForm />
      </section>
    </div>
  );
}
