import type { Metadata } from "next";
import { MonthlyView } from "./MonthlyView";

export const metadata: Metadata = { title: "Monthly parking in Bengaluru", description: "One fixed monthly fee for unlimited entries at one lot. Prices shown with GST." };

export default function MonthlyPage() {
  return <MonthlyView />;
}
