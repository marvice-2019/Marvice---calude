import type { Metadata } from "next";
import { PassesView } from "./PassesView";

export const metadata: Metadata = { title: "My passes", robots: { index: false } };

export default function PassesPage() {
  return <PassesView />;
}
