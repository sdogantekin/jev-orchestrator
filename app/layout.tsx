import { GoogleAnalytics } from "@next/third-parties/google";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const GA_MEASUREMENT_ID = "G-P1Z1BTKGMQ";

export const metadata: Metadata = {
  title: "Payment Decision Lab",
  description: "Can Jev, a probabilistic decision model, be a strong alternative to rule-based payment orchestration? A simulation-only experiment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-slate-100 antialiased">
        <div className="sticky top-0 z-50 border-b border-amber-500/30 bg-amber-950/90 px-4 py-2 text-center text-sm text-amber-200 backdrop-blur">
          <strong className="font-semibold">Simulation only.</strong> No real payments are processed, authorized, or routed anywhere on this site. All PSPs and transactions are synthetic.
        </div>
        <header className="border-b border-slate-800">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="font-semibold tracking-tight text-slate-100">
              Payment Decision Lab
            </Link>
            <div className="flex gap-6 text-sm">
              <Link href="/" className="text-slate-300 hover:text-white">
                Playground
              </Link>
              <Link href="/results" className="text-slate-300 hover:text-white">
                Results
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-500">
          Payment Decision Lab is a simulation-only experiment testing a claim about Jev, a decision model from TypeSafe, as an alternative to
          rule-based payment orchestration. No real PSP integration exists or is planned.
        </footer>
      </body>
      {/* Same Google Analytics property as serkandogantekin.com; reports can be split by hostname. */}
      <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
    </html>
  );
}
