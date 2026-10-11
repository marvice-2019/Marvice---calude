"use client";

import { Button } from "./ui/Button";

/** Opens the browser's print dialog, which also saves as PDF. Hidden on the printout itself. */
export function PrintButton() {
  return <Button type="button" variant="secondary" className="print:hidden" onClick={() => window.print()}>Print or save PDF</Button>;
}
