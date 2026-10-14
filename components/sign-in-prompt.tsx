import Link from "next/link";
import { Github } from "lucide-react";
import { ICON } from "@/components/icon";

/** Shown on working pages when nobody (or the wrong account) is signed in. */
export function SignInPrompt({ title, text, returnTo }: { title: string; text: string; returnTo: string }) {
  return (
    <div className="bw-w">
      <div className="dx-msg">
        <h1 className="bw-h2">{title}</h1>
        <p>{text}</p>
        <div className="bw-btns">
          <a href={`/api/v1/auth/github?returnTo=${encodeURIComponent(returnTo)}`} className="bw-btn">
            <Github size={16} {...ICON} />
            Sign in with GitHub
          </a>
          <Link href="/" className="bw-btn bw-btn-ghost">Back to the directory</Link>
        </div>
      </div>
    </div>
  );
}
