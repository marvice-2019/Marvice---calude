"use client";

import { useActionState } from "react";
import { requestMagicLink, type SignInState } from "@/app/sign-in/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

const initial: SignInState = { status: "idle" };

export function SignInForm() {
  const [state, action, pending] = useActionState(requestMagicLink, initial);

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-md bg-surface p-4">
        <p className="font-semibold text-text">Check your email</p>
        <p className="mt-1 text-text-muted">
          We sent a sign-in link to {state.email}. It works once and expires in 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="grid gap-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          error={state.status === "error" ? state.error : undefined}
        />
      </div>
      <Button type="submit" loading={pending}>
        Email me a sign-in link
      </Button>
    </form>
  );
}
