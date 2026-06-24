"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// فصلنا البيانات عشان الكود يكون Clean وسهل التعديل
const faqs = [
  {
    question: "Do you offer custom cake designs for special occasions?",
    answer:
      "Yes, our Menouf boutique specializes in bespoke cakes for weddings, birthdays, and corporate events. We recommend booking at least 72 hours in advance.",
  },
  {
    question: "Are your ingredients locally sourced?",
    answer:
      "We blend the finest local honey and nuts with premium imported chocolates and butter to ensure the authentic, luxurious taste Ali Baba is known for.",
  },
  {
    question: "Do you have vegan or gluten-free options?",
    answer:
      "Our Beba Café offers a selection of plant-based milks and gluten-free pastries. Please ask our staff for the daily availability.",
  },
  {
    question: "Is delivery available for both branches?",
    answer:
      "Currently, we offer local delivery for our pastry selection in Menouf. Beba Café offers a premium dine-in and takeout experience.",
  },
];

export default function FeaturesBar() {
  // بناء كود الـ SEO Schema الديناميكي بناءً على مصفوفة الأسئلة
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
    <section id="faq" className="py-24 px-6 md:px-12 lg:px-20 bg-[#FAFAFA]">
      {/* حقن كود السكيما في الصفحة عشان عناكب جوجل تقرأه */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

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
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
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
