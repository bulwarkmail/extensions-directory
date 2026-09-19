import { notFound } from "next/navigation";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { getExtensions, getAuthorByLogin } from "@/lib/db/queries";
import { ExtensionGrid } from "@/components/extension-grid";
import { ICON } from "@/components/icon";
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

  const count = extensions.length;

  return (
    <>
      {/* The initial stands in for a picture, so the page makes no request to
          GitHub from the browser. */}
      <section className="bw-field">
        <div className="bw-w dx-hero dx-hero-sm">
          <div className="dx-dhero-title">
            <span className="dx-initial dx-initial-lg" aria-hidden="true">
              {author.displayName?.charAt(0).toUpperCase() ?? "?"}
            </span>
            <h1 className="bw-h1">{author.displayName}</h1>
          </div>
          <p className="dx-byline">
            <a href={`https://github.com/${author.githubLogin}`} target="_blank" rel="noopener noreferrer">
              @{author.githubLogin} on GitHub
            </a>
            <ArrowUpRight size={16} {...ICON} />
            {author.verified ? (
              <>
                <span aria-hidden="true">·</span>
                <BadgeCheck size={16} {...ICON} />
                verified author
              </>
            ) : null}
          </p>
          <p className="bw-lead">
            {count === 0
              ? "No published extensions yet."
              : `${count} published ${count === 1 ? "extension" : "extensions"} in the directory.`}
          </p>
        </div>
      </section>

      <div className="bw-w dx-sec">
        <ExtensionGrid
          extensions={extensions}
          emptyTitle="Nothing published yet."
          emptyMessage="Extensions by this author appear here once a reviewer approves them."
        />
      </div>
    </>
  );
}
