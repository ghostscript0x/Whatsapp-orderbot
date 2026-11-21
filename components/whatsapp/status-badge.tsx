import type { WaStatus } from "@prisma/client";
import { Badge } from "@/components/ui/misc";

const LABELS: Record<WaStatus, { text: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  CONNECTED: { text: "Connected", variant: "success" },
  STARTING: { text: "Starting…", variant: "warning" },
  QR_PENDING: { text: "Waiting for scan", variant: "warning" },
  NEEDS_RESCAN: { text: "Needs re-scan", variant: "destructive" },
  DISCONNECTED: { text: "Disconnected", variant: "outline" },
};

export function WhatsAppStatusBadge({ status }: { status: WaStatus }) {
  const { text, variant } = LABELS[status];
  return <Badge variant={variant}>{text}</Badge>;
}
