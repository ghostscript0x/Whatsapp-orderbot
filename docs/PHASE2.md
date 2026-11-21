# Phase 2: polish, hardening, human-feeling bot

Four agents work in parallel. `docs/CONTRACTS.md` still applies (route(), requireTenant, ctx.db, Zod, kobo, no TODOs,
no swallowed errors) except where this file overrides it. Database is now **SQLite** (`prisma/dev.db`; tests use
`prisma/test.db`); keep queries portable (use `lib/db-compat.ts` `insensitive()` / `isUniqueViolation()`).

## Rules for every agent

- The user has `npm run dev` running on port 3000 and may run the worker. **Never** run `next dev`, `next build`,
  `npm run worker`, or anything that consumes the real Redis queues or sends WhatsApp messages. Never call OpenWA
  endpoints that send, mark read, or change sessions. Never run `npm install` (report needed packages instead).
- Allowed checks: `npx tsc --noEmit`, `npx eslint <your paths>`, `npx vitest run --config vitest.unit.config.ts <files>`,
  and integration tests `npx vitest run tests/integration/<file>` (SQLite test DB, safe).
- Only edit files you own (below). Errors in other agents' files while they work: ignore them, fix yours.
- If you need something from another agent's area, code against the contract below and report it.
- Final report: files changed, what improved, real check output, anything not done.

## Ownership

| Agent | Owns |
|---|---|
| **ui-core** | `components/ui/**`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, `app/(auth)/**`, `app/dashboard/layout.tsx`, `app/dashboard/loading.tsx`, `app/dashboard/error.tsx`, `app/dashboard/page.tsx`, `components/shell/**`, `components/home/**`, `app/dashboard/team/**`, `app/admin/**`, `components/admin/**`, `app/dashboard/settings/**`, `components/settings/**`, `app/dashboard/whatsapp/**`, `components/whatsapp/**` |
| **ui-ops** | `app/dashboard/products/**`, `app/dashboard/orders/**`, `app/dashboard/conversations/**`, `components/products/**`, `components/orders/**`, `components/conversations/**` |
| **human-bot** | `lib/agent/**`, `lib/llm/**`, `lib/openwa.ts`, `lib/webhook.ts`, `lib/humanize.ts` (new), `worker/inbound-message.ts`, `worker/session-events.ts`, `app/api/webhooks/**`, `app/api/settings/bot/**`, `docs/OPENWA.md`, tests `tests/unit/{agent*,llm*,webhook*,humanize*,business-hours*}.test.ts` |
| **backend** | everything else under `lib/**`, `app/api/**` (except the human-bot routes), `worker/index.ts`, `worker/notifications.ts`, `worker/maintenance.ts`, `prisma/**`, `scripts/**`, `package.json` scripts section only, `tests/integration/**`, other `tests/unit/**`, `README.md`, `docs/DEPLOY.md` |

## Shared UI primitives (ui-core builds these FIRST, in `components/ui/`; ui-ops imports them)

Keep existing exports working (`Button`, `Input`, `Textarea`, `NativeSelect`, `Label`, `Switch`, `Badge`, `Card*`).
Add, with exactly these names:

- `components/ui/dialog.tsx`: `Dialog`, `DialogTrigger`, `DialogContent` (props: `title`, `description?`, children), `DialogFooter`, `DialogClose` — Radix dialog, mobile = bottom sheet.
- `components/ui/skeleton.tsx`: `Skeleton` (className).
- `components/ui/empty-state.tsx`: `EmptyState` (`icon?: LucideIcon`, `title`, `description?`, `action?: ReactNode`).
- `components/ui/page-header.tsx`: `PageHeader` (`title`, `description?`, `actions?: ReactNode`, `back?: { href: string; label: string }`).
- `components/ui/toast.tsx`: `Toaster` (mounted once by ui-core in the dashboard layout) and `toast` with `toast.success(msg)`, `toast.error(msg)`, `toast(msg)` — no new deps, small client store.
- `components/ui/tabs.tsx`: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (Radix tabs).
- `components/ui/confirm.tsx`: `ConfirmButton` (`onConfirm: () => Promise<void> | void`, `title`, `description?`, `confirmLabel?`, `destructive?`, plus Button props) — opens a Dialog.
- `components/ui/spinner.tsx`: `Spinner`.

## Backend → UI contract

- `lib/system-status.ts` (backend): `getSystemStatus(): Promise<{ workerOnline: boolean; lastHeartbeatAt: string | null }>`
  based on a Redis heartbeat the worker writes every 15 s (key `worker:heartbeat`, TTL 45 s).
  Exposed in `GET /api/dashboard/stats` as `system` and in `/api/health`.
  ui-core shows a clear banner on the dashboard home when `workerOnline` is false ("The bot worker isn't running —
  run `npm run dev:all` or `npm run worker`").
- `npm run dev:all` (backend): one command that runs `next dev` and the worker together with prefixed output
  (a small Node script in `scripts/`, no new deps).
