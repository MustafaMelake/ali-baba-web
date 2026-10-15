// ─────────────────────────────────────────────────────────────────────────────
// Built-in marketing calendar — Egyptian holidays & retail seasons.
//
// Computed per Gregorian year rather than stored, so the calendar is right for
// any year without re-seeding:
//   • Hijri occasions (Ramadan, the Eids, Hijri New Year, Mawlid) come from the
//     Umm al-Qura calendar in Intl (Node's full ICU). Egypt fixes the official
//     day by moon sighting (Dar al-Ifta), which can differ by a day, so these
//     are flagged `estimated`.
//   • Coptic Easter and Sham El-Nessim follow the Orthodox (Julian) computus.
//   • White/Black Friday is the day after the US Thanksgiving (4th Thursday of Nov).
//   • Everything else is a fixed Gregorian date.
// The calendar marks the OCCASION; an official day off can still be moved by
// cabinet decree.
//
// Pure apart from Intl. Called by the /admin/calendar Server Component only.
// ─────────────────────────────────────────────────────────────────────────────

import { MarketingEventType } from "@/generated/prisma/enums";
import {
  addDays,
  compareEvents,
  dayKeyToUTC,
  overlaps,
  utcToDayKey,
  type CalendarEvent,
  type DayKey,
} from "@/lib/marketing-calendar";

type Span = { start: DayKey; end: DayKey };

interface BuiltInOccasion {
  key: string;
  title: string;
  titleAr: string;
  type: MarketingEventType;
  prepTip: string;
  estimated?: boolean;
  /** Every occurrence that STARTS in Gregorian `year`. */
  spans: (year: number) => Span[];
}

// ── Date sources ─────────────────────────────────────────────────────────────

/** A fixed Gregorian date, `days` long. */
function fixed(month: number, day: number, days = 1) {
  return (year: number): Span[] => {
    const start = utcToDayKey(Date.UTC(year, month - 1, day));
    return [{ start, end: addDays(start, days - 1) }];
  };
}

const hijriFormat = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/**
 * An ICU without Umm al-Qura would silently fall back to the Gregorian
 * calendar and place every Hijri occasion on the wrong day — skip them instead.
 */
const HAS_UMM_AL_QURA = hijriFormat.resolvedOptions().calendar === "islamic-umalqura";

function hijriMonthDay(key: DayKey): { month: number; day: number } {
  let month = 0;
  let day = 0;
  for (const part of hijriFormat.formatToParts(dayKeyToUTC(key))) {
    if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  return { month, day };
}

/** The Hijri month/day of every day of a Gregorian year, computed once per year. */
const hijriYears = new Map<number, Array<{ key: DayKey; month: number; day: number }>>();

function hijriYear(year: number) {
  let table = hijriYears.get(year);
  if (!table) {
    table = [];
    for (let key = `${year}-01-01`; key.startsWith(`${year}-`); key = addDays(key, 1)) {
      table.push({ key, ...hijriMonthDay(key) });
    }
    hijriYears.set(year, table);
  }
  return table;
}

/** Gregorian days in `year` falling on Hijri month/day — a Hijri date can recur twice in one year. */
function hijriDays(year: number, hijriMonth: number, hijriDay: number): DayKey[] {
  if (!HAS_UMM_AL_QURA) return [];
  return hijriYear(year)
    .filter((d) => d.month === hijriMonth && d.day === hijriDay)
    .map((d) => d.key);
}

/** A Hijri date, `days` long. */
function hijri(hijriMonth: number, hijriDay: number, days = 1) {
  return (year: number): Span[] =>
    hijriDays(year, hijriMonth, hijriDay).map((start) => ({ start, end: addDays(start, days - 1) }));
}

/** Ramadan runs from 1 Ramadan to the eve of 1 Shawwal — 29 or 30 days. */
function ramadan(year: number): Span[] {
  return hijriDays(year, 9, 1).map((start) => {
    let end = start;
    while (hijriMonthDay(addDays(end, 1)).month === 9) end = addDays(end, 1);
    return { start, end };
  });
}

/** Orthodox (Coptic) Easter Sunday — Meeus' Julian computus, +13 days to Gregorian (1900–2099). */
export function orthodoxEaster(year: number): DayKey {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return utcToDayKey(Date.UTC(year, month - 1, day + 13));
}

/** The day after the US Thanksgiving (the fourth Thursday of November). */
export function blackFriday(year: number): DayKey {
  const novemberFirst = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - novemberFirst + 7) % 7);
  return utcToDayKey(Date.UTC(year, 10, firstThursday + 22));
}

// ── The catalog ──────────────────────────────────────────────────────────────

const NATIONAL_DAY_TIP =
  "Public holiday — adjust branch hours and delivery staffing; a light themed post is enough.";

const BUILT_IN_OCCASIONS: BuiltInOccasion[] = [
  // Religious
  {
    key: "ramadan",
    title: "Ramadan",
    titleAr: "شهر رمضان",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip:
      "Kunafa, qatayef and iftar/suhoor boxes peak all month — have stock, packaging and banners live before the first night.",
    estimated: true,
    spans: ramadan,
  },
  {
    key: "eid-al-fitr",
    title: "Eid al-Fitr",
    titleAr: "عيد الفطر",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip:
      "Kahk, biscuits, ghorayeba and petits fours season — open pre-orders by mid-Ramadan and plan branch capacity for the last ten nights.",
    estimated: true,
    spans: hijri(10, 1, 3),
  },
  {
    key: "eid-al-adha",
    title: "Eid al-Adha",
    titleAr: "عيد الأضحى",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip:
      "Family gatherings and visits — gateaux, petits fours and gift trays; staff branches for the long holiday that starts on Arafat Day.",
    estimated: true,
    spans: hijri(12, 10, 4),
  },
  {
    key: "hijri-new-year",
    title: "Islamic New Year",
    titleAr: "رأس السنة الهجرية",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip: "Public holiday — a small 'new beginnings' offer or social post is enough.",
    estimated: true,
    spans: hijri(1, 1),
  },
  {
    key: "mawlid",
    title: "Prophet's Birthday (Mawlid)",
    titleAr: "المولد النبوي الشريف",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip:
      "Halawet el-Moulid season — sugar dolls, nut bars and Moulid boxes sell through the two weeks before; stock the Moulid range early.",
    estimated: true,
    spans: hijri(3, 12),
  },
  {
    key: "coptic-christmas",
    title: "Coptic Christmas",
    titleAr: "عيد الميلاد المجيد",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip:
      "Ends the Nativity fast — celebration cakes and family trays; take orders through the first week of January.",
    spans: fixed(1, 7),
  },
  {
    key: "coptic-easter",
    title: "Coptic Easter",
    titleAr: "عيد القيامة المجيد",
    type: MarketingEventType.RELIGIOUS_HOLIDAY,
    prepTip:
      "Ends the Great Lent fast — dairy-rich cakes and pastries are back; pair it with Sham El-Nessim the next day.",
    spans: (year) => [{ start: orthodoxEaster(year), end: orthodoxEaster(year) }],
  },

  // National
  {
    key: "revolution-police-day",
    title: "Revolution & Police Day",
    titleAr: "عيد ثورة ٢٥ يناير وعيد الشرطة",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip: NATIONAL_DAY_TIP,
    spans: fixed(1, 25),
  },
  {
    key: "sham-el-nessim",
    title: "Sham El-Nessim",
    titleAr: "شم النسيم",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip:
      "Spring outing day — picnic boxes and light pastries; many families are out, so push delivery the day before.",
    spans: (year) => {
      const day = addDays(orthodoxEaster(year), 1);
      return [{ start: day, end: day }];
    },
  },
  {
    key: "sinai-liberation-day",
    title: "Sinai Liberation Day",
    titleAr: "عيد تحرير سيناء",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip: NATIONAL_DAY_TIP,
    spans: fixed(4, 25),
  },
  {
    key: "labour-day",
    title: "Labour Day",
    titleAr: "عيد العمال",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip: NATIONAL_DAY_TIP,
    spans: fixed(5, 1),
  },
  {
    key: "june-30-revolution",
    title: "June 30 Revolution",
    titleAr: "ذكرى ثورة ٣٠ يونيو",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip: NATIONAL_DAY_TIP,
    spans: fixed(6, 30),
  },
  {
    key: "july-23-revolution",
    title: "Revolution Day",
    titleAr: "عيد ثورة ٢٣ يوليو",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip: NATIONAL_DAY_TIP,
    spans: fixed(7, 23),
  },
  {
    key: "armed-forces-day",
    title: "Armed Forces Day",
    titleAr: "عيد القوات المسلحة",
    type: MarketingEventType.EGYPTIAN_HOLIDAY,
    prepTip: NATIONAL_DAY_TIP,
    spans: fixed(10, 6),
  },

  // Retail
  {
    key: "valentines-day",
    title: "Valentine's Day",
    titleAr: "عيد الحب",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip: "Heart cakes, red velvet and gift boxes — launch the collection a week ahead.",
    spans: fixed(2, 14),
  },
  {
    key: "mothers-day",
    title: "Mother's Day",
    titleAr: "عيد الأم",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip:
      "One of Egypt's biggest gifting days — cakes and gift boxes; open pre-orders 10–14 days ahead.",
    spans: fixed(3, 21),
  },
  {
    key: "back-to-school",
    title: "Back to School",
    titleAr: "العودة للمدارس",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip:
      "Lunchbox snacks, croissants and family packs. The Ministry of Education sets the exact start each year.",
    estimated: true,
    spans: fixed(9, 15, 16),
  },
  {
    key: "singles-day",
    title: "11.11 Sale Day",
    titleAr: "عروض ١١.١١",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip: "Regional marketplaces run 11.11 flash sales — a one-day online offer rides the traffic.",
    spans: fixed(11, 11),
  },
  {
    key: "white-friday",
    title: "White Friday (Black Friday)",
    titleAr: "الجمعة البيضاء",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip:
      "Egypt's Black Friday, through Cyber Monday — many retailers run the whole week; prepare an online flash sale and delivery capacity.",
    spans: (year) => {
      const start = blackFriday(year);
      return [{ start, end: addDays(start, 3) }];
    },
  },
  {
    key: "christmas",
    title: "Christmas",
    titleAr: "الكريسماس",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip:
      "Not Egypt's official Christmas (that's January 7), but peak demand for yule logs and celebration cakes.",
    spans: fixed(12, 25),
  },
  {
    key: "new-years-eve",
    title: "New Year's Eve",
    titleAr: "ليلة رأس السنة",
    type: MarketingEventType.RETAIL_SEASON,
    prepTip: "Party cakes and dessert platters — plan capacity for same-day orders on the 31st.",
    spans: fixed(12, 31, 2),
  },
];

/** Every built-in occasion touching [start, end], in display order. */
export function builtInEventsBetween(start: DayKey, end: DayKey): CalendarEvent[] {
  // Start a year early: an occasion that began last year can run into the
  // range (Ramadan across January, New Year's Eve into the 1st).
  const fromYear = Number(start.slice(0, 4)) - 1;
  const toYear = Number(end.slice(0, 4));
  const events: CalendarEvent[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    for (const occasion of BUILT_IN_OCCASIONS) {
      for (const span of occasion.spans(year)) {
        if (!overlaps(span, start, end)) continue;
        events.push({
          id: `builtin:${occasion.key}:${span.start}`,
          source: "builtin",
          title: occasion.title,
          titleAr: occasion.titleAr,
          type: occasion.type,
          start: span.start,
          end: span.end,
          prepTip: occasion.prepTip,
          estimated: occasion.estimated ?? false,
          notes: null,
          strategy: null,
          targetDiscountPercent: null,
        });
      }
    }
  }

  return events.sort(compareEvents);
}
