"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WaStatus } from "@prisma/client";
import { Check, CircleAlert, Loader2, QrCode, RefreshCw, Smartphone, Unplug, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { WhatsAppStatusBadge } from "./status-badge";
import { PairingCodeForm } from "./pairing-code-form";

type SessionState = { status: WaStatus; qr: string | null; phone: string | null; lastSeenAt: string | null; stale?: boolean };

const POLL_MS = 3000;
const PENDING: WaStatus[] = ["STARTING", "QR_PENDING"];

const STEPS = ["Start", "Link your phone", "Live"] as const;

function currentStep(status: WaStatus): number {
  if (status === "CONNECTED") return 2;
  if (PENDING.includes(status)) return 1;
  return 0;
}

function Stepper({ status }: { status: WaStatus }) {
  const step = currentStep(status);
  return (
    <ol className="flex items-center gap-2" aria-label="Connection progress">
      {STEPS.map((label, i) => {
        const done = i < step || status === "CONNECTED";
        const active = i === step && status !== "CONNECTED";
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done ? "bg-primary text-primary-foreground" : active ? "border-2 border-primary text-primary" : "border-2 border-border text-muted-foreground",
              )}
            >
              {done ? <Check aria-hidden className="size-4" /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", active || done ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            <span className="sr-only">{done ? " (done)" : active ? " (current step)" : ""}</span>
            {i < STEPS.length - 1 && <span aria-hidden className={cn("h-0.5 flex-1 rounded-full", i < step ? "bg-primary" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}

const HERO: Record<WaStatus, { icon: typeof Wifi; tone: string }> = {
  CONNECTED: { icon: Wifi, tone: "bg-primary-soft text-primary" },
  STARTING: { icon: Loader2, tone: "bg-muted text-muted-foreground" },
  QR_PENDING: { icon: QrCode, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  NEEDS_RESCAN: { icon: CircleAlert, tone: "bg-destructive/10 text-destructive" },
  DISCONNECTED: { icon: WifiOff, tone: "bg-muted text-muted-foreground" },
};

export function WhatsAppConnect({ isOwner }: { isOwner: boolean }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const inFlight = useRef(false);
  const prevStatus = useRef<WaStatus | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setState(await apiFetch<SessionState>("/api/whatsapp/status", { cache: "no-store" }));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load WhatsApp status");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Celebrate the moment the scan succeeds.
  useEffect(() => {
    if (!state) return;
    if (prevStatus.current && PENDING.includes(prevStatus.current) && state.status === "CONNECTED") toast.success("WhatsApp connected. Your bot is live!");
    prevStatus.current = state.status;
  }, [state]);

  // Poll every 3 s while waiting for a scan / startup, only while the tab is visible.
  const pending = state ? PENDING.includes(state.status) : false;
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pending, refresh]);

  async function connect() {
    setConnecting(true);
    setActionError(null);
    try {
      setState(await apiFetch<SessionState>("/api/whatsapp/connect", { method: "POST" }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't start the connection. Please try again.");
    } finally {
      setConnecting(false);
    }
  }

  // Thrown errors keep the confirm dialog open and show the message there.
  async function disconnect() {
    setActionError(null);
    setState(await apiFetch<SessionState>("/api/whatsapp/disconnect", { method: "POST" }));
    toast("WhatsApp disconnected. The bot has stopped replying.");
  }

  if (!state) {
    return loadError ? (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6 sm:p-6">
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <div role="status" aria-label="Loading WhatsApp status" className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const { status } = state;
  const canConnect = status === "DISCONNECTED" || status === "NEEDS_RESCAN";
  const { icon: HeroIcon, tone } = HERO[status];

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <Stepper status={status} />
          <div className="flex items-start gap-4">
            <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-full", tone)}>
              <HeroIcon aria-hidden className={cn("size-6", status === "STARTING" && "animate-spin")} />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold leading-tight">{headline(state)}</h2>
                <WhatsAppStatusBadge status={status} />
              </div>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {describe(state)}
              </p>
            </div>
          </div>

          {state.stale && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              The WhatsApp gateway isn&apos;t responding right now. This is the last status we saw.
            </p>
          )}

          {isOwner ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {canConnect && (
                <Button size="lg" onClick={() => void connect()} disabled={connecting}>
                  {connecting && <Spinner />}
                  {status === "NEEDS_RESCAN" ? "Reconnect WhatsApp" : "Connect WhatsApp"}
                </Button>
              )}
              {!canConnect && (
                <ConfirmButton
                  variant="outline"
                  destructive
                  title="Disconnect WhatsApp?"
                  description="The bot will stop replying to customers until you connect again. Your products, orders and chats are kept."
                  confirmLabel="Yes, disconnect"
                  onConfirm={disconnect}
                >
                  <Unplug aria-hidden />
                  Disconnect
                </ConfirmButton>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Only the business owner can connect or disconnect WhatsApp.</p>
          )}

          {actionError && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </p>
          )}
        </CardContent>
      </Card>

      {isOwner && pending && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <h2 className="text-base font-semibold">Link your phone</h2>
            <p className="mt-1 text-sm text-muted-foreground">Use the phone that has your business WhatsApp account.</p>
            <Tabs defaultValue="qr" className="mt-4">
              <TabsList aria-label="How to link">
                <TabsTrigger value="qr">
                  <QrCode aria-hidden /> Scan QR code
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Smartphone aria-hidden /> Use a code
                </TabsTrigger>
              </TabsList>
              <TabsContent value="qr">
                <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
                  <div className="flex aspect-square w-full max-w-72 shrink-0 items-center justify-center rounded-2xl border bg-white p-3 shadow-sm">
                    {state.qr ? (
                      // OpenWA returns a PNG data URL; next/image adds nothing for inline data.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={state.qr} alt="WhatsApp QR code to link this business number" width={264} height={264} className="size-full [image-rendering:pixelated]" />
                    ) : (
                      <span className="flex items-center gap-2 text-sm text-neutral-600">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Preparing QR code…
                      </span>
                    )}
                  </div>
                  <ol className="w-full space-y-3 text-sm">
                    {[
                      "Open WhatsApp on your phone.",
                      "Tap Settings (or ⋮ on Android), then Linked devices.",
                      "Tap Link a device and point your phone at this QR code.",
                    ].map((text, i) => (
                      <li key={text} className="flex gap-3">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{i + 1}</span>
                        <span className="pt-0.5">{text}</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-2 pt-2 text-muted-foreground">
                      <Spinner className="size-3.5" label="Waiting" />
                      This page updates by itself once you&apos;re connected.
                    </li>
                  </ol>
                </div>
              </TabsContent>
              <TabsContent value="code">
                <PairingCodeForm disabled={status !== "QR_PENDING"} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <details className="group rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          <summary className="cursor-pointer py-1 font-medium text-foreground">Setting this up on your own computer?</summary>
          <p className="mt-2 leading-relaxed">
            The WhatsApp gateway delivers messages to this app over the internet, so <code>APP_URL</code> must be a public https address. When running on
            your computer, start a tunnel to port 3000 (for example <code>cloudflared tunnel --url http://localhost:3000</code> or{" "}
            <code>ngrok http 3000</code>), set <code>APP_URL</code> to the https URL it prints, restart the app, then click Connect again.
          </p>
        </details>
      )}
    </div>
  );
}

function headline(s: SessionState): string {
  switch (s.status) {
    case "CONNECTED":
      return "Your bot is live";
    case "STARTING":
      return "Getting ready…";
    case "QR_PENDING":
      return "Scan to finish connecting";
    case "NEEDS_RESCAN":
      return "WhatsApp needs reconnecting";
    case "DISCONNECTED":
      return "WhatsApp isn't connected";
  }
}

function describe(s: SessionState): string {
  switch (s.status) {
    case "CONNECTED":
      return s.phone ? `Connected as +${s.phone}. The bot is answering customers.` : "Connected. The bot is answering customers.";
    case "STARTING":
      return "Starting the WhatsApp session. This takes a few seconds.";
    case "QR_PENDING":
      return "Link your phone below. It only takes a moment.";
    case "NEEDS_RESCAN":
      return "WhatsApp logged this device out, so customers aren't getting replies. Reconnect and scan the QR code again.";
    case "DISCONNECTED":
      return "Connect your business number so the bot can reply to customers.";
  }
}
