import type { InputHTMLAttributes, LabelHTMLAttributes } from "react";
import { focusRing } from "./focus";

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={["block text-sm font-semibold text-text", className].filter(Boolean).join(" ")} {...rest} />;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  /** When set, the field is marked invalid and the message is linked with aria-describedby. */
  error?: string;
}

export function Input({ id, error, className, "aria-describedby": describedBy, ...rest }: InputProps) {
  const errorId = `${id}-error`;
  const describedByIds = [describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds}
        className={[
          "mt-1 block h-11 w-full rounded-md border bg-card px-3 text-base text-text placeholder:text-text-muted",
          error ? "border-danger" : "border-border-input",
          focusRing,
          className,
        ].filter(Boolean).join(" ")}
        {...rest}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
