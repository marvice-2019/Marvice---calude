"use client";

import { useActionState } from "react";
import { createPackageAction, type PackageFormState } from "@/app/dashboard/packages/actions";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { focusRing } from "./ui/focus";

const idle: PackageFormState = { status: "idle" };

export function PackageForm({ eventTypes }: { eventTypes: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createPackageAction, idle);
  const errors = state.status === "error" ? state.errors : {};
  if (eventTypes.length === 0) return <p className="text-text-muted">Turn on an event type first; a package sells sessions of one of them.</p>;
  return (
    <form action={action} className="grid max-w-md gap-4">
      <div>
        <Label htmlFor="pk-event">Sessions of</Label>
        <select id="pk-event" name="eventTypeId" defaultValue={eventTypes[0].id} className={`mt-1 block h-11 w-full rounded-md border border-border-input bg-card px-3 text-base text-text ${focusRing}`}>
          {eventTypes.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
        </select>
        {errors.eventTypeId && <p className="mt-1 text-sm text-danger">{errors.eventTypeId}</p>}
      </div>
      <div><Label htmlFor="pk-name">Name</Label><Input id="pk-name" name="name" maxLength={100} placeholder="5 coaching sessions" error={errors.name} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label htmlFor="pk-sessions">Sessions</Label><Input id="pk-sessions" name="sessions" inputMode="numeric" defaultValue="5" error={errors.sessions} /></div>
        <div><Label htmlFor="pk-price">Price (₹)</Label><Input id="pk-price" name="price" inputMode="decimal" placeholder="4999" error={errors.price} /></div>
      </div>
      <div>
        <Label htmlFor="pk-days">Book within (days of paying)</Label>
        <Input id="pk-days" name="validDays" inputMode="numeric" defaultValue="90" className="max-w-32" error={errors.validDays} />
      </div>
      {errors.form && <p className="text-danger" role="alert">{errors.form}</p>}
      {state.status === "created" && <p className="text-success" role="status">Package created. Share its link, or guests find it on the event&apos;s booking page.</p>}
      <div><Button type="submit" loading={pending}>Create package</Button></div>
    </form>
  );
}
