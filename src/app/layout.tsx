import type { Metadata } from "next";
import { Cormorant_Garamond, Geist } from "next/font/google"; // استخدمنا خط فاخر للـ Serif
import { Toaster } from "sonner";
import "./globals.css";

// خط فاخر للـ Headlines
const luxuryFont = Cormorant_Garamond({
  variable: "--font-luxury",
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
});

// خط نظيف للنصوص الطويلة
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // SEO Optimization
  title: "Ali Baba | Authentic Luxury Sweets & Pastry",
  description:
    "Experience the art of authentic sweets. Ali Baba offers a premium collection of oriental delicacies and modern pastries crafted for the connoisseur.",
  keywords: [
    "Luxury Sweets",
    "Oriental Pastry",
    "Ali Baba",
    "Premium Desserts",
    "Gourmet Sweets",
  ],
  authors: [{ name: "Mustafa Melake" }],
  openGraph: {
    title: "Ali Baba | Luxury Sweets",
    description:
      "Discover our premium 2026 signature collection of oriental and modern sweets.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${luxuryFont.variable} ${geistSans.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
