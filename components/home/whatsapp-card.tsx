import Link from "next/link";
import type { WaStatus } from "@prisma/client";
import { Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS: Record<WaStatus, { label: string; variant: "success" | "warning" | "destructive" | "secondary"; help: string; cta: string }> = {
  CONNECTED: { label: "Connected", variant: "success", help: "Your bot is live and answering customers.", cta: "Manage" },
  STARTING: { label: "Starting", variant: "secondary", help: "The WhatsApp session is starting up.", cta: "View" },
  QR_PENDING: { label: "Waiting for scan", variant: "warning", help: "Scan the QR code with WhatsApp on your phone to finish connecting.", cta: "Show QR code" },
  NEEDS_RESCAN: { label: "Needs re-scan", variant: "destructive", help: "WhatsApp logged out. Customers are not getting replies until you scan again.", cta: "Reconnect" },
  DISCONNECTED: { label: "Not connected", variant: "secondary", help: "Connect your business WhatsApp number so the bot can reply to customers.", cta: "Connect WhatsApp" },
};

export function WhatsAppCard({ status, phone }: { status: WaStatus; phone: string | null }) {
  const s = STATUS[status];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone aria-hidden className="size-4 text-muted-foreground" />
            WhatsApp
          </CardTitle>
          <Badge variant={s.variant}>{s.label}</Badge>
        </div>
        <CardDescription>{s.help}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">{phone ? `+${phone}` : "No number linked yet"}</span>
        <Button asChild size="sm" variant={status === "CONNECTED" ? "outline" : "default"}>
          <Link href="/dashboard/whatsapp">{s.cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
