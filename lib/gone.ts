// v1 write routes from before the publishing API. Nothing outside this
// repository called them; they answer 410 with a pointer to v2.
export function gone(replacement: string): () => Response {
  return () =>
    Response.json(
      { error: `This endpoint was replaced by ${replacement}. See https://extensions.bulwarkmail.org/docs/publishing.` },
      { status: 410 }
    );
}
