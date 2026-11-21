import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/shell/brand";

const POINTS = [
  "Answers customers on your own WhatsApp number, day and night",
  "Shows your products with photos and real prices",
  "Writes every order into one simple list and alerts you",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/10 blur-2xl" />
        <Link href="/" className="relative flex items-center gap-2.5 text-lg font-semibold">
          <BrandMark className="size-9 bg-white/15 text-primary-foreground shadow-none" />
          OrderBot
        </Link>
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-balance">Your WhatsApp, taking orders while you cook.</p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-[15px] leading-snug opacity-95">
                <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-sm opacity-85">
          <ShieldCheck aria-hidden className="size-4" />
          The bot never asks customers for card or bank details.
        </p>
      </aside>

      <div className="flex min-h-dvh flex-col px-4 py-8 sm:px-8 sm:py-12 lg:justify-center">
        <Link
          href="/"
          className="mx-auto mb-8 flex items-center gap-2.5 rounded-lg text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <BrandMark />
          OrderBot
        </Link>
        <main className="mx-auto w-full max-w-md">{children}</main>
      </div>
    </div>
  );
}
