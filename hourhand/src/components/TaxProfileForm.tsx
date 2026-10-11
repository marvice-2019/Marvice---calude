"use client";

import { useActionState } from "react";
import { saveTaxProfileAction, type TaxFormState } from "@/app/dashboard/invoices/actions";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { focusRing } from "./ui/focus";

const idle: TaxFormState = { status: "idle" };

export function TaxProfileForm({ saved }: { saved: { legalName: string; address: string; gstin: string; sac: string; rateBp: number; invoicePrefix: string } | null }) {
  const [state, action, pending] = useActionState(saveTaxProfileAction, idle);
  const errors = state.status === "error" ? state.errors : {};
  return (
    <form action={action} className="grid max-w-md gap-4">
      <div><Label htmlFor="tx-name">Legal name</Label><Input id="tx-name" name="legalName" defaultValue={saved?.legalName} maxLength={200} error={errors.legalName} /></div>
      <div>
        <Label htmlFor="tx-address">Registered address</Label>
        <textarea id="tx-address" name="address" rows={3} maxLength={500} defaultValue={saved?.address}
          className={`mt-1 block w-full rounded-md border bg-card p-3 text-base text-text ${errors.address ? "border-danger" : "border-border-input"} ${focusRing}`} />
        {errors.address && <p className="mt-1 text-sm text-danger">{errors.address}</p>}
      </div>
      <div><Label htmlFor="tx-gstin">GSTIN</Label><Input id="tx-gstin" name="gstin" defaultValue={saved?.gstin} maxLength={15} autoCapitalize="characters" placeholder="29ABCDE1234F1Z5" error={errors.gstin} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label htmlFor="tx-sac">SAC code</Label><Input id="tx-sac" name="sac" inputMode="numeric" defaultValue={saved?.sac ?? "999293"} error={errors.sac} /></div>
        <div>
          <Label htmlFor="tx-rate">GST rate</Label>
          <select id="tx-rate" name="rate" defaultValue={String((saved?.rateBp ?? 1800) / 100)} className={`mt-1 block h-11 w-full rounded-md border border-border-input bg-card px-3 text-base text-text ${focusRing}`}>
            {[5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
          </select>
          {errors.rate && <p className="mt-1 text-sm text-danger">{errors.rate}</p>}
        </div>
      </div>
      <div>
        <Label htmlFor="tx-prefix">Invoice prefix</Label>
        <Input id="tx-prefix" name="invoicePrefix" defaultValue={saved?.invoicePrefix ?? "HH"} maxLength={4} className="max-w-32" autoCapitalize="characters" error={errors.invoicePrefix} />
        <p className="mt-1 text-sm text-text-muted">Invoices are numbered like HH/2627/000001: prefix, financial year, serial. Credit notes run in their own series.</p>
      </div>
      {errors.form && <p className="text-danger" role="alert">{errors.form}</p>}
      {state.status === "saved" && <p className="text-success" role="status">Saved. Every payment from now on gets a GST invoice.</p>}
      {state.status === "removed" && <p className="text-text" role="status">GST details removed. No new invoices; the ones already issued stay.</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>Save GST details</Button>
        {saved && <Button type="submit" name="remove" value="1" variant="ghost">Stop issuing invoices</Button>}
      </div>
    </form>
  );
}
