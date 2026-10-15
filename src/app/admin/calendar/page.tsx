import { requireAdminPage } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { prismaErrorCode } from "@/lib/action-utils";
import { storeDayKey } from "@/lib/timezone";
import {
  addDays,
  CALENDAR_VIEWS,
  compareEvents,
  dateToDayKey,
  dayKeyToDate,
  isDayKey,
  PREP_WINDOW_DAYS,
  prepStatus,
  viewRange,
  type CalendarEvent,
  type CalendarView,
  type DayKey,
} from "@/lib/marketing-calendar";
import { builtInEventsBetween } from "@/lib/marketing-holidays";
import PageHeader from "@/components/admin/PageHeader";
import MarketingCalendar from "@/components/admin/calendar/MarketingCalendar";

export const metadata = {
  title: "Calendar | Admin",
};

// Reminders mutate in place and "today" drives the prep panel — always live.
export const dynamic = "force-dynamic";

/** Custom reminders touching [start, end], mapped to the calendar's shape. */
async function loadReminders(start: DayKey, end: DayKey): Promise<CalendarEvent[]> {
  const rows = await prisma.marketingEvent.findMany({
    where: { startDate: { lte: dayKeyToDate(end) }, endDate: { gte: dayKeyToDate(start) } },
    orderBy: [{ startDate: "asc" }, { endDate: "desc" }],
    select: {
      id: true,
      title: true,
      type: true,
      startDate: true,
      endDate: true,
      notes: true,
      strategy: true,
      targetDiscountPercent: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    source: "custom",
    title: row.title,
    titleAr: null,
    type: row.type,
    // `@db.Date` reads back as UTC midnight — the key is its ISO date.
    start: dateToDayKey(row.startDate),
    end: dateToDayKey(row.endDate),
    prepTip: null,
    estimated: false,
    notes: row.notes,
    strategy: row.strategy,
    targetDiscountPercent: row.targetDiscountPercent,
  }));
}

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  // ADMIN-only: campaign planning is store-wide, so a MANAGER is bounced to /admin.
  await requireAdminPage();

  const params = await searchParams;
  // One Cairo "today" drives the grid highlight and the prep window.
  const today = storeDayKey(new Date());
  // URL state is validated, never trusted: an unknown view or a malformed
  // date falls back to this month.
  const view: CalendarView = CALENDAR_VIEWS.includes(params.view as CalendarView)
    ? (params.view as CalendarView)
    : "month";
  const anchor = isDayKey(params.date) ? params.date : today;
  const range = viewRange(view, anchor);
  const prepEnd = addDays(today, PREP_WINDOW_DAYS);

  // Both windows in one parallel round-trip. If the reminders can't be read
  // (e.g. the MarketingEvent migration hasn't been applied yet) the page still
  // renders every built-in occasion and says why the custom ones are missing.
  const reminders = await Promise.all([
    loadReminders(range.start, range.end),
    loadReminders(today, prepEnd),
  ])
    .then(([visible, upcoming]) => ({ visible, upcoming, error: null as string | null }))
    .catch((err: unknown) => {
      console.error("calendar reminders failed:", err);
      return {
        visible: [] as CalendarEvent[],
        upcoming: [] as CalendarEvent[],
        error:
          prismaErrorCode(err) === "P2021"
            ? "Custom reminders are unavailable until the MarketingEvent migration is applied (prisma migrate deploy). Built-in occasions are shown below."
            : "Custom reminders couldn't be loaded — showing built-in occasions only.",
      };
    });

  const events = [...builtInEventsBetween(range.start, range.end), ...reminders.visible].sort(
    compareEvents,
  );
  const upcoming = [...builtInEventsBetween(today, prepEnd), ...reminders.upcoming]
    .filter((event) => prepStatus(event, today) !== null)
    .sort(compareEvents);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Merchandising"
        title="Marketing Calendar"
        description="Egyptian holidays, retail seasons and your own campaign reminders — plan promotions before the rush, not during it."
      />

      <MarketingCalendar
        view={view}
        anchor={anchor}
        today={today}
        range={range}
        events={events}
        upcoming={upcoming}
        loadError={reminders.error}
      />
    </div>
  );
}
