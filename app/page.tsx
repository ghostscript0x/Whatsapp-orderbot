import Link from "next/link";
import { Bell, CheckCircle2, Package, ShieldCheck, ShoppingBag, Smartphone } from "lucide-react";
import { auth } from "@/auth";
import { buttonVariants } from "@/components/ui/button";
import { BrandMark } from "@/components/shell/brand";

const steps = [
  { icon: Smartphone, title: "Connect WhatsApp", text: "Scan a QR code with your phone. The assistant runs on your own business number." },
  { icon: Package, title: "Add your menu", text: "Products, prices and photos. The bot only sells what you list, at your prices." },
  { icon: ShoppingBag, title: "Take orders", text: "Customers chat, the bot confirms the order, and you get an alert straight away." },
];

const benefits = [
  { icon: Bell, text: "New-order alerts on your personal WhatsApp" },
  { icon: CheckCircle2, text: "Jump into any chat and reply yourself" },
  { icon: ShieldCheck, text: "Never asks customers for card or bank details" },
];

/** Illustration of a customer chat (decorative; hidden from screen readers). */
function ChatPreview() {
  const bubble = "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm";
  return (
    <div aria-hidden className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border bg-card shadow-xl">
      <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">MT</span>
        <div>
          <p className="text-sm font-semibold">Mama Tee&apos;s Kitchen</p>
          <p className="text-xs opacity-80">online</p>
        </div>
      </div>
      <div className="space-y-2 bg-chat-bg p-4">
        <p className={`${bubble} ml-auto rounded-br-md bg-bubble-out`}>Hi, do you have jollof rice today?</p>
        <p className={`${bubble} rounded-bl-md bg-bubble-in`}>Yes! Jollof rice with chicken is ₦3,500. Would you like to order?</p>
        <p className={`${bubble} ml-auto rounded-br-md bg-bubble-out`}>2 plates please, to Lekki Phase 1</p>
        <p className={`${bubble} rounded-bl-md bg-bubble-in`}>
          Done ✅ Order ORD-1042: 2 × Jollof rice, total <span className="font-semibold">₦8,000</span> with delivery. We&apos;ll message you when it&apos;s on the way.
        </p>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const signedIn = Boolean((await auth())?.user?.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2.5 font-semibold tracking-tight">
          <BrandMark />
          OrderBot
        </span>
        <nav aria-label="Account" className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/dashboard" className={buttonVariants({ size: "sm" })}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Log in
              </Link>
              <Link href="/signup" className={buttonVariants({ size: "sm" })}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 sm:px-6">
        <section className="grid items-center gap-12 pt-10 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              For food businesses that sell on WhatsApp
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]">
              Your WhatsApp number, now taking orders on its own.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground text-pretty">
              OrderBot answers customers, shows your products with photos, and writes every order into a simple dashboard, so you
              can cook, pack and deliver instead of typing.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={signedIn ? "/dashboard" : "/signup"} className={buttonVariants({ size: "lg" })}>
                {signedIn ? "Go to your dashboard" : "Get started"}
              </Link>
              {signedIn ? null : (
                <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
                  I already have an account
                </Link>
              )}
            </div>
            <ul className="mt-8 grid gap-2.5">
              {benefits.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Icon aria-hidden className="size-4 shrink-0 text-primary" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <ChatPreview />
        </section>

        <section aria-labelledby="how-it-works" className="mt-20 sm:mt-28">
          <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight">
            Live in three steps
          </h2>
          <p className="mt-1 text-muted-foreground">Most businesses are set up in about 15 minutes.</p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {steps.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-2xl border bg-card p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-sm font-medium tabular-nums text-muted-foreground">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <span>OrderBot</span>
          <span>Orders without the typing.</span>
        </div>
      </footer>
    </div>
  );
}
