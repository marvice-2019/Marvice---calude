import Link from "next/link";
import { OneOffForm } from "@/components/LinkForms";
import { requireHost } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NewOneOffPage() {
  const user = await requireHost();
  return (
    <div>
      <Link href="/dashboard/links" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">Links</Link>
      <h1 className="font-display text-xl text-text">New one-off meeting</h1>
      <p className="mt-2 max-w-xl text-text-muted">
        Offer a few times for one person. They get a link, pick one, and the link stops working. Times you&apos;re booked or busy
        for by then are hidden from them.
      </p>
      <div className="mt-6"><OneOffForm timeZone={user.timezone} /></div>
    </div>
  );
}
