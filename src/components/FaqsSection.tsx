import FaqAccordion from "@/components/FaqAccordion";
import { getStorefrontFaqs } from "@/lib/actions/faqs";

// Server Component wrapper for the storefront FAQ section. It owns the data
// fetch (active FAQs, ordered) and the SEO surface (the FAQPage JSON-LD, emitted
// server-side so Google's crawler reads it in the initial HTML), then hands the
// rows to the thin <FaqAccordion /> client island for the interactive UI.
//
// It shares the homepage's ISR cache (see src/app/(shop)/page.tsx). FAQ
// mutations call revalidatePath("/") (src/lib/actions/faqs.ts), so edits appear
// on the next request rather than after the ISR window.
export default async function FaqsSection() {
  const faqs = await getStorefrontFaqs();

  // Nothing active → render nothing at all (no empty section, no bare JSON-LD).
  if (faqs.length === 0) return null;

  // FAQPage structured data — built from the same rows the accordion renders, so
  // the markup and the crawler payload can never drift apart.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <>
      {/* حقن كود السكيما في الصفحة عشان عناكب جوجل تقرأه */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FaqAccordion faqs={faqs} />
    </>
  );
}
