import type { Metadata } from "next";
import { getMenuForAdmin } from "@/admin/content";
import { requireUser } from "@/auth/guard";
import { DeleteButton } from "@/components/admin/forms";
import { CategoryForm, ItemForm, ItemRow } from "@/components/admin/content-forms";
import { getDb } from "@/db";

export const metadata: Metadata = { title: "Menu" };
export const dynamic = "force-dynamic";

/** §8 Menu: sections and dishes. Only real dishes and prices: the site never invents any. */
export default async function MenuAdminPage() {
  await requireUser("content:write");
  const menu = await getMenuForAdmin(getDb());
  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Menu</h1>
      <p className="text-muted">Leave the price blank if it varies. Sold-out dishes disappear from the site until you switch them back.</p>
      <div className="mt-5">
        <CategoryForm />
      </div>
      {menu.length === 0 && <p className="mt-6 text-muted">No sections yet. The site shows the cuisines and “full menu coming soon” until you add dishes.</p>}
      {menu.map((c) => (
        <section key={c.id} className="mt-6 rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{c.name}</h2>
            <DeleteButton url={`/api/admin/content/menu?kind=category&id=${c.id}`} label="Delete section" confirmText={`Delete ${c.name} and all its dishes?`} okText="Section deleted." />
          </div>
          <ul className="mt-2">
            {c.items.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </ul>
          <div className="mt-3">
            <ItemForm categoryId={c.id} />
          </div>
        </section>
      ))}
    </>
  );
}
