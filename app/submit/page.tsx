import { redirect } from "next/navigation";

// Submitting moved into the dashboard (and to CI, see /publishing).
export default function SubmitPage() {
  redirect("/dashboard/new");
}
