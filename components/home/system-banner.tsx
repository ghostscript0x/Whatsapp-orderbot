import { TriangleAlert } from "lucide-react";
import type { SystemStatus } from "@/lib/system-status";

/** Loud banner when the bot worker has no heartbeat: messages are queued but nobody answers them. */
export function WorkerOfflineBanner({ status, timeLabel }: { status: SystemStatus; timeLabel: string | null }) {
  if (status.workerOnline) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-semibold text-amber-900 dark:text-amber-100">The bot isn&apos;t replying to customers right now</p>
        <p className="text-amber-900/80 dark:text-amber-100/80">
          The bot worker isn&apos;t running. Run <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-xs">npm run dev:all</code> or{" "}
          <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-xs">npm run worker</code>. New messages wait in the queue and are answered
          once it starts.
        </p>
        {timeLabel && <p className="text-xs text-amber-900/70 dark:text-amber-100/70">Last seen: {timeLabel}</p>}
      </div>
    </div>
  );
}
