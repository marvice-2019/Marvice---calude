"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { deleteEventType, saveEventType } from "@/app/dashboard/event-types/actions";
import type { CustomQuestion, LocationKind, QuestionDraft } from "@/lib/data/types";
import { LOCATION_VALUE_LABEL, START_INCREMENTS, slugify, type EventTypeErrors, type EventTypeForm, type QuestionErrors } from "@/lib/event-types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { focusRing } from "./ui/focus";
import { Input, Label } from "./ui/Input";

const TABS = [
  { id: "details", label: "Details" },
  { id: "rules", label: "Scheduling rules" },
  { id: "form", label: "Booking form" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const DETAIL_FIELDS: (keyof EventTypeForm)[] = ["name", "slug", "durationMinutes", "description", "locationKind", "locationValue"];
const PRESET_DURATIONS = [15, 30, 45, 60];

const LOCATIONS: { kind: LocationKind | ""; label: string }[] = [
  { kind: "google_meet", label: "Google Meet" },
  { kind: "zoom", label: "Zoom" },
  { kind: "teams", label: "Microsoft Teams" },
  { kind: "phone_host_calls", label: "Phone call (you call them)" },
  { kind: "phone_guest_calls", label: "Phone call (they call you)" },
  { kind: "in_person", label: "In person" },
  { kind: "custom", label: "Somewhere else" },
  { kind: "ask_guest", label: "Guest picks the place" },
  { kind: "", label: "Decide later" },
];

const QUESTION_KINDS: { kind: CustomQuestion["kind"]; label: string }[] = [
  { kind: "short_text", label: "Short answer" },
  { kind: "long_text", label: "Long answer" },
  { kind: "single_select", label: "Pick one from a list" },
];

const fieldClasses = (invalid: boolean) =>
  `mt-1 block w-full rounded-md border bg-card px-3 text-base text-text ${invalid ? "border-danger" : "border-border-input"} ${focusRing}`;

type EditableQuestion = QuestionDraft & { key: string };

export interface EventTypeEditorProps {
  id: string | null;
  userSlug: string;
  initial: EventTypeForm;
  initialQuestions: QuestionDraft[];
  /** Shows "Saved" on arrival, after creating a new event type. */
  justSaved?: boolean;
}

export function EventTypeEditor({ id, userSlug, initial, initialQuestions, justSaved = false }: EventTypeEditorProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("details");
  const [form, setForm] = useState(initial);
  const [customDuration, setCustomDuration] = useState(!PRESET_DURATIONS.includes(Number(initial.durationMinutes)));
  const [questions, setQuestions] = useState<EditableQuestion[]>(() => initialQuestions.map((q, i) => ({ ...q, key: q.id ?? `new-${i}` })));
  const [errors, setErrors] = useState<EventTypeErrors>({});
  const [questionErrors, setQuestionErrors] = useState<QuestionErrors>([]);
  const [status, setStatus] = useState<"idle" | "saved" | "invalid">(justSaved ? "saved" : "idle");
  const [saving, startSaving] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const set = (key: keyof EventTypeForm) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus("idle");
  };
  const previewSlug = form.slug.trim().toLowerCase() || slugify(form.name) || "your-link";

  const tabHasErrors = (t: TabId) =>
    t === "form"
      ? questionErrors.some((e) => e.label || e.choices)
      : Object.keys(errors).some((k) => DETAIL_FIELDS.includes(k as keyof EventTypeForm) === (t === "details"));

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  function updateQuestion(index: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    setStatus("idle");
  }
  function moveQuestion(index: number, by: -1 | 1) {
    setQuestions((qs) => {
      const next = [...qs];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
    setQuestionErrors([]);
    setStatus("idle");
  }
  function removeQuestion(index: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== index));
    setQuestionErrors((es) => es.filter((_, i) => i !== index));
    setStatus("idle");
  }
  function addQuestion() {
    setQuestions((qs) => [...qs, { key: crypto.randomUUID(), id: null, label: "", kind: "short_text", required: false, choices: [] }]);
    setStatus("idle");
  }

  function save() {
    startSaving(async () => {
      const result = await saveEventType(id, form, questions.map(({ id: qid, label, kind, required, choices }) => ({ id: qid, label, kind, required, choices })));
      if (!result.ok) {
        setErrors(result.errors);
        setQuestionErrors(result.questionErrors);
        setStatus("invalid");
        const keys = Object.keys(result.errors) as (keyof EventTypeForm)[];
        if (keys.some((k) => DETAIL_FIELDS.includes(k))) setTab("details");
        else if (keys.length > 0) setTab("rules");
        else setTab("form");
        return;
      }
      setErrors({});
      setQuestionErrors([]);
      if (!id) {
        router.replace(`/dashboard/event-types/${result.id}?saved=1`);
        return;
      }
      setForm((f) => ({ ...f, slug: result.slug }));
      setStatus("saved");
      router.refresh();
    });
  }

  function remove() {
    if (!id) return;
    startDeleting(async () => {
      const result = await deleteEventType(id);
      if (result.ok) router.push("/dashboard/event-types");
      else setDeleteError(result.error);
    });
  }

  const numberField = (key: keyof EventTypeForm, label: string, unit: string, hint?: string) => (
    <div>
      <Label htmlFor={`f-${key}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`f-${key}`} inputMode="numeric" value={form[key]} onChange={(e) => set(key)(e.target.value)} error={errors[key]}
          aria-describedby={hint ? `f-${key}-hint` : undefined} className="max-w-32"
        />
        <span className="mt-1 text-sm text-text-muted">{unit}</span>
      </div>
      {hint && <p id={`f-${key}-hint`} className="mt-1 text-sm text-text-muted">{hint}</p>}
    </div>
  );

  const valueLabel = form.locationKind ? LOCATION_VALUE_LABEL[form.locationKind] : undefined;

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Event type settings" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} type="button" role="tab" id={`tab-${t.id}`}
            aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)} onKeyDown={onTabKey}
            className={`min-h-11 shrink-0 rounded-t-md px-3 text-sm ${focusRing} ${tab === t.id ? "border-b-2 border-accent font-semibold text-text" : "text-text-muted hover:text-text"}`}
          >
            {t.label}
            {tabHasErrors(t.id) && <span className="ml-1 text-danger">(check)</span>}
          </button>
        ))}
      </div>

      <Panel id="details" active={tab}>
        <div>
          <Label htmlFor="f-name">Name</Label>
          <Input id="f-name" value={form.name} onChange={(e) => set("name")(e.target.value)} error={errors.name} placeholder="30-min intro call" />
        </div>
        <div>
          <Label htmlFor="f-slug">Link</Label>
          <Input
            id="f-slug" value={form.slug} onChange={(e) => set("slug")(e.target.value)} error={errors.slug}
            aria-describedby="f-slug-hint" autoCapitalize="none" spellCheck={false} placeholder={slugify(form.name) || "intro-call"}
          />
          <p id="f-slug-hint" className="mt-1 break-all text-sm text-text-muted">
            People book at <span className="font-mono text-text">hourhand.app/{userSlug}/{previewSlug}</span>. Leave it blank to use the name.
          </p>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-text">Length</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_DURATIONS.map((m) => (
              <Choice key={m} name="duration" checked={!customDuration && form.durationMinutes === String(m)}
                onChange={() => { setCustomDuration(false); set("durationMinutes")(String(m)); }}>{m} min</Choice>
            ))}
            <Choice name="duration" checked={customDuration} onChange={() => setCustomDuration(true)}>Custom</Choice>
          </div>
          {customDuration ? (
            <div className="mt-3">{numberField("durationMinutes", "Custom length", "minutes", "Between 5 minutes and 12 hours.")}</div>
          ) : errors.durationMinutes && <p className="mt-1 text-sm text-danger">{errors.durationMinutes}</p>}
        </fieldset>
        <div>
          <Label htmlFor="f-location">Where you meet</Label>
          <select id="f-location" value={form.locationKind} onChange={(e) => set("locationKind")(e.target.value)} className={`h-11 ${fieldClasses(false)}`}>
            {LOCATIONS.map((l) => <option key={l.kind} value={l.kind}>{l.label}</option>)}
          </select>
        </div>
        {valueLabel && (
          <div>
            <Label htmlFor="f-locationValue">{valueLabel}</Label>
            <Input id="f-locationValue" value={form.locationValue} onChange={(e) => set("locationValue")(e.target.value)} error={errors.locationValue} />
          </div>
        )}
        <div>
          <Label htmlFor="f-description">Description</Label>
          <textarea
            id="f-description" rows={4} value={form.description} onChange={(e) => set("description")(e.target.value)}
            aria-describedby="f-description-hint" className={`py-2 ${fieldClasses(false)}`}
          />
          <p id="f-description-hint" className="mt-1 text-sm text-text-muted">Shown on your booking page. Optional.</p>
        </div>
      </Panel>

      <Panel id="rules" active={tab}>
        {numberField("minNoticeMinutes", "Minimum notice", "minutes", "How soon before the start people can still book. 240 minutes is 4 hours.")}
        {numberField("bookingWindowDays", "Booking window", "days", "How far ahead people can book, up to 730 days.")}
        <div>
          <Label htmlFor="f-startIncrementMinutes">Start times every</Label>
          <select
            id="f-startIncrementMinutes" value={form.startIncrementMinutes} onChange={(e) => set("startIncrementMinutes")(e.target.value)}
            aria-invalid={errors.startIncrementMinutes ? true : undefined}
            aria-describedby={errors.startIncrementMinutes ? "f-startIncrementMinutes-error" : undefined}
            className={`h-11 max-w-48 ${fieldClasses(Boolean(errors.startIncrementMinutes))}`}
          >
            {START_INCREMENTS.map((m) => <option key={m} value={String(m)}>{m} minutes</option>)}
          </select>
          {errors.startIncrementMinutes && <p id="f-startIncrementMinutes-error" className="mt-1 text-sm text-danger">{errors.startIncrementMinutes}</p>}
        </div>
        {numberField("bufferBeforeMinutes", "Free time before", "minutes", "Kept clear before each meeting, up to 240 minutes.")}
        {numberField("bufferAfterMinutes", "Free time after", "minutes", "Kept clear after each meeting, up to 240 minutes.")}
        {numberField("dailyLimit", "Most bookings per day", "bookings", "Leave blank for no limit.")}
        {numberField("cancelCutoffMinutes", "Online cancelling closes", "minutes before", "Guests can't cancel or reschedule online after this. 0 means any time before the start.")}
      </Panel>

      <Panel id="form" active={tab}>
        <p className="text-sm text-text-muted">Everyone gives their name and email. Add anything else you want to know before you meet.</p>
        {questions.length === 0 && <p className="text-text-muted">No extra questions yet.</p>}
        <ol className="grid gap-4">
          {questions.map((q, i) => {
            const e = questionErrors[i] ?? {};
            const name = q.label.trim() || `Question ${i + 1}`;
            return (
              <li key={q.key}>
                <Card className="grid gap-3">
                  <div>
                    <Label htmlFor={`q-${q.key}-label`}>Question {i + 1}</Label>
                    <Input id={`q-${q.key}-label`} value={q.label} onChange={(ev) => updateQuestion(i, { label: ev.target.value })} error={e.label} />
                  </div>
                  <div>
                    <Label htmlFor={`q-${q.key}-kind`}>Answer type</Label>
                    <select
                      id={`q-${q.key}-kind`} value={q.kind} onChange={(ev) => updateQuestion(i, { kind: ev.target.value as CustomQuestion["kind"] })}
                      className={`h-11 ${fieldClasses(false)}`}
                    >
                      {QUESTION_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                      {!QUESTION_KINDS.some((k) => k.kind === q.kind) && <option value={q.kind}>{q.kind.replace("_", " ")}</option>}
                    </select>
                  </div>
                  {q.kind === "single_select" && (
                    <div>
                      <Label htmlFor={`q-${q.key}-choices`}>Choices, one per line</Label>
                      <textarea
                        id={`q-${q.key}-choices`} rows={3} value={q.choices.join("\n")}
                        onChange={(ev) => updateQuestion(i, { choices: ev.target.value.split("\n") })}
                        aria-invalid={e.choices ? true : undefined} aria-describedby={e.choices ? `q-${q.key}-choices-error` : undefined}
                        className={`py-2 ${fieldClasses(Boolean(e.choices))}`}
                      />
                      {e.choices && <p id={`q-${q.key}-choices-error`} className="mt-1 text-sm text-danger">{e.choices}</p>}
                    </div>
                  )}
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
                    <input type="checkbox" checked={q.required} onChange={(ev) => updateQuestion(i, { required: ev.target.checked })} className={`size-5 accent-accent ${focusRing}`} />
                    Guests must answer
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" disabled={i === 0} onClick={() => moveQuestion(i, -1)} aria-label={`Move "${name}" up`}>Move up</Button>
                    <Button variant="secondary" size="sm" disabled={i === questions.length - 1} onClick={() => moveQuestion(i, 1)} aria-label={`Move "${name}" down`}>Move down</Button>
                    <Button variant="ghost" size="sm" onClick={() => removeQuestion(i)} aria-label={`Remove "${name}"`}>Remove</Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
        <div><Button variant="secondary" onClick={addQuestion}>Add a question</Button></div>
      </Panel>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-4">
        <Button onClick={save} loading={saving}>{id ? "Save changes" : "Create event type"}</Button>
        <p role="status" className={`text-sm ${status === "invalid" ? "text-danger" : "text-text-muted"}`}>
          {status === "saved" ? "Saved" : status === "invalid" ? "Some fields need a fix. They're marked above." : ""}
        </p>
      </div>

      {id && (
        <div className="mt-8 border-t border-border pt-4">
          {!confirmDelete ? (
            <Button variant="ghost" onClick={() => { setConfirmDelete(true); setDeleteError(null); }}>Delete event type</Button>
          ) : (
            <div className="grid gap-3">
              <p className="text-text">Delete this event type? Its link stops working. This can&apos;t be undone.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={remove} loading={deleting}>Yes, delete it</Button>
                <Button variant="secondary" onClick={() => { setConfirmDelete(false); setDeleteError(null); }}>Keep it</Button>
              </div>
            </div>
          )}
          {deleteError && <p role="alert" className="mt-3 rounded-md bg-danger-bg p-3 text-sm text-danger">{deleteError}</p>}
        </div>
      )}
    </div>
  );
}

function Panel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id} className="mt-6 grid max-w-xl gap-5">
      {children}
    </div>
  );
}

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus ${checked ? "border-accent bg-surface font-semibold text-text" : "border-border-input bg-card text-text"}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-accent" />
      {children}
    </label>
  );
}
