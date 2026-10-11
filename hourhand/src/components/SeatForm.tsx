"use client";

import { useActionState } from "react";
import { inviteSeatAction, removeSeatAction, type SeatFormState } from "@/app/dashboard/seat/actions";
import type { Seat } from "@/lib/seats";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";

const idle: SeatFormState = { status: "idle" };

export function SeatForm({ seat }: { seat: Seat | null }) {
  const [state, action, pending] = useActionState(inviteSeatAction, idle);
  return (
    <div className="grid gap-4">
      {seat && (
        <form action={removeSeatAction} className="flex flex-wrap items-center gap-3">
          <p className="text-text">
            {seat.accepted ? <><span className="font-semibold">{seat.memberName ?? seat.email}</span> ({seat.email}) is your second person.</>
              : <>Invitation sent to <span className="font-semibold">{seat.email}</span>. It works once they sign in with that email.</>}
          </p>
          <Button type="submit" variant="secondary" size="sm">Remove</Button>
        </form>
      )}
      <form action={action} className="grid max-w-md gap-2">
        <Label htmlFor="seat-email">{seat ? "Invite someone else instead" : "Their email"}</Label>
        <Input id="seat-email" name="email" type="email" autoComplete="off" required error={state.status === "error" ? state.error : undefined} />
        {state.status === "invited" && <p role="status" className="text-sm text-success">Invitation sent.</p>}
        <div><Button type="submit" loading={pending}>Send invitation</Button></div>
      </form>
    </div>
  );
}
