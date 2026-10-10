import type { HTMLAttributes } from "react";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["rounded-lg border border-border bg-card p-5 shadow-card", className].filter(Boolean).join(" ")} {...rest} />;
}
