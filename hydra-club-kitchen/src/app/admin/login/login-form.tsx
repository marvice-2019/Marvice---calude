"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="admin-form" noValidate>
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required defaultValue={state.email} key={state.email} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <p className="admin-error" role="alert" aria-live="polite">
        {state.error}
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
