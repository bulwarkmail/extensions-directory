// Server-side Umami event helper. Fire-and-forget — never throw.

const UMAMI_URL =
  process.env.UMAMI_INGEST_URL ?? "https://umami.bulwarkmail.org/api/send";
const WEBSITE_ID =
  process.env.UMAMI_WEBSITE_ID ?? process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "";
const HOSTNAME =
  process.env.UMAMI_HOSTNAME ?? "extensions.bulwarkmail.org";

type EventData = Record<string, string | number | boolean | null>;

export function trackServerEvent(
  name: string,
  url: string,
  data?: EventData,
  req?: Request,
): void {
  if (!WEBSITE_ID) return;

  const userAgent =
    req?.headers.get("user-agent") ??
    "bulwark-server/1.0 (+server-side-event)";
  const referrer = req?.headers.get("referer") ?? "";

  const body = JSON.stringify({
    type: "event",
    payload: {
      website: WEBSITE_ID,
      hostname: HOSTNAME,
      url,
      name,
      data,
      referrer,
    },
  });

  // Fire and forget — Umami doesn't strictly need a response, and we don't
  // want analytics latency on the user's request path.
  fetch(UMAMI_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent,
    },
    body,
    // Cap at 2s; if Umami is slow we don't care.
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    // Swallow — analytics must never break the request.
  });
}
