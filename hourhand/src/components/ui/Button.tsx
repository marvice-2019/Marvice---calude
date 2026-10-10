import type { ButtonHTMLAttributes } from "react";
import { focusRing } from "./focus";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:opacity-90",
  secondary: "border border-border-input bg-card text-text hover:bg-surface",
  ghost: "text-text hover:bg-surface",
  danger: "bg-danger text-on-accent hover:opacity-90",
};

// sm is 36px tall; the ::before layer stretches its hit area to the 44px minimum.
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
  md: "h-11 px-4 text-sm",
  lg: "h-13 px-5 text-base",
};

/** Button styling for elements that are not <button>, such as a Next <Link>. */
export function buttonClasses({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return [
    "relative inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-(--hh-motion-fast)",
    "disabled:cursor-not-allowed disabled:opacity-60",
    focusRing,
    variants[variant],
    sizes[size],
  ].join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the label, sets aria-busy and blocks further clicks. */
  loading?: boolean;
}

export function Button({ variant, size, loading = false, disabled, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[buttonClasses({ variant, size }), className].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading && (
        <span aria-hidden className="size-4 animate-spin rounded-pill border-2 border-current border-t-transparent motion-reduce:animate-none" />
      )}
      {children}
    </button>
  );
}
