// ─────────────────────────────────────────────────────────────────────────────
// Copy table for the dashboard visitor card (src/components/admin/VisitorFunnelCard).
//
// English and Arabic keyed the same, so the card goes bilingual with a `dir`
// flip and a locale switch — no i18n framework yet, so we don't build one
// (mirrors HERO_COPY / TODAY_COPY). The admin console renders "en" today.
// ─────────────────────────────────────────────────────────────────────────────

import type { FunnelStepKey } from "@/lib/visitor-funnel";

export type VisitorCopyLocale = "en" | "ar";

type VisitorCopy = {
  dir: "ltr" | "rtl";
  /** BCP-47 tag for number formatting. */
  numberLocale: string;
  title: string;
  rangeLabel: string;
  week: string;
  month: string;
  uniqueVisitors: string;
  pageViews: string;
  funnelTitle: string;
  steps: Record<FunnelStepKey, string>;
  dropOff: (percent: string) => string;
  chartTitle: string;
  chartEmpty: string;
  tooltipVisitors: string;
  /** Shown to a branch-scoped viewer: browsing isn't tied to a branch. */
  branchNote: string;
  /** Under the funnel: how the last step is counted. */
  ordersNote: string;
};

export const VISITOR_FUNNEL_COPY: Record<VisitorCopyLocale, VisitorCopy> = {
  en: {
    dir: "ltr",
    numberLocale: "en-US",
    title: "Visitors",
    rangeLabel: "Period",
    week: "This week",
    month: "30 days",
    uniqueVisitors: "Unique visitors",
    pageViews: "Page views",
    funnelTitle: "Conversion funnel",
    steps: {
      visitors: "Visitors",
      productViews: "Viewed a product",
      addToCart: "Added to cart",
      checkout: "Started checkout",
      orders: "Orders placed",
    },
    dropOff: (percent) => `${percent}% drop-off`,
    chartTitle: "Daily unique visitors",
    chartEmpty: "No visits recorded in this period yet.",
    tooltipVisitors: "visitors",
    branchNote:
      "Browsing isn’t tied to a branch, so store-wide traffic is shown to admins only. These figures cover visits attributed to your branch and its orders.",
    ordersNote: "Orders are real placed orders (every status but cancelled), not tracked clicks.",
  },
  ar: {
    dir: "rtl",
    numberLocale: "ar-EG",
    title: "الزوار",
    rangeLabel: "الفترة",
    week: "هذا الأسبوع",
    month: "٣٠ يومًا",
    uniqueVisitors: "زوار فريدون",
    pageViews: "مشاهدات الصفحات",
    funnelTitle: "مسار التحويل",
    steps: {
      visitors: "الزوار",
      productViews: "شاهدوا منتجًا",
      addToCart: "أضافوا إلى السلة",
      checkout: "بدأوا الدفع",
      orders: "طلبات مؤكدة",
    },
    dropOff: (percent) => `انخفاض ${percent}٪`,
    chartTitle: "الزوار الفريدون يوميًا",
    chartEmpty: "لا توجد زيارات مسجلة في هذه الفترة بعد.",
    tooltipVisitors: "زائر",
    branchNote:
      "التصفح غير مرتبط بفرع، لذا تظهر حركة المتجر كاملة للمسؤولين فقط. تشمل هذه الأرقام الزيارات المنسوبة إلى فرعك وطلباته.",
    ordersNote: "الطلبات هي طلبات فعلية (كل الحالات عدا الملغاة)، وليست نقرات مسجلة.",
  },
};
