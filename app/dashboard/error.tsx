"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert aria-hidden className="size-6" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong on our side. Your data is safe. Try again, and if it keeps happening, check your internet connection.
      </p>
      {error.digest && <p className="mt-3 font-mono text-xs text-muted-foreground">Error ref: {error.digest}</p>}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button onClick={reset}>
          <RotateCw aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to Home</Link>
        </Button>
      </div>
    </div>
  );
}
