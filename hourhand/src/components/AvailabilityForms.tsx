"use client";

import { useActionState, useState } from "react";
import { blockDateRangeAction, saveDateOverrideAction, saveWeeklyHoursAction, type FormState } from "@/app/dashboard/availability/actions";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { focusRing } from "@/components/ui/focus";
import type { Interval } from "@/lib/data/types";

const INITIAL: FormState = { status: "idle", errors: {} };
const DEFAULT_RANGE: Interval = { from: "09:00", to: "17:00" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Inline result line: "Saved", or a pointer to the field errors. */
function Result({ state, saved }: { state: FormState; saved: string }) {
  return (
    <p role="status" className={`min-h-6 text-sm font-semibold ${state.status === "error" ? "text-danger" : "text-text"}`}>
      {state.status === "saved" && saved}
      {state.status === "error" && "Fix the highlighted fields and try again."}
    </p>
  );
}

/** One or more from/to rows. Inputs are named `${prefix}-${i}-from|to`, matching the server's error keys. */
function RangeRows({ prefix, label, ranges, onChange, errors }: {
  prefix: string; label: string; ranges: Interval[]; onChange: (next: Interval[]) => void; errors: Record<string, string>;
}) {
  const set = (i: number, field: keyof Interval, value: string) => onChange(ranges.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  return (
    <div className="space-y-3">
      {ranges.map((r, i) => (
        <div key={i} className="flex flex-wrap items-start gap-3">
          {(["from", "to"] as const).map((field) => {
            const id = `${prefix}-${i}-${field}`;
            return (
              <div key={field} className="w-32">
                <Label htmlFor={id}>
                  <span className="sr-only">{label}, range {i + 1}, </span>
                  {field === "from" ? "From" : "To"}
                </Label>
                <Input id={id} name={id} type="time" required value={r[field]} error={errors[id]} onChange={(e) => set(i, field, e.target.value)} />
              </div>
            );
          })}
          {ranges.length > 1 && (
            <Button variant="ghost" className="mt-6" onClick={() => onChange(ranges.filter((_, j) => j !== i))}>
              Remove<span className="sr-only"> {label} range {i + 1}</span>
            </Button>
          )}
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...ranges, nextRange(ranges)])}>
        Add a range<span className="sr-only"> for {label}</span>
      </Button>
    </div>
  );
}

/** A new range starting an hour after the last one ends, when that fits in the day. */
function nextRange(ranges: Interval[]): Interval {
  const last = ranges.at(-1);
  if (!last) return DEFAULT_RANGE;
  const h = Number(last.to.slice(0, 2));
  if (Number.isNaN(h) || h > 21) return DEFAULT_RANGE;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${pad(h + 1)}:${last.to.slice(3, 5)}`, to: `${pad(h + 2)}:${last.to.slice(3, 5)}` };
}

type Day = { on: boolean; ranges: Interval[] };

export function WeeklyHoursForm({ initial }: { initial: Record<number, Interval[]> }) {
  const [state, action, pending] = useActionState(saveWeeklyHoursAction, INITIAL);
  const [days, setDays] = useState<Day[]>(() =>
    DAYS.map((_, d) => (initial[d]?.length ? { on: true, ranges: initial[d] } : { on: false, ranges: [DEFAULT_RANGE] })),
  );
  const update = (d: number, next: Partial<Day>) => setDays((all) => all.map((day, i) => (i === d ? { ...day, ...next } : day)));
  const copyMonday = () => setDays((all) => all.map((day, i) => (i >= 2 && i <= 5 ? { on: all[1].on, ranges: all[1].ranges.map((r) => ({ ...r })) } : day)));

  return (
    <form action={action} noValidate className="space-y-4">
      <ul className="divide-y divide-border">
        {WEEK_ORDER.map((d) => {
          const name = DAYS[d];
          return (
            <li key={d} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
              <label className="inline-flex min-h-11 w-40 shrink-0 cursor-pointer items-center gap-3 font-semibold text-text">
                <input
                  type="checkbox"
                  role="switch"
                  name={`w${d}-on`}
                  checked={days[d].on}
                  onChange={(e) => update(d, { on: e.target.checked })}
                  className="peer sr-only"
                />
                <span aria-hidden className="relative h-6 w-11 rounded-pill bg-border-input transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-pill after:bg-card after:transition-transform peer-checked:after:translate-x-5" />
                {name}
              </label>
              {days[d].on ? (
                <RangeRows prefix={`w${d}`} label={name} ranges={days[d].ranges} onChange={(ranges) => update(d, { ranges })} errors={state.errors} />
              ) : (
                <p className="flex min-h-11 items-center text-text-muted">Unavailable</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>Save hours</Button>
        <Button variant="secondary" onClick={copyMonday}>Copy Monday to weekdays</Button>
        <Result state={state} saved="Saved" />
      </div>
    </form>
  );
}

export function DateOverrideForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(saveDateOverrideAction, INITIAL);
  const [kind, setKind] = useState<"hours" | "off">("off");
  const [ranges, setRanges] = useState<Interval[]>([DEFAULT_RANGE]);
  return (
    <form action={action} noValidate className="space-y-4">
      <div className="w-48">
        <Label htmlFor="ov-date">Date</Label>
        <Input id="ov-date" name="ov-date" type="date" min={today} required error={state.errors["ov-date"]} />
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-text">Hours that day</legend>
        <div className="mt-1 flex flex-wrap gap-x-6">
          {([["off", "Unavailable all day"], ["hours", "Custom hours"]] as const).map(([value, text]) => (
            <label key={value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-text">
              <input type="radio" name="ov-kind" value={value} checked={kind === value} onChange={() => setKind(value)} className={`size-5 accent-accent ${focusRing}`} />
              {text}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "hours" && <RangeRows prefix="ov" label="Override" ranges={ranges} onChange={setRanges} errors={state.errors} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>Add override</Button>
        <Result state={state} saved="Override saved" />
      </div>
    </form>
  );
}

export function BlockRangeForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(blockDateRangeAction, INITIAL);
  return (
    <form action={action} noValidate className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div className="w-48">
          <Label htmlFor="block-from">First day</Label>
          <Input id="block-from" name="block-from" type="date" min={today} required error={state.errors["block-from"]} />
        </div>
        <div className="w-48">
          <Label htmlFor="block-to">Last day</Label>
          <Input id="block-to" name="block-to" type="date" min={today} required error={state.errors["block-to"]} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>Block these days</Button>
        <Result state={state} saved="Days blocked" />
      </div>
    </form>
  );
}
