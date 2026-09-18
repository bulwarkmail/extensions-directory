import { notFound } from "next/navigation";
import { getExtensions, getAuthorByLogin } from "@/lib/db/queries";
import { ExtensionGrid } from "@/components/extension-grid";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ login: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  let author;
  try {
    author = await getAuthorByLogin(login);
  } catch {
    return { title: "Author — BulwarkMail Extensions" };
  }

  if (!author) return { title: "Author Not Found" };

  return {
    title: `${author.displayName} — BulwarkMail Extensions`,
    description: `Extensions by ${author.displayName}`,
  };
}

export default async function AuthorPage({ params }: Props) {
  const { login } = await params;

  let author;
  try {
    author = await getAuthorByLogin(login);
  } catch {
    notFound();
  }

  if (!author || author.banned) {
    notFound();
  }

  let extensions: Awaited<ReturnType<typeof getExtensions>>["data"] = [];
  try {
    const result = await getExtensions({ authorLogin: author.githubLogin, perPage: 100 });
    extensions = result.data;
  } catch {
    // DB not available
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Author header */}
      <div className="flex items-start gap-4">
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl}
            alt={author.displayName}
            className="h-16 w-16 rounded-full"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-bold text-muted-foreground">
            {author.displayName?.charAt(0).toUpperCase() ?? "?"}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {author.displayName}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <a
              href={`https://github.com/${author.githubLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              @{author.githubLogin}
            </a>
            {author.verified && (
              <span className="text-info" title="Verified">
                ✓ Verified
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {extensions.length} extension{extensions.length !== 1 ? "s" : ""}{" "}
            published
          </p>
        </div>
      </div>

      {/* Extensions */}
      <div className="mt-8">
        <ExtensionGrid
          extensions={extensions}
          emptyTitle="No extensions yet"
          emptyMessage="This author hasn't published any extensions."
        />
      </div>
    </div>
  );
}
