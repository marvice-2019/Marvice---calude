"use client";

import { useActionState } from "react";
import { changePasswordAction, type FormState } from "../actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  const err = (k: string) =>
    state.errors?.[k] ? (
      <span className="admin-error" id={`${k}-err`}>
        {state.errors[k]}
      </span>
    ) : null;
  return (
    <form action={action} className="admin-form" noValidate>
      <label>
        Current password
        <input name="current" type="password" autoComplete="current-password" required aria-describedby="current-err" />
        {err("current")}
      </label>
      <label>
        New password (12+ characters)
        <input name="next" type="password" autoComplete="new-password" minLength={12} required aria-describedby="next-err" />
        {err("next")}
      </label>
      <label>
        New password again
        <input name="confirm" type="password" autoComplete="new-password" required aria-describedby="confirm-err" />
        {err("confirm")}
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
