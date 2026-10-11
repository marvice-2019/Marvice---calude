import { focusRing } from "@/components/ui/focus";
import { googleCalendarLink, outlookCalendarLink } from "@/lib/calendar-links";
import { t, type Locale } from "@/lib/i18n/guest";

/** Google and Outlook open with the event filled in; Apple Calendar and the rest take the .ics file. */
export function AddToCalendar({ token, title, start, end, location, manageUrl, locale }: {
  token: string; title: string; start: Date; end: Date; location: string | null; manageUrl: string; locale: Locale;
}) {
  const e = { title, details: `Change or cancel: ${manageUrl}`, location, start, end };
  const link = `inline-flex min-h-11 items-center rounded-md border border-border-input bg-card px-4 text-sm font-semibold text-text hover:bg-surface ${focusRing}`;
  return (
    <section aria-labelledby="add-cal" className="mt-4">
      <h2 id="add-cal" className="text-sm font-semibold text-text">{t(locale, "addToCalendar")}</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        <li><a className={link} href={googleCalendarLink(e)} rel="noopener noreferrer" target="_blank">Google Calendar</a></li>
        <li><a className={link} href={outlookCalendarLink(e)} rel="noopener noreferrer" target="_blank">Outlook</a></li>
        <li><a className={link} href={`/b/${token}/calendar.ics`} download>{t(locale, "calOther")}</a></li>
      </ul>
    </section>
  );
}
