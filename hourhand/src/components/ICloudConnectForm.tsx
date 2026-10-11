"use client";

import { useActionState } from "react";
import { connectICloudAction, type ICloudFormState } from "@/app/dashboard/calendars/actions";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";

const idle: ICloudFormState = { status: "idle" };

/** Apple has no sign-in button for calendars: the host gives an app-specific password, which works only for this. */
export function ICloudConnectForm() {
  const [state, action, pending] = useActionState(connectICloudAction, idle);
  return (
    <form action={action} className="grid max-w-md gap-3">
      <p className="text-sm text-text-muted">
        Make an app-specific password at{" "}
        <a href="https://account.apple.com/account/manage" className="font-semibold text-accent underline" rel="noopener noreferrer" target="_blank">account.apple.com</a>
        {" "}→ Sign-In and Security → App-Specific Passwords. It lets Hourhand reach your calendars only, and you can revoke it there any time.
      </p>
      <div><Label htmlFor="ic-id">Apple ID email</Label><Input id="ic-id" name="appleId" type="email" autoComplete="username" required /></div>
      <div>
        <Label htmlFor="ic-pw">App-specific password</Label>
        <Input id="ic-pw" name="password" type="password" autoComplete="off" required placeholder="xxxx-xxxx-xxxx-xxxx"
          error={state.status === "error" ? state.error : undefined} />
      </div>
      <div><Button type="submit" loading={pending}>Connect iCloud</Button></div>
    </form>
  );
}
