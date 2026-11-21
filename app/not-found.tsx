import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX aria-hidden className="size-6" />
      </div>
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">The link may be old, or the page may have been moved or deleted.</p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
    </main>
  );
}
