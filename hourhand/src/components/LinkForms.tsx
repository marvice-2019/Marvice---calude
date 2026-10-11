"use client";

import { useActionState, useState } from "react";
import { createOneOff, createSingleUseLink, type LinkFormState } from "@/app/dashboard/links/actions";
import { CopyLinkButton } from "./CopyLinkButton";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { focusRing } from "./ui/focus";

const idle: LinkFormState = { status: "idle" };
const selectClasses = `mt-1 block h-11 w-full rounded-md border border-border-input bg-card px-3 text-base text-text ${focusRing}`;

/** The new link, shown once: it isn't stored anywhere it could be read back. */
function CreatedLink({ path }: { path: string }) {
  return (
    <div className="grid gap-2 rounded-md bg-success-bg p-4" role="status">
      <p className="font-semibold text-text">Your link is ready. Copy it now: for privacy, Hourhand doesn&apos;t show it again.</p>
      <code className="break-all rounded bg-card px-2 py-1 text-sm text-text">{path}</code>
      <div><CopyLinkButton path={path} /></div>
    </div>
  );
}

export function SingleUseLinkForm({ eventTypes }: { eventTypes: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createSingleUseLink, idle);
  if (eventTypes.length === 0) return <p className="text-text-muted">Turn on an event type first; a single-use link books one of them.</p>;
  return (
    <form action={action} className="grid max-w-md gap-4">
      <div>
        <Label htmlFor="link-event">Event type</Label>
        <select id="link-event" name="eventTypeId" className={selectClasses} defaultValue={eventTypes[0].id}>
          {eventTypes.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="link-label">Note for yourself (optional)</Label>
        <Input id="link-label" name="label" maxLength={100} placeholder="For Ravi, follow-up" />
      </div>
      {state.status === "error" && <p className="text-danger" role="alert">{state.message}</p>}
      {state.status === "created" && <CreatedLink path={state.path} />}
      <div><Button type="submit" loading={pending}>Make a single-use link</Button></div>
    </form>
  );
}

const LOCATIONS: { kind: string; label: string; needs?: string }[] = [
  { kind: "google_meet", label: "Google Meet" },
  { kind: "teams", label: "Microsoft Teams" },
  { kind: "zoom", label: "Zoom" },
  { kind: "phone_host_calls", label: "Phone call (you call them)" },
  { kind: "phone_guest_calls", label: "Phone call (they call you)", needs: "Your phone number" },
  { kind: "in_person", label: "In person", needs: "Address" },
  { kind: "custom", label: "Somewhere else", needs: "Location details" },
];

export function OneOffForm({ timeZone }: { timeZone: string }) {
  const [state, action, pending] = useActionState(createOneOff, idle);
  const [rows, setRows] = useState<number[]>([0, 1, 2]);
  const [next, setNext] = useState(3);
  const [kind, setKind] = useState("google_meet");
  const needs = LOCATIONS.find((l) => l.kind === kind)?.needs;
  return (
    <form action={action} className="grid max-w-md gap-4">
      <div><Label htmlFor="oo-name">What&apos;s it for</Label><Input id="oo-name" name="name" required maxLength={100} placeholder="Contract review with Ravi" /></div>
      <div><Label htmlFor="oo-duration">Length (minutes)</Label><Input id="oo-duration" name="durationMinutes" inputMode="numeric" defaultValue="30" className="max-w-32" /></div>
      <div>
        <Label htmlFor="oo-location">Where you meet</Label>
        <select id="oo-location" name="locationKind" className={selectClasses} value={kind} onChange={(e) => setKind(e.target.value)}>
          {LOCATIONS.map((l) => <option key={l.kind} value={l.kind}>{l.label}</option>)}
        </select>
        {kind === "teams" && <p className="mt-1 text-sm text-text-muted">Teams links are created when bookings go to a work or school Outlook calendar.</p>}
      </div>
      {needs && <div><Label htmlFor="oo-location-value">{needs}</Label><Input id="oo-location-value" name="locationValue" /></div>}
      <div><Label htmlFor="oo-description">Note for your guest (optional)</Label><Input id="oo-description" name="description" maxLength={2000} /></div>
      <fieldset className="grid gap-2">
        <legend className="font-semibold text-text">Times to offer</legend>
        <p className="text-sm text-text-muted">In your time zone ({timeZone}). Your guest picks one; times you&apos;ve since become busy for are hidden.</p>
        {rows.map((row, i) => (
          <div key={row} className="flex items-center gap-2">
            <Input id={`oo-time-${row}`} aria-label={`Time ${i + 1}`} type="datetime-local" name="times" className="max-w-64" />
            {rows.length > 1 && (
              <Button variant="ghost" size="sm" aria-label={`Remove time ${i + 1}`} onClick={() => setRows(rows.filter((r) => r !== row))}>Remove</Button>
            )}
          </div>
        ))}
        {rows.length < 20 && (
          <div><Button variant="secondary" size="sm" onClick={() => { setRows([...rows, next]); setNext(next + 1); }}>Add another time</Button></div>
        )}
      </fieldset>
      {state.status === "error" && <p className="text-danger" role="alert">{state.message}</p>}
      {state.status === "created" && <CreatedLink path={state.path} />}
      <div><Button type="submit" loading={pending}>Make the one-off link</Button></div>
    </form>
  );
}
