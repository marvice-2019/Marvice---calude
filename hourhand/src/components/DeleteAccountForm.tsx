"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { deleteMyAccount, type DeleteAccountState } from "@/lib/auth/actions";

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(deleteMyAccount, {});
  return (
    <form action={action} className="mt-4 grid gap-4">
      <div>
        <Label htmlFor="confirm-email">Type {email} to confirm</Label>
        <Input id="confirm-email" name="confirm-email" type="email" autoComplete="off" required error={state.error} />
      </div>
      <Button type="submit" variant="danger" loading={pending} className="justify-self-start">
        Delete my account
      </Button>
    </form>
  );
}
