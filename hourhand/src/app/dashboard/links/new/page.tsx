import Link from "next/link";
import { requireUser } from "@/lib/auth/session";

export default async function NewLinkPage() {
  await requireUser();
  return (
    <div>
      <h1 className="font-display text-xl text-text">New one-off link</h1>
      <p className="mt-2 text-text-muted">Make a single-use link for one person, then send it to them.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Event types</Link></li>
      </ul>
    </div>
  );
}
