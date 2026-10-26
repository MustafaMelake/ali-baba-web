import type { Metadata } from "next";
import { Cormorant_Garamond, Geist } from "next/font/google"; // استخدمنا خط فاخر للـ Serif
import { Toaster } from "sonner";
import { GRID_DENSITY_SCRIPT } from "@/lib/grid-density";
import CartSyncProvider from "@/components/providers/CartSyncProvider";
import PasswordChangeGate from "@/components/providers/PasswordChangeGate";
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
    "Experience the art of authentic sweets. Ali Baba offers premium oriental delicacies and modern pastries crafted for the connoisseur.",
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
      "Discover our premium 2026 signature range of oriental and modern sweets.",
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
      // The pre-paint script below may set data-grid before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {/* Phone grid density (src/lib/grid-density.ts) — inline so the saved
            choice is on <html> before the first paint: no flash, no CLS. */}
        <script dangerouslySetInnerHTML={{ __html: GRID_DENSITY_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <CartSyncProvider>{children}</CartSyncProvider>
        {/* Holds a user with an admin-reset password on /account/change-password. */}
        <PasswordChangeGate />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
