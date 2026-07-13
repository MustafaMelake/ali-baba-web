"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Pure presentational leaf: the FAQ data is fetched server-side by FaqsSection
// (which also emits the FAQPage JSON-LD) and handed down as props. This keeps
// the interactive accordion a thin "use client" island over server state.
type Faq = {
  id: string;
  question: string;
  answer: string;
};

export default function FaqAccordion({ faqs }: { faqs: Faq[] }) {
  // Nothing to render when the admin has no active FAQs — skip the whole
  // section rather than showing an empty header.
  if (faqs.length === 0) return null;

  return (
    <section id="faq" className="py-24 px-6 md:px-12 lg:px-20 bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F5A6D]/70 mb-4 block">
            Inquiries
          </span>
          <h2 className="font-serif text-4xl md:text-5xl font-medium text-foreground">
            Common Questions
          </h2>
        </div>

        {/* Accordion (shadcn) */}
        <Accordion type="single" collapsible className="w-full">
          {faqs.map((faq) => (
            <AccordionItem
              key={faq.id}
              value={faq.id}
              // تصميم الـ border خفيف جداً للحفاظ على طابع المينيماليزم
              className="border-b border-stone-200 py-2 md:py-4"
            >
              <AccordionTrigger className="text-left font-serif text-lg md:text-xl hover:no-underline hover:text-[#0F5A6D] transition-colors duration-300">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-stone-500 text-base leading-relaxed md:pr-12 pb-6">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
