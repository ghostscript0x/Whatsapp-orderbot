import type { Metadata } from "next";
import Link from "next/link";
import { platformAdminForPage } from "@/components/home/page-auth";
import { AccessNotice } from "@/components/home/notice";
import { BrandMark } from "@/components/shell/brand";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = { title: "Platform admin" };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await platformAdminForPage("/admin");
  if (!auth.ok) return <AccessNotice title="403 · Not allowed" message="This page is only for platform administrators." />;

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="flex items-center gap-2.5 font-semibold">
            <BrandMark />
            Platform admin
          </span>
          <Link
            href="/dashboard"
            className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <Toaster />
    </div>
  );
}
