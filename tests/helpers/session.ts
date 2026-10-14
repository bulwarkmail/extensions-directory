// Sign a test in or out through the real session code and the mocked jar.
import { getSession } from "@/lib/auth/session";
import { loadAuthor } from "@/lib/auth/guard";

export async function signIn(authorId: string): Promise<void> {
  const author = await loadAuthor(authorId);
  const session = await getSession();
  session.authorId = authorId;
  session.epoch = author?.sessionEpoch ?? 0;
  await session.save();
}

export function signOut(): void {
  (globalThis as { __cookieJar?: Map<string, string> }).__cookieJar?.clear();
}
