import Link from "next/link";
import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HomeData } from "./data";

type Step = { done: boolean; title: string; description: string; href: string };

export function SetupChecklist({ checklist }: { checklist: HomeData["checklist"] }) {
  const steps: Step[] = [
    {
      done: checklist.whatsappConnected,
      title: "Connect WhatsApp",
      description: "Scan a QR code to link your business number.",
      href: "/dashboard/whatsapp",
    },
    {
      done: checklist.hasProducts,
      title: "Add products",
      description: "Add at least one product with a price so the bot can sell it.",
      href: "/dashboard/products",
    },
    {
      done: checklist.businessDetailsSet,
      title: "Set business details",
      description: "Add your alert phone number, plus delivery areas or payment instructions.",
      href: "/dashboard/settings?tab=business",
    },
    {
      done: checklist.botTested,
      title: "Test the bot",
      description: "Send a test message and check the bot replies.",
      href: "/dashboard/settings?tab=test",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Card className="overflow-hidden border-primary/25">
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-base sm:text-base">Get your bot live</CardTitle>
          <span className="text-sm font-medium tabular-nums text-primary">{Math.round((doneCount / steps.length) * 100)}%</span>
        </div>
        <CardDescription>
          {doneCount} of {steps.length} steps done. Most businesses finish in about 15 minutes.
        </CardDescription>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        <ol className="divide-y border-t">
          {steps.map((step) => (
            <li key={step.title}>
              <Link
                href={step.href}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none sm:px-6"
              >
                {step.done ? (
                  <CircleCheck aria-hidden className="size-5 shrink-0 text-primary" />
                ) : (
                  <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={step.done ? "block text-sm font-medium text-muted-foreground line-through" : "block text-sm font-medium"}>
                    {step.title}
                    <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                  </span>
                  {!step.done && <span className="block text-xs text-muted-foreground">{step.description}</span>}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
